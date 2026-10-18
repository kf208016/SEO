import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from 'linkedom';

import {
  BUCKET_QUOTAS,
  classifyUrl,
  orderCandidates,
  runAudit,
} from '../public/core/crawl.js';
import { VERSION } from '../public/core/version.js';
import worker from '../src/worker.js';

const encoder = new TextEncoder();
const parser = new DOMParser();
const parseHtml = (html) => parser.parseFromString(html, 'text/html');

function response(url, { status = 200, body = null, type = 'text/html; charset=utf-8', ourPolicy = null } = {}) {
  return {
    status,
    finalUrl: url,
    location: null,
    chain: [],
    stop: null,
    error: null,
    skipped: null,
    truncated: false,
    accessBlocked: false,
    truncatedHeaders: false,
    headers: { 'content-type': type },
    ourPolicy,
    bytes: body == null ? null : encoder.encode(body),
  };
}

function page(url, links = '') {
  return response(url, {
    body: `<!doctype html><html lang="zh-TW"><head><title>${url}</title><meta name="description" content="x"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${url}"></head><body><h1>頁面</h1>${links}</body></html>`,
  });
}

test('N12 classifyUrl 依優先序涵蓋規格範例', () => {
  assert.deepEqual(BUCKET_QUOTAS, { product: 6, content: 5, trust: 3 });
  assert.equal(classifyUrl('https://a.com/item-1'), 'other');
  assert.equal(classifyUrl('/item-1'), 'other');
  assert.equal(classifyUrl('https://a.com/products/x'), 'product');
  assert.equal(classifyUrl('/products/x'), 'product');
  assert.equal(classifyUrl('https://a.com/p/123'), 'product');
  assert.equal(classifyUrl('https://a.com/?id=5'), 'product');
  assert.equal(classifyUrl('https://a.com/zh/%E7%94%A2%E5%93%81/z'), 'product');
  assert.equal(classifyUrl('https://a.com/page/2'), 'excluded');
  assert.equal(classifyUrl('https://a.com/?page=2'), 'excluded');
  assert.equal(classifyUrl('https://a.com/blog/a'), 'content');
  assert.equal(classifyUrl('https://a.com/about'), 'trust');
  assert.equal(classifyUrl('https://a.com/x', ['前往購物車']), 'excluded');
});

test('N12 orderCandidates 套用配額並保留各區內發現順序', () => {
  const items = [
    ...Array.from({ length: 8 }, (_, index) => ({ url: `https://a.com/products/${index + 1}`, depth: 1, anchorTexts: [], fromSitemap: false })),
    { url: 'https://a.com/blog/a', depth: 1, anchorTexts: [], fromSitemap: false },
    { url: 'https://a.com/about', depth: 1, anchorTexts: [], fromSitemap: false },
    { url: 'https://a.com/other', depth: 1, anchorTexts: [], fromSitemap: false },
    { url: 'https://a.com/privacy', depth: 1, anchorTexts: [], fromSitemap: false },
  ];
  const ordered = orderCandidates(items).map((item) => new URL(item.url).pathname);
  assert.deepEqual(ordered.slice(0, 8), [
    '/products/1', '/products/2', '/products/3', '/products/4', '/products/5', '/products/6',
    '/blog/a', '/about',
  ]);
  assert.deepEqual(ordered.slice(8), ['/products/7', '/products/8', '/other', '/privacy']);
  assert.notEqual(orderCandidates(items), items);
});

test('N12 runAudit 先抓產品再抓內容信任與低價值頁，並記錄 bucket 統計', async () => {
  const paths = ['/privacy', '/cart', '/blog/a', '/about', '/products/x', '/products/y', '/?id=5', '/zh/產品/z', '/other1', '/page/2'];
  const links = paths.map((path) => `<a href="${path}">${path}</a>`).join('');
  const requestedPages = [];
  const snapshot = await runAudit('https://a.com/', {
    parseHtml,
    maxPages: 15,
    delayMs: 0,
    sleep: async () => {},
    now: () => new Date('2026-10-18T00:00:00Z'),
    random: () => 0.5,
    fetchFn: async (url, kind) => {
      if (kind === 'robots') return response(url, { status: 404, type: 'text/plain', ourPolicy: { policy: 'allow_all', rulesCount: 0 } });
      if (url.endsWith('/sitemap.xml')) return response(url, { status: 404, type: 'application/xml' });
      if (kind === 'probe') return response(url, { status: 404 });
      requestedPages.push(new URL(url).pathname + new URL(url).search);
      return url === 'https://a.com/' ? page(url, links) : page(url);
    },
  });

  assert.deepEqual(requestedPages, [
    '/', '/products/x', '/products/y', '/?id=5', '/zh/%E7%94%A2%E5%93%81/z',
    '/blog/a', '/about', '/other1', '/privacy', '/cart', '/page/2',
  ]);
  assert.deepEqual(snapshot.pages.map((entry) => entry.bucket), [
    'home', 'product', 'product', 'product', 'product', 'content', 'trust', 'other',
    'excluded', 'excluded', 'excluded',
  ]);
  assert.deepEqual(snapshot.limits.buckets, { product: 4, content: 1, trust: 1, other: 1, excluded: 3 });
});

test('N12 起始網址不是首頁時固定留在 pages[1] 且標為 start', async () => {
  const snapshot = await runAudit('https://a.com/blog/post?utm=x', {
    parseHtml,
    maxPages: 3,
    delayMs: 0,
    sleep: async () => {},
    now: () => new Date('2026-10-18T00:00:00Z'),
    random: () => 0.5,
    fetchFn: async (url, kind) => {
      if (kind === 'robots') return response(url, { status: 404, type: 'text/plain', ourPolicy: { policy: 'allow_all', rulesCount: 0 } });
      if (url.endsWith('/sitemap.xml')) return response(url, { status: 404, type: 'application/xml' });
      if (kind === 'probe') return response(url, { status: 404 });
      return page(url, url === 'https://a.com/' ? '<a href="/products/x">x</a>' : '');
    },
  });
  assert.equal(snapshot.pages[1].url, 'https://a.com/blog/post');
  assert.equal(snapshot.pages[1].bucket, 'start');
});

test('N14 版本、wrangler LINE_ID 與 /api/config lineId 一致', async () => {
  assert.equal(VERSION, '1.9.0');
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"LINE_ID"\s*:\s*"@760zrres"/u);
  const responseValue = await worker.fetch(new Request('http://localhost/api/config'), {
    TURNSTILE_SITEKEY: 'site-key',
    CONTACT_URL: 'https://example.com/contact',
    LINE_ID: '@760zrres',
  });
  assert.equal(responseValue.status, 200);
  assert.deepEqual(await responseValue.json(), {
    turnstileSiteKey: 'site-key',
    contactUrl: 'https://example.com/contact',
    lineId: '@760zrres',
    maxPages: 15,
    version: '1.9.0',
  });
});
