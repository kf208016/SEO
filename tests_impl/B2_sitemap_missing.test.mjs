import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

import { runChecks } from '../public/core/checks.js';
import { runAudit } from '../public/core/crawl.js';

const encoder = new TextEncoder();
const parser = new DOMParser();

function result(url, {
  status = 200,
  body = null,
  type = 'text/html; charset=utf-8',
  error = null,
  accessBlocked = false,
  truncated = false,
  ourPolicy = null,
} = {}) {
  return {
    status,
    finalUrl: url,
    location: null,
    chain: [],
    stop: null,
    error,
    skipped: null,
    truncated,
    accessBlocked,
    truncatedHeaders: false,
    headers: { 'content-type': type },
    ourPolicy,
    bytes: body == null ? null : encoder.encode(body),
  };
}

function homePage(url) {
  return result(url, {
    body: `<!doctype html><html lang="zh-TW"><head><title>首頁</title><meta name="description" content="首頁"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${url}"><meta property="og:title" content="首頁"><meta property="og:image" content="https://a.com/image.png"><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>首頁</h1></body></html>`,
  });
}

function checkSnapshot(sitemaps) {
  return {
    origin: 'https://a.com',
    siteHost: 'a.com',
    home: 'https://a.com/',
    homeAnalyzable: true,
    pages: [],
    robots: { policy: 'allow_all', status: 200, url: 'https://a.com/robots.txt' },
    sitemaps,
    sitemapUrls: [],
    probes: { soft404: null, http: null },
    coverage: { status: 'complete', reasons: [], defects: false },
  };
}

async function auditDeclaredMissing(status, truncated) {
  return runAudit('https://a.com/', {
    parseHtml: (html) => parser.parseFromString(html, 'text/html'),
    delayMs: 0,
    sleep: async () => {},
    now: () => new Date('2026-10-17T00:00:00Z'),
    random: () => 0.5,
    fetchFn: async (url, kind) => {
      if (kind === 'robots') {
        return result(url, {
          body: 'User-agent: *\nAllow: /\nSitemap: https://a.com/declared.xml',
          type: 'text/plain',
          ourPolicy: { policy: 'allow_all', rulesCount: 0 },
        });
      }
      if (url === 'https://a.com/') return homePage(url);
      if (url === 'https://a.com/declared.xml') {
        return result(url, { status, type: 'application/xml', truncated });
      }
      if (kind === 'probe') return result(url, { status: 404 });
      throw new Error(`unexpected request: ${kind} ${url}`);
    },
  });
}

test('B2 checks: declared missing sitemap triggers only T19 with the v1.6 evidence contract', () => {
  const missing = [
    { url: 'https://a.com/one.xml', status: 404, kind: 'missing', fallback: false, error: null, accessBlocked: false, truncated: false },
    { url: 'https://a.com/two.xml', status: 410, kind: 'missing', fallback: false, error: null, accessBlocked: false, truncated: true },
  ];
  const findings = runChecks(checkSnapshot(missing));
  const t19 = findings.find((finding) => finding.id === 'T19');

  assert.ok(t19);
  assert.equal(t19.code, 'sitemap_invalid');
  assert.equal(t19.severity, 'P2');
  assert.equal(t19.evidence, 'verified');
  assert.equal(t19.title, 'robots.txt 宣告的 sitemap 有問題');
  assert.deepEqual(t19.urls, ['https://a.com/one.xml', 'https://a.com/two.xml']);
  assert.equal(t19.count, 2);
  assert.deepEqual(t19.data.sitemaps, [
    { url: 'https://a.com/one.xml', kind: 'missing' },
    { url: 'https://a.com/two.xml', kind: 'missing' },
  ]);
  assert.equal(findings.some((finding) => finding.id === 'T18'), false);
  assert.equal(findings.some((finding) => finding.id === 'T37'), false);
});

test('B2 checks: fallback missing remains T18, while a declared error remains T37', () => {
  const fallbackFindings = runChecks(checkSnapshot([
    { url: 'https://a.com/sitemap.xml', status: 404, kind: 'missing', fallback: true, error: null, accessBlocked: false, truncated: true },
  ]));
  assert.equal(fallbackFindings.some((finding) => finding.id === 'T18'), true);
  assert.equal(fallbackFindings.some((finding) => finding.id === 'T19'), false);
  assert.equal(fallbackFindings.some((finding) => finding.id === 'T37'), false);

  const errorFindings = runChecks(checkSnapshot([
    { url: 'https://a.com/declared.xml', status: 503, kind: 'error', fallback: false, error: null, accessBlocked: false, truncated: false },
  ]));
  assert.equal(errorFindings.some((finding) => finding.id === 'T18'), false);
  assert.equal(errorFindings.some((finding) => finding.id === 'T19'), false);
  assert.equal(errorFindings.some((finding) => finding.id === 'T37'), true);
});

test('B2 crawl: declared 404/410 are missing even when truncated, without unverifiable coverage', async () => {
  for (const status of [404, 410]) {
    for (const truncated of [false, true]) {
      const snapshot = await auditDeclaredMissing(status, truncated);
      assert.deepEqual(snapshot.sitemaps, [{
        url: 'https://a.com/declared.xml',
        status,
        kind: 'missing',
        urlCount: 0,
        fallback: false,
        error: null,
        truncated,
        accessBlocked: false,
      }]);
      assert.equal(snapshot.coverage.reasons.includes('sitemap_unverifiable'), false);
      assert.equal(snapshot.coverage.status, 'complete');
      assert.equal(snapshot.coverage.defects, false);

      const ids = new Set(runChecks(snapshot).map((finding) => finding.id));
      assert.equal(ids.has('T19'), true);
      assert.equal(ids.has('T18'), false);
      assert.equal(ids.has('T37'), false);
    }
  }
});
