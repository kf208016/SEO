// SPEC-001 §9 fixed copy of findings, used verbatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from './helpers/pipeline.mjs';
import * as S from './helpers/scenarios.mjs';
import { COPY, splitTemplate } from './helpers/copy.mjs';

async function go(builder) {
  const sc = builder();
  return runPipeline(sc.site, sc.start);
}

function assertTokensSummary(summary, template, tokens) {
  const [pre, post] = splitTemplate(template, 'tokens');
  assert.ok(summary.startsWith(pre), `summary starts with "${pre}": ${summary}`);
  assert.ok(summary.endsWith(post), `summary ends with the fixed tail: ${summary}`);
  const middle = summary.slice(pre.length, summary.length - post.length);
  for (const t of tokens) assert.ok(middle.includes(t), `tokens part contains ${t}: ${middle}`);
}

test('T02 copy (robots 503)', async () => {
  const r = await go(S.s07);
  assert.equal(r.byId.T02.title, COPY.T02.title);
  assert.equal(r.byId.T02.summary, COPY.T02.summary.replace('{status}', '503'));
  assert.ok(r.byId.T02.summary.includes('若 Google 也收到相同回應'));
});

test('T03 copy', async () => {
  const r = await go(S.s02);
  assert.equal(r.byId.T03.title, COPY.T03.title);
  assert.equal(r.byId.T03.summary, COPY.T03.summary);
  assert.equal(r.byId.T03.fix, COPY.T03.fix);
});

test('T04 copy', async () => {
  const r = await go(S.s03);
  assert.equal(r.byId.T04.title, COPY.T04.title);
  assert.equal(r.byId.T04.summary, COPY.T04.summary);
  assert.equal(r.byId.T04.fix, COPY.T04.fix);
});

test('T11 copy', async () => {
  const r = await go(S.s08);
  assert.equal(r.byId.T11.title, COPY.T11.title);
  assert.equal(r.byId.T11.summary, COPY.T11.summary);
});

test('T16 fix ends with the fixed sentence', async () => {
  const r = await go(S.s06);
  assert.ok(r.byId.T16.fix.endsWith(COPY.T16.fixEnd), r.byId.T16.fix);
});

test('T18 copy', async () => {
  const r = await go(S.s16);
  assert.equal(r.byId.T18.title, COPY.T18.title);
  assert.equal(r.byId.T18.summary, COPY.T18.summary);
});

test('T22 copy', async () => {
  const r = await go(S.robots404);
  assert.equal(r.byId.T22.title, COPY.T22.title);
  assert.equal(r.byId.T22.summary, COPY.T22.summary);
});

test('G01 and G03 copy with {tokens}', async () => {
  const r = await go(S.s04);
  assert.equal(r.byId.G01.title, COPY.G01.title);
  assertTokensSummary(r.byId.G01.summary, COPY.G01.summary, ['OAI-SearchBot', 'PerplexityBot']);
  assert.equal(r.byId.G03.title, COPY.G03.title);
  assertTokensSummary(r.byId.G03.summary, COPY.G03.summary, ['GPTBot', 'ClaudeBot']);
});

test('G02 copy', async () => {
  const r = await go(S.s11);
  assert.equal(r.byId.G02.title, COPY.G02.title);
  assert.equal(r.byId.G02.summary, COPY.G02.summary);
});

test('G04 copy with {tokens}', async () => {
  const r = await go(S.userFetchBlocked);
  assertTokensSummary(r.byId.G04.summary, COPY.G04.summary, ['ChatGPT-User']);
});

test('G05, C11, C12 copy', async () => {
  const r = await go(S.s06);
  assert.equal(r.byId.G05.title, COPY.G05.title);
  assert.equal(r.byId.G05.summary, COPY.G05.summary);
  assert.equal(r.byId.C11.title, COPY.C11.title);
  assert.equal(r.byId.C12.title, COPY.C12.title);
  assert.equal(r.byId.C12.summary, COPY.C12.summary);
});

test('G06 copy', async () => {
  const r = await go(S.s05);
  assert.equal(r.byId.G06.title, COPY.G06.title);
  assert.equal(r.byId.G06.summary, COPY.G06.summary);
});

test('G07 copy', async () => {
  const r = await go(S.noOrgSchema);
  assert.equal(r.byId.G07.summary, COPY.G07.summary);
});
