import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { renderReport } from '../public/core/report.js';

const score = {
  score: 100,
  raw: 100,
  grade: 'green',
  capped: false,
  scoreStatus: 'valid',
  counts: { P0: 0, P1: 0, P2: 0, P3: 0, INFO: 0 },
};

const snapshot = {
  startUrl: 'https://example.com/',
  home: 'https://example.com/',
  scannedAt: '2026-10-17T12:00:00+08:00',
  pages: [],
  limits: { crawled: 0 },
  coverage: { status: 'complete', reasons: [], defects: false },
};

const botRows = [
  {
    category: 'ai_search',
    token: 'ClaudeBot',
    company: 'Anthropic',
    status: 'declared_allowed',
    blockedUrls: [],
    purpose: '用很長的用途說明驗證最後一欄仍然可以換行。',
  },
];

test('B3 爬蟲表格有 bot-table class 且仍位於 table-wrap 內', () => {
  const report = renderReport(snapshot, [], score, botRows);
  const { document } = parseHTML(`<!doctype html><html><body>${report}</body></html>`);
  const tables = [...document.querySelectorAll('.bot-group table')];

  assert.equal(tables.length, 1);
  assert.equal(tables[0].classList.contains('bot-table'), true);
  assert.equal(tables[0].parentElement.classList.contains('table-wrap'), true);
});

test('B3 前四欄不折行、用途欄可折，且橫向捲動限制在表格框內', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.bot-table th:nth-child\(-n\+4\),\.bot-table td:nth-child\(-n\+4\)\{white-space:nowrap\}/u);
  assert.match(css, /\.bot-table th:last-child,\.bot-table td:last-child\{white-space:normal;overflow-wrap:anywhere\}/u);
  assert.match(css, /\.table-wrap\{[^}]*width:100%;[^}]*max-width:100%;[^}]*min-width:0;[^}]*overflow-x:auto[^}]*\}/u);
  assert.match(css, /\.report\{[^}]*min-width:0[^}]*\}/u);
  assert.match(css, /\.report>\*,\.bot-group\{min-width:0\}/u);
});
