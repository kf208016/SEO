import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { renderReport } from '../public/core/report.js';
import { extractPage } from '../public/core/parse.js';
import { parseSitemap } from '../public/core/sitemap.js';
import { runChecks } from '../public/core/checks.js';
import { GateCore } from '../src/gate.js';
import { proxyFetch } from '../src/proxy.js';
import worker from '../src/worker.js';

test('S12 無法評分原因以繁體中文顯示，不洩漏內部 reason code', () => {
  const report = renderReport({
    home: 'https://example.com/',
    scannedAt: '2026-10-17T12:00:00+08:00',
    pages: [],
    limits: { crawled: 0 },
    coverage: { status: 'failed', reasons: ['home_unavailable', 'future_reason'], defects: true },
    discovered: {},
    sitemaps: [],
  }, [], {
    score: null,
    raw: 100,
    grade: 'gray',
    capped: false,
    scoreStatus: 'unavailable',
    counts: { P0: 0, P1: 0, P2: 0, P3: 0, INFO: 0 },
  }, []);

  assert.match(report, /首頁暫時無法使用/);
  assert.match(report, /本次有無法完整判斷的項目/);
  assert.doesNotMatch(report, /home_unavailable|future_reason/);
});

test('S12 完整報告將內部頁面與 sitemap 狀態轉為中文', () => {
  const report = renderReport({
    home: 'https://example.com/',
    scannedAt: '2026-10-17T12:00:00+08:00',
    robots: { text: '' },
    pages: [{ finalUrl: 'https://example.com/', status: 0, error: 'proxy_timeout', isHtml: false, page: null }],
    limits: { crawled: 1 },
    coverage: { status: 'partial', reasons: ['fetch_errors'], defects: true },
    discovered: {},
    sitemaps: [{ url: 'https://example.com/sitemap.xml', status: 200, kind: 'urlset', urlCount: 1 }],
  }, [], {
    score: 100,
    raw: 100,
    grade: 'yellow',
    capped: false,
    scoreStatus: 'sample_only',
    counts: { P0: 0, P1: 0, P2: 0, P3: 0, INFO: 0 },
  }, [], { detail: true });

  assert.match(report, /讀取逾時/);
  assert.match(report, /網址清單/);
  assert.doesNotMatch(report, /proxy_timeout|>urlset</);
});

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) {
    if (Array.isArray(key)) return new Map(key.filter((item) => this.values.has(item)).map((item) => [item, structuredClone(this.values.get(item))]));
    return this.values.has(key) ? structuredClone(this.values.get(key)) : undefined;
  }
  async put(value, singleValue) {
    const entries = typeof value === 'string' ? { [value]: singleValue } : value;
    for (const [key, item] of Object.entries(entries)) this.values.set(key, structuredClone(item));
  }
  async delete() {}
  async list() { return new Map(); }
}

test('W06 GateCore 拒絕 Object prototype 上的偽 kind', async () => {
  const storage = new MemoryStorage();
  const gate = new GateCore({ storage, now: () => 0 });
  await gate.open({ auditId: 'a'.repeat(32), host: 'example.com' });
  assert.deepEqual(
    await gate.consume({ auditId: 'a'.repeat(32), kind: 'toString', url: 'https://example.com/' }),
    { ok: false, error: 'bad_kind' },
  );
});

test('W04 proxyFetch 拒絕 Object prototype 上的偽 kind，且不發出流量', async () => {
  let calls = 0;
  const result = await proxyFetch('https://example.com/', 'toString', 'example.com', {
    resolveImpl: async () => { calls += 1; return { ok: true, addresses: ['8.8.8.8'] }; },
    fetchImpl: async () => { calls += 1; return new Response('unexpected'); },
  });
  assert.equal(result.meta.error, 'host_not_allowed');
  assert.equal(calls, 0);
});

test('W04 proxyFetch 對無主體回應回傳空位元組，且不誤判串流錯誤', async () => {
  const response = { status: 204, headers: new Headers(), body: null };
  const result = await proxyFetch('https://example.com/', 'page', 'example.com', {
    resolveImpl: async () => ({ ok: true, addresses: ['8.8.8.8'] }),
    fetchImpl: async () => response,
  });
  assert.equal(result.meta.error, null);
  assert.deepEqual([...result.bytes], []);
});

test('W04 proxyFetch 的單一 deadline 可中止不理會 signal 的主體 reader', async () => {
  const body = new ReadableStream({ pull: () => new Promise(() => {}) });
  const result = await proxyFetch('https://example.com/', 'page', 'example.com', {
    deadlineMs: 10,
    resolveImpl: async () => ({ ok: true, addresses: ['8.8.8.8'] }),
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }),
  });
  assert.equal(result.meta.error, 'timeout');
  assert.equal(result.bytes, null);
});

test('P05 parseSitemap 以 DOCTYPE 與 processing instruction 後的第一個元素判型', () => {
  const parsed = parseSitemap(`<?xml-stylesheet href="site.xsl"?>
    <!DOCTYPE urlset [<!ELEMENT urlset ANY>]>
    <sm:urlset xmlns:sm="urn:test"><sm:url><sm:loc>https://example.com/a</sm:loc></sm:url></sm:urlset>`);
  assert.deepEqual(parsed, { kind: 'urlset', urls: ['https://example.com/a'], error: null });
});

test('P10 extractPage 不會因大量可折疊空白而漏掉後續可見文字', () => {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${' '.repeat(601_025)}<span>VISIBLE</span></body></html>`, 'text/html');
  const page = extractPage(doc, 'https://example.com/');
  assert.equal(page.textLength, 7);
  assert.equal(page.limitsHit.includes('textChars'), false);
});

test('P10 extractPage 的連結上限計算有效網址，不讓無效 href 擠掉後續連結', () => {
  const invalid = '<a href="javascript:x">x</a>'.repeat(2_000);
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${invalid}<a href="/valid">ok</a></body></html>`, 'text/html');
  const page = extractPage(doc, 'https://example.com/');
  assert.deepEqual(page.links.map((link) => link.url), ['https://example.com/valid']);
  assert.equal(page.limitsHit.includes('links'), true);
});

test('S07 fallback sitemap 不可驗證時 T18 與 T37 嚴格互斥', () => {
  const findings = runChecks({
    home: 'https://example.com/',
    siteHost: 'example.com',
    homeAnalyzable: true,
    pages: [],
    robots: null,
    sitemaps: [{
      url: 'https://example.com/sitemap.xml', fallback: true, status: 404,
      kind: 'error', error: null, accessBlocked: false, truncated: false,
    }],
    sitemapUrls: [],
    coverage: { status: 'partial', reasons: ['sitemap_unverifiable'], defects: true },
  });
  const ids = findings.map((finding) => finding.id);
  assert.equal(ids.includes('T18'), false);
  assert.equal(ids.includes('T37'), true);
});

test('G07 v1.2 組織類型清單中的 Restaurant 不會被誤報為缺少組織資料', () => {
  const page = {
    url: 'https://example.com/', finalUrl: 'https://example.com/', status: 200,
    isHtml: true, error: null, accessBlocked: false, duplicateOf: null, headers: {},
    page: {
      title: '餐廳', titleCount: 1, metaDescription: '說明', metaRobots: [], metaBingbot: [],
      canonicals: ['https://example.com/'], canonicalTagCount: 1, h1: '餐廳', lang: 'zh-Hant',
      hasViewport: true, og: { title: '餐廳', image: 'https://example.com/a.jpg' },
      jsonld: [{ ok: true, types: ['Restaurant'], error: null }], images: [],
      insecureResources: [], textLength: 200, scriptSrcCount: 0, hasSpaRoot: false,
      spaRootTextLength: null, metaRefresh: null,
    },
  };
  const findings = runChecks({
    home: page.finalUrl, origin: 'https://example.com', siteHost: 'example.com',
    homeAnalyzable: true, pages: [page], robots: { policy: 'allow_all', parsed: null },
    sitemaps: [], sitemapUrls: [], probes: {}, coverage: { status: 'complete', reasons: [], defects: false },
  });
  assert.equal(findings.some((finding) => finding.id === 'G07'), false);
});

test('W07 Worker 對 Object prototype 上的偽 kind 回 bad_kind 且不呼叫 DO', async () => {
  let doCalls = 0;
  const env = {
    AUDIT_GATE: {
      idFromName: () => 'global',
      get: () => ({ fetch: async () => { doCalls += 1; return Response.json({ ok: true }); } }),
    },
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    TURNSTILE_SITEKEY: '1x00000000000000000000AA',
    AUDIT_SECRET: 's'.repeat(32),
    AUDIT_ENABLED: 'true',
  };
  const { signToken } = await import('../src/token.js');
  const token = await signToken({ id: 'b'.repeat(32), exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
  const response = await worker.fetch(new Request('http://localhost/api/fetch', {
    method: 'POST',
    headers: { origin: 'http://localhost', authorization: `Bearer ${token}` },
    body: JSON.stringify({ u: 'https://example.com/', k: 'toString' }),
  }), env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'bad_kind' });
  assert.equal(doCalls, 0);
});
