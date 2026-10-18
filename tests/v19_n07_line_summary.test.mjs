// SPEC-002 §4.2 / §10 N07 — buildLineSummary and lineMessageUrl (pure functions in report.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineSummary, lineMessageUrl } from '../public/core/report.js';
import { cached } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import { LINE_ID } from './helpers/copy_v19.mjs';

const len = (s) => Array.from(s).length;
const snap = (host = 'a.com', reasons = []) => ({ siteHost: host, coverage: { status: reasons.length ? 'failed' : 'complete', reasons, defects: reasons.length > 0 } });
const score = (scoreStatus, score = 95) => ({ score: scoreStatus === 'unavailable' ? null : score, raw: score, grade: 'green', capped: false, scoreStatus, counts: {} });
const f = (id, severity) => ({ id, code: id.toLowerCase(), section: id[0] === 'C' ? 'content' : id[0] === 'G' ? 'geo' : 'tech', severity, evidence: 'verified', title: id, summary: '', urls: [], count: 1, data: {}, sources: [], scored: severity !== 'INFO' });
// already in severity -> id order, as runChecks returns them
const FINDINGS = [f('C02', 'P2'), f('G05', 'P2'), f('C04', 'P3'), f('C10', 'INFO')];

test('N07 valid 95 with C02(P2), G05(P2), C04(P3), C10(INFO) -> first three scored ids in order, INFO excluded', () => {
  assert.equal(buildLineSummary(snap(), FINDINGS, score('valid')), 'SEO健檢 a.com 技術健康分數95 待處理:C02,G05,C04');
});

test('N07 more than three scored findings -> only the first three', () => {
  const many = [f('T04', 'P0'), f('C01', 'P1'), f('T12', 'P1'), f('C02', 'P2'), f('C04', 'P3')];
  assert.equal(buildLineSummary(snap(), many, score('valid', 40)), 'SEO健檢 a.com 技術健康分數40 待處理:T04,C01,T12');
});

test('N07 sample_only -> 技術健康分數95(樣本)', () => {
  assert.equal(buildLineSummary(snap(), FINDINGS, score('sample_only')), 'SEO健檢 a.com 技術健康分數95(樣本) 待處理:C02,G05,C04');
  assert.equal(buildLineSummary(snap('goldwatersmartlink.com.tw'), [f('C02', 'P2'), f('C04', 'P3')], score('sample_only')), 'SEO健檢 goldwatersmartlink.com.tw 技術健康分數95(樣本) 待處理:C02,C04');
});

test('N07 no scored finding -> 「 無計分問題」 (INFO-only findings count as none)', () => {
  assert.equal(buildLineSummary(snap(), [], score('valid', 100)), 'SEO健檢 a.com 技術健康分數100 無計分問題');
  assert.equal(buildLineSummary(snap(), [f('C10', 'INFO'), f('G07', 'INFO')], score('valid', 100)), 'SEO健檢 a.com 技術健康分數100 無計分問題');
  assert.equal(buildLineSummary(snap(), [f('T18', 'INFO')], score('sample_only', 97)), 'SEO健檢 a.com 技術健康分數97(樣本) 無計分問題');
});

test('N07 unavailable -> 無法評分 原因:{reasons[0]}; no reason -> unknown', () => {
  assert.equal(buildLineSummary(snap('a.com', ['blocked_by_site']), [], score('unavailable')), 'SEO健檢 a.com 無法評分 原因:blocked_by_site');
  assert.equal(buildLineSummary(snap('homesales.com.tw', ['blocked_by_site']), [f('T29', 'INFO')], score('unavailable')), 'SEO健檢 homesales.com.tw 無法評分 原因:blocked_by_site');
  assert.equal(buildLineSummary(snap('a.com', ['robots_disallow_all', 'x']), [f('T03', 'P0')], score('unavailable')), 'SEO健檢 a.com 無法評分 原因:robots_disallow_all', 'first reason only, no 待處理 part when unavailable');
  assert.equal(buildLineSummary(snap('a.com', []), [], score('unavailable')), 'SEO健檢 a.com 無法評分 原因:unknown');
});

test('N07 the result is cut to 120 characters (Array.from) for a long host', () => {
  const host = 'a'.repeat(150) + '.com';
  const out = buildLineSummary(snap(host), FINDINGS, score('valid'));
  assert.ok(len(out) <= 120, 'length ' + len(out));
  assert.equal(len(out), 120);
  assert.ok(out.startsWith('SEO健檢 ' + 'a'.repeat(50)));
  const cjk = '中'.repeat(130) + '.tw';
  const out2 = buildLineSummary(snap(cjk), [], score('valid', 100));
  assert.equal(len(out2), 120, 'counted in code points, not UTF-16 units or bytes');
});

test('N07 summary has only host, score, finding ids and reason codes (no URL paths)', () => {
  // input already in severity -> id order (C01 before T12 within P1)
  const out = buildLineSummary(snap('a.com'), [f('C01', 'P1'), f('T12', 'P1')], score('valid', 70));
  assert.ok(!out.includes('/'), out);
  assert.ok(!out.includes('http'), out);
  assert.match(out, /^SEO健檢 a\.com 技術健康分數70 待處理:C01,T12$/);
});

test('N07 lineMessageUrl encodes the id (@ -> %40) and the summary', () => {
  assert.equal(lineMessageUrl('@760zrres', 'x y'), 'https://line.me/R/oaMessage/%40760zrres/?x%20y');
  const summary = 'SEO健檢 a.com 技術健康分數95(樣本) 待處理:C02,C04';
  const url = lineMessageUrl(LINE_ID, summary);
  assert.ok(url.startsWith('https://line.me/R/oaMessage/%40760zrres/?'), url);
  assert.equal(decodeURIComponent(url.slice('https://line.me/R/oaMessage/%40760zrres/?'.length)), summary);
  assert.equal(url, `https://line.me/R/oaMessage/${encodeURIComponent(LINE_ID)}/?${encodeURIComponent(summary)}`);
  const u = new URL(url);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.host, 'line.me');
  assert.equal(u.pathname, '/R/oaMessage/%40760zrres/');
  assert.ok(!url.includes(' '), 'spaces are percent-encoded');
});

test('N07 against real pipeline results (S01 valid, S13 sample_only, S02 unavailable)', async () => {
  const expected = (r) => {
    const host = r.snapshot.siteHost;
    if (r.score.scoreStatus === 'unavailable') return `SEO健檢 ${host} 無法評分 原因:${r.snapshot.coverage.reasons[0] || 'unknown'}`;
    const ids = r.findings.filter((x) => x.scored).slice(0, 3).map((x) => x.id);
    const part = ids.length ? ` 待處理:${ids.join(',')}` : ' 無計分問題';
    return Array.from(`SEO健檢 ${host} 技術健康分數${r.score.score}${r.score.scoreStatus === 'sample_only' ? '(樣本)' : ''}${part}`).slice(0, 120).join('');
  };
  for (const [name, b] of [['s01', S.s01], ['s13', S.s13], ['s02', S.s02], ['s06', S.s06], ['s14', S.s14]]) {
    const r = await cached(name, b);
    assert.equal(buildLineSummary(r.snapshot, r.findings, r.score), expected(r), name);
  }
  const s02 = await cached('s02', S.s02);
  assert.ok(buildLineSummary(s02.snapshot, s02.findings, s02.score).startsWith('SEO健檢 a.com 無法評分 原因:'));
  const s06 = await cached('s06', S.s06);
  assert.match(buildLineSummary(s06.snapshot, s06.findings, s06.score), /^SEO健檢 a\.com 技術健康分數\d+ 待處理:[A-Z]\d\d,[A-Z]\d\d,[A-Z]\d\d$/);
});
