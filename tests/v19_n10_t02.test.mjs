// SPEC-002 §5.1 / §10 N10 — T02 becomes P1 / inferred with the new summary
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, reportOf } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as V from './helpers/scenarios_v19.mjs';
import { T02_SUMMARY } from './helpers/copy_v19.mjs';
import { COPY } from './helpers/copy.mjs';

test('N10 robots 503 (S07) -> T02 severity P1, evidence inferred, scored, count 1, title unchanged, summary new copy with 503', async () => {
  const r = await cached('s07', S.s07);
  assert.ok(r.ids.includes('T02'));
  const t = r.byId.T02;
  assert.equal(t.code, 'robots_server_error');
  assert.equal(t.section, 'tech');
  assert.equal(t.severity, 'P1');
  assert.equal(t.evidence, 'inferred');
  assert.equal(t.scored, true);
  assert.equal(t.count, 1);
  assert.equal(t.title, COPY.T02.title);
  assert.equal(t.title, 'robots.txt 讀取時伺服器出錯');
  assert.equal(t.summary, T02_SUMMARY.replace('{status}', '503'));
  assert.ok(t.summary.includes('503'));
  assert.ok(t.summary.includes('也可能是對不知名爬蟲的流量限制'));
  assert.ok(t.summary.includes('若 Google 也收到相同回應'));
  assert.ok(t.sources.includes('google-robots'));
  assert.ok(!r.findings.some((f) => f.severity === 'P0'), 'no P0 any more');
});

test('N10 coverage failed, score null / unavailable; grade follows the P1 (not red-by-P0)', async () => {
  const r = await cached('s07', S.s07);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.equal(r.score.score, null);
  assert.equal(r.score.scoreStatus, 'unavailable');
  assert.notEqual(r.score.grade, 'red', 'a P1 alone is not red; unavailable without P0 is gray');
  assert.equal(r.score.grade, 'gray');
  assert.ok(!r.site.requested('https://a.com/', 'page'));
});

test('N10 report: tech tile shows 1 個計分問題, the other two 未檢查; T02 card shows 高 / 推論 and the new summary', async () => {
  const r = await cached('s07', S.s07);
  for (const detail of [false, true]) {
    const { text } = reportOf(r, { detail });
    const label = `detail=${detail}`;
    assert.ok(/1\s*個計分問題/.test(text), label + ': 1 個計分問題');
    assert.ok(!/0\s*個計分問題/.test(text), label + ': no 0 個計分問題 when unavailable');
    assert.ok(text.includes('未檢查'), label + ': content / geo tiles 未檢查');
    assert.ok(text.includes(T02_SUMMARY.replace('{status}', '503')), label + ': new summary in the card');
    assert.ok(text.includes('推論'), label + ': evidence label 推論');
    assert.ok(text.includes('高'), label + ': severity label 高');
    assert.ok(!text.includes('阻斷'), label + ': no P0 label');
  }
});

test('N10 robots 429 -> T02 with 429 in the summary, still P1 / inferred; robots 503 behind cf-mitigated: challenge -> no T02', async () => {
  const r429 = await cached('robots429', V.robots429);
  assert.ok(r429.ids.includes('T02'));
  assert.equal(r429.byId.T02.severity, 'P1');
  assert.equal(r429.byId.T02.evidence, 'inferred');
  assert.equal(r429.byId.T02.summary, T02_SUMMARY.replace('{status}', '429'));
  const r = await cached('robotsChallenge503', S.robotsChallenge503);
  assert.ok(!r.ids.includes('T02'), 'accessBlocked robots never gives T02 (SPEC-001 §1.3)');
});
