import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { renderReport } from '../public/core/report.js';

const ZERO_COUNTS = Object.freeze({ P0: 0, P1: 0, P2: 0, P3: 0, INFO: 0 });

function snapshot(coverage = { status: 'failed', defects: true, reasons: ['home_unavailable'] }) {
  return {
    home: 'https://example.com/',
    scannedAt: '2026-10-17T12:00:00+08:00',
    pages: [],
    limits: { crawled: 0 },
    coverage,
  };
}

function reportDocument(findings, scoreObj, coverage) {
  const report = renderReport(snapshot(coverage), findings, scoreObj, []);
  return parseHTML(`<!doctype html><html><body>${report}</body></html>`).document;
}

function summaryLabels(document) {
  return [...document.querySelectorAll('.summary-tile span')].map((node) => node.textContent.trim());
}

function severityCountLines(document) {
  return [...document.querySelectorAll('.score-panel p')]
    .map((node) => node.textContent.trim())
    .filter((text) => /^P0\s/u.test(text));
}

test('D1 unavailable 且無計分 Finding：三區塊顯示未檢查並隱藏 P0–P3 行', () => {
  const document = reportDocument([], {
    score: null,
    raw: 100,
    grade: 'gray',
    capped: false,
    scoreStatus: 'unavailable',
    counts: ZERO_COUNTS,
  });

  assert.deepEqual(summaryLabels(document), ['未檢查', '未檢查', '未檢查']);
  assert.deepEqual(severityCountLines(document), []);
});

test('D1 unavailable 且有 T03 P0：技術區保留問題數、其他區未檢查並顯示 P0–P3 行', () => {
  const t03 = {
    id: 'T03',
    code: 'googlebot_blocked_home',
    section: 'tech',
    severity: 'P0',
    evidence: 'verified',
    title: 'robots.txt 封鎖 Googlebot',
    summary: 'robots.txt 宣告禁止 Googlebot 讀取。',
    why: '',
    fix: '',
    urls: ['https://example.com/'],
    count: 1,
    data: {},
    sources: [],
    scored: true,
  };
  const document = reportDocument([t03], {
    score: null,
    raw: 70,
    grade: 'red',
    capped: false,
    scoreStatus: 'unavailable',
    counts: { ...ZERO_COUNTS, P0: 1 },
  }, { status: 'failed', defects: true, reasons: ['home_unavailable'] });

  assert.deepEqual(summaryLabels(document), ['1 個計分問題', '未檢查', '未檢查']);
  assert.deepEqual(severityCountLines(document), ['P0 1　P1 0　P2 0　P3 0']);
});

test('D1 sample_only 且無 Finding：三區塊與 P0–P3 行維持原有零值顯示', () => {
  const document = reportDocument([], {
    score: 100,
    raw: 100,
    grade: 'green',
    capped: false,
    scoreStatus: 'sample_only',
    counts: ZERO_COUNTS,
  }, { status: 'partial', defects: false, reasons: ['page_limit'] });

  assert.deepEqual(summaryLabels(document), ['0 個計分問題', '0 個計分問題', '0 個計分問題']);
  assert.deepEqual(severityCountLines(document), ['P0 0　P1 0　P2 0　P3 0']);
});
