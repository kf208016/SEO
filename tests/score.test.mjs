// SPEC-001 §7 score.js — K01–K09
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from '../public/core/score.js';

let n = 0;
const f = (severity) => ({ id: `X${String(++n).padStart(2, '0')}`, code: 'x', section: 'tech', severity, scored: severity !== 'INFO', urls: [], count: 1, sources: [] });
const many = (sev, k) => Array.from({ length: k }, () => f(sev));
const COMPLETE = { status: 'complete', reasons: [], defects: false };

test('K01 no findings, complete -> 100, green, valid', () => {
  const s = computeScore([], COMPLETE);
  assert.equal(s.score, 100);
  assert.equal(s.raw, 100);
  assert.equal(s.grade, 'green');
  assert.equal(s.scoreStatus, 'valid');
  assert.equal(s.capped, false);
});

test('K02 one P0 -> raw 70, score 40, capped, red', () => {
  const s = computeScore([f('P0')], COMPLETE);
  assert.equal(s.raw, 70);
  assert.equal(s.score, 40);
  assert.equal(s.capped, true);
  assert.equal(s.grade, 'red');
});

test('K03 two P0 -> raw 40, score 40, not capped, red', () => {
  const s = computeScore(many('P0', 2), COMPLETE);
  assert.equal(s.raw, 40);
  assert.equal(s.score, 40);
  assert.equal(s.capped, false);
  assert.equal(s.grade, 'red');
});

test('K04 2×P1 + 3×P2 + 5×P3 -> raw 63, score 63, yellow', () => {
  const s = computeScore([...many('P1', 2), ...many('P2', 3), ...many('P3', 5)], COMPLETE);
  assert.equal(s.raw, 63);
  assert.equal(s.score, 63);
  assert.equal(s.capped, false);
  assert.equal(s.grade, 'yellow');
});

test('K05 one P1 -> raw 90, score 79, capped, yellow', () => {
  const s = computeScore([f('P1')], COMPLETE);
  assert.equal(s.raw, 90);
  assert.equal(s.score, 79);
  assert.equal(s.capped, true);
  assert.equal(s.grade, 'yellow');
});

test('K06 only INFO -> 100, green', () => {
  const s = computeScore(many('INFO', 7), COMPLETE);
  assert.equal(s.score, 100);
  assert.equal(s.grade, 'green');
  assert.equal(s.scoreStatus, 'valid');
});

test('K07 coverage failed -> score null, gray, unavailable', () => {
  const s = computeScore([], { status: 'failed', reasons: ['home_not_analyzable'], defects: true });
  assert.equal(s.score, null);
  assert.equal(s.grade, 'gray');
  assert.equal(s.scoreStatus, 'unavailable');
});

test('K08 partial with only page_limit (no defects), no findings -> 100, green, sample_only', () => {
  const s = computeScore([], { status: 'partial', reasons: ['page_limit'], defects: false });
  assert.equal(s.score, 100);
  assert.equal(s.grade, 'green');
  assert.equal(s.scoreStatus, 'sample_only');
});

test('K09 partial with fetch_errors (defects), no findings -> 100, yellow, sample_only', () => {
  const s = computeScore([], { status: 'partial', reasons: ['fetch_errors'], defects: true });
  assert.equal(s.score, 100);
  assert.equal(s.grade, 'yellow');
  assert.equal(s.scoreStatus, 'sample_only');
});

test('K extra: P0 wins over gray when coverage failed (red, score null)', () => {
  const s = computeScore([f('P0')], { status: 'failed', reasons: ['blocked_for_tool'], defects: true });
  assert.equal(s.score, null);
  assert.equal(s.scoreStatus, 'unavailable');
  assert.equal(s.grade, 'red');
});

test('K extra: score < 60 without P0/P1 -> red; deductions per severity; floor at 0', () => {
  const s = computeScore(many('P2', 11), COMPLETE); // 100 - 44 = 56
  assert.equal(s.raw, 56);
  assert.equal(s.score, 56);
  assert.equal(s.grade, 'red');
  const t = computeScore(many('P3', 15), COMPLETE); // 85
  assert.equal(t.score, 85);
  assert.equal(t.grade, 'green');
  const u = computeScore(many('P3', 16), COMPLETE); // 84
  assert.equal(u.score, 84);
  assert.equal(u.grade, 'yellow');
  const z = computeScore(many('P0', 4), COMPLETE); // 100 - 120 -> 0
  assert.equal(z.raw, 0);
  assert.equal(z.score, 0);
  assert.equal(z.capped, false);
});

test('K extra: P1 cap does not raise a lower score', () => {
  const s = computeScore([...many('P1', 3), ...many('P2', 5)], COMPLETE); // 100 - 30 - 20 = 50
  assert.equal(s.raw, 50);
  assert.equal(s.score, 50);
  assert.equal(s.capped, false);
  assert.equal(s.grade, 'red');
});
