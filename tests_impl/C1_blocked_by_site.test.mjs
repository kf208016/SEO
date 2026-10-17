import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

import { runAudit } from '../public/core/crawl.js';
import { botAccess, runChecks } from '../public/core/checks.js';
import { renderReport } from '../public/core/report.js';
import { computeScore } from '../public/core/score.js';

const BLOCKED_BY_SITE_COPY = '這個網站的伺服器拒絕了本工具讀取（HTTP 401／403 或人機驗證）。很多網站只允許 Google 等知名爬蟲與一般瀏覽器，這不代表 Google 也被擋。本工具不會偽裝身分繞過，所以這次無法檢查；需要完整健檢，歡迎透過 LINE 官方帳號聯絡我們。';
const REPLACED_REASONS = ['robots_unknown', 'robots_final_unknown', 'home_not_analyzable'];
const encoder = new TextEncoder();
const parser = new DOMParser();

function response(url, {
  status = 200,
  body = null,
  type = 'text/html; charset=utf-8',
  location = null,
  error = null,
  accessBlocked = false,
  ourPolicy = null,
} = {}) {
  return {
    status,
    finalUrl: url,
    location,
    chain: [],
    stop: null,
    error,
    bodyLimit: 0,
    skipped: null,
    truncated: false,
    accessBlocked,
    truncatedHeaders: false,
    headers: { 'content-type': type },
    ourPolicy,
    bytes: body == null ? null : encoder.encode(body),
  };
}

const allowRobots = (url) => response(url, {
  status: 404,
  type: 'text/plain',
  ourPolicy: { policy: 'allow_all', rulesCount: 0 },
});

const blocked = (url, status = 403) => response(url, {
  status,
  body: '<html><body>Forbidden</body></html>',
  accessBlocked: true,
  ourPolicy: { policy: 'unknown', rulesCount: 0 },
});

async function audit(startUrl, fetchFn) {
  return runAudit(startUrl, {
    fetchFn,
    parseHtml: (source) => parser.parseFromString(source, 'text/html'),
    delayMs: 0,
    sleep: async () => {},
    now: () => new Date('2026-10-17T00:00:00Z'),
    random: () => 0.5,
  });
}

function assertBlockedReason(snapshot, label) {
  assert.equal(snapshot.coverage.status, 'failed', label);
  assert.equal(snapshot.coverage.defects, true, label);
  assert.deepEqual(snapshot.coverage.reasons, ['blocked_by_site'], label);
  assert.equal(snapshot.coverage.reasons.filter((reason) => reason === 'blocked_by_site').length, 1, label);
  for (const reason of REPLACED_REASONS) assert.equal(snapshot.coverage.reasons.includes(reason), false, `${label}: ${reason}`);
}

test('C1 起始 origin robots.txt accessBlocked 對應 blocked_by_site', async () => {
  const calls = [];
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    calls.push({ url, kind });
    return blocked(url);
  });

  assertBlockedReason(snapshot, 'start robots');
  assert.deepEqual(calls, [{ url: 'https://a.com/robots.txt', kind: 'robots' }]);
});

test('C1 最終 origin robots.txt accessBlocked 取代 robots_final_unknown', async () => {
  const calls = [];
  const snapshot = await audit('https://www.a.com/', async (url, kind) => {
    calls.push({ url, kind });
    if (url === 'https://www.a.com/robots.txt') return allowRobots(url);
    if (url === 'https://www.a.com/') return response(url, { status: 301, location: 'https://a.com/' });
    if (url === 'https://a.com/robots.txt') return blocked(url);
    throw new Error(`unexpected request: ${kind} ${url}`);
  });

  assertBlockedReason(snapshot, 'final robots');
  assert.deepEqual(calls, [
    { url: 'https://www.a.com/robots.txt', kind: 'robots' },
    { url: 'https://www.a.com/', kind: 'page' },
    { url: 'https://a.com/robots.txt', kind: 'robots' },
  ]);
});

test('C1 首頁 accessBlocked 取代 home_not_analyzable，且不加入 partial access_blocked', async () => {
  const calls = [];
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    calls.push({ url, kind });
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/' && kind === 'page') return blocked(url, 401);
    throw new Error(`unexpected request: ${kind} ${url}`);
  });

  assertBlockedReason(snapshot, 'home');
  assert.equal(snapshot.coverage.reasons.includes('access_blocked'), false);
  assert.deepEqual(calls, [
    { url: 'https://a.com/robots.txt', kind: 'robots' },
    { url: 'https://a.com/', kind: 'page' },
  ]);
});

test('C1 非 accessBlocked 的 robots 讀取錯誤仍保留 robots_unknown', async () => {
  const snapshot = await audit('https://a.com/', async (url) => response(url, {
    status: 0,
    error: 'network',
    type: 'text/plain',
    ourPolicy: { policy: 'unknown', rulesCount: 0 },
  }));

  assert.deepEqual(snapshot.coverage.reasons, ['robots_unknown']);
  assert.equal(snapshot.coverage.reasons.includes('blocked_by_site'), false);
});

test('C1 blocked_by_site 的 T29 summary 與無法評分原因逐字使用規格文案', async () => {
  const snapshot = await audit('https://a.com/', async (url) => blocked(url));
  const findings = runChecks(snapshot);
  const t29 = findings.find((finding) => finding.id === 'T29');

  assert.ok(t29);
  assert.equal(t29.summary, BLOCKED_BY_SITE_COPY);
  assert.deepEqual(t29.data.reasons, ['blocked_by_site']);

  const score = computeScore(findings, snapshot.coverage);
  const report = renderReport(snapshot, findings, score, botAccess(snapshot));
  const document = parser.parseFromString(`<!doctype html><html><body>${report}</body></html>`, 'text/html');
  const scoreParagraphs = [...document.querySelectorAll('.score-panel p')].map((node) => node.textContent);
  assert.ok(scoreParagraphs.includes(BLOCKED_BY_SITE_COPY), scoreParagraphs.join('\n'));
});
