// SPEC-002 §1.2 / §10 N01 — Content-Signal lines in robots.txt (parseRobots.contentSignals) and finding G12
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, rulesFor, explain, isAllowed } from '../public/core/robots.js';
import { SOURCES } from '../public/core/sources.js';
import { cached } from './helpers/report_v19.mjs';
import * as V from './helpers/scenarios_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import { G12 } from './helpers/copy_v19.mjs';

const WITH = 'User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\n';
const WITHOUT = 'User-agent: *\nAllow: /\n';

test('N01 Content-Signal inside the * group: one allow rule, one contentSignals entry with the parsed keys', () => {
  const p = parseRobots(WITH);
  assert.equal(p.overflow, false);
  assert.equal(p.groups.length, 1);
  assert.deepEqual(p.groups[0].rules, [{ allow: true, path: '/' }]);
  assert.deepEqual(p.contentSignals, [{ agents: ['*'], search: 'yes', aiInput: null, aiTrain: 'no', raw: 'search=yes, ai-train=no' }]);
});

test('N01 contentSignals is always an array (empty when robots.txt has no Content-Signal line)', () => {
  const p = parseRobots(WITHOUT);
  assert.ok(Array.isArray(p.contentSignals));
  assert.equal(p.contentSignals.length, 0);
  assert.deepEqual(parseRobots('').contentSignals, []);
});

test('N01 a Content-Signal line before the first user-agent is ignored', () => {
  const p = parseRobots('Content-Signal: search=yes\nUser-agent: *\nDisallow: /x\n');
  assert.deepEqual(p.contentSignals, []);
  assert.equal(isAllowed(p, 'googlebot', '/x'), false);
  assert.deepEqual(parseRobots('Content-Signal: ai-train=no\n').contentSignals, []);
});

test('N01 Content-Signal: foo=bar -> one entry with three null values and raw kept', () => {
  const p = parseRobots('User-agent: *\nContent-Signal: foo=bar\nDisallow:\n');
  assert.deepEqual(p.contentSignals, [{ agents: ['*'], search: null, aiInput: null, aiTrain: null, raw: 'foo=bar' }]);
});

test('N01 field name, keys and values are case-insensitive and trimmed; unknown keys/values ignored', () => {
  const p = parseRobots('User-agent: GPTBot\nCONTENT-SIGNAL:  Search = YES , AI-Input=No , ai-train=maybe, extra=1 \nDisallow: /\n');
  assert.equal(p.contentSignals.length, 1);
  const cs = p.contentSignals[0];
  assert.deepEqual(cs.agents, ['gptbot']);
  assert.equal(cs.search, 'yes');
  assert.equal(cs.aiInput, 'no');
  assert.equal(cs.aiTrain, null, 'ai-train=maybe is not yes/no');
  assert.equal(cs.raw, 'Search = YES , AI-Input=No , ai-train=maybe, extra=1');
});

test('N01 every Content-Signal line is one entry, in file order', () => {
  const p = parseRobots('User-agent: a\nContent-Signal: search=no\nContent-Signal: ai-train=no\nDisallow: /a\n\nUser-agent: b\nContent-Signal: ai-input=yes\nDisallow: /b\n');
  assert.equal(p.contentSignals.length, 3);
  assert.deepEqual(p.contentSignals.map((c) => c.raw), ['search=no', 'ai-train=no', 'ai-input=yes']);
  assert.deepEqual(p.contentSignals[0].agents, ['a']);
  assert.deepEqual(p.contentSignals[1].agents, ['a']);
  assert.deepEqual(p.contentSignals[2].agents, ['b']);
  assert.equal(p.contentSignals[2].aiInput, 'yes');
});

test('N01 Content-Signal does not end the group and is not a rule: a later user-agent still joins the group, agents are the final group agents', () => {
  const p = parseRobots('User-agent: a\nContent-Signal: search=yes\nUser-agent: b\nDisallow: /x\n');
  assert.equal(p.groups.length, 1);
  assert.deepEqual(p.contentSignals[0].agents, ['a', 'b']);
  assert.equal(isAllowed(p, 'a', '/x'), false);
  assert.equal(isAllowed(p, 'b', '/x'), false);
  assert.deepEqual(rulesFor(p, 'b').rules, [{ allow: false, path: '/x' }]);
});

test('N01 rulesFor / explain / groups[].rules are identical with and without the Content-Signal line', () => {
  const a = parseRobots(WITH);
  const b = parseRobots(WITHOUT);
  for (const token of ['googlebot', 'gptbot', 'kinsuiseocheck', '*']) {
    assert.deepEqual(rulesFor(a, token), rulesFor(b, token), token);
    for (const path of ['/', '/x', '/robots.txt', '/a/b?c=1']) assert.deepEqual(explain(a, token, path), explain(b, token, path), `${token} ${path}`);
  }
  assert.deepEqual(a.groups.map((g) => g.rules), b.groups.map((g) => g.rules));
  assert.deepEqual(a.sitemaps, b.sitemaps);
  assert.equal(a.overflow, b.overflow);
});

// ------------------------------------------------------------------ G12 (whole-site)
function expectedG12Summary(list) {
  return G12.summary.replace('{list}', list);
}

test('N01 G12 appears as geo / INFO / verified with count 1, data.signals, urls [robots.url], source content-signals; summary verbatim', async () => {
  const r = await cached('contentSignalSite', V.contentSignalSite);
  assert.ok(r.ids.includes('G12'), 'G12 present: ' + r.ids.join(','));
  const g = r.byId.G12;
  assert.equal(g.code, 'content_signal');
  assert.equal(g.section, 'geo');
  assert.equal(g.severity, 'INFO');
  assert.equal(g.evidence, 'verified');
  assert.equal(g.scored, false);
  assert.equal(g.count, 1);
  assert.equal(g.title, G12.title);
  assert.equal(g.summary, expectedG12Summary('search=yes, ai-train=no（適用 *）'));
  assert.ok(g.summary.includes('search=yes, ai-train=no（適用 *）'));
  assert.deepEqual(g.urls, [r.snapshot.robots.url]);
  assert.deepEqual(g.data.signals, r.snapshot.robots.parsed.contentSignals);
  assert.deepEqual(g.data.signals, [{ agents: ['*'], search: 'yes', aiInput: null, aiTrain: 'no', raw: 'search=yes, ai-train=no' }]);
  assert.ok(g.sources.includes('content-signals'));
  assert.ok(SOURCES['content-signals'], 'content-signals is a SOURCES id');
  // the Content-Signal line changes nothing else about the healthy site
  const base = await cached('s01', S.s01);
  assert.deepEqual(r.ids.filter((x) => x !== 'G12'), base.ids);
  assert.equal(r.score.score, base.score.score);
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'allow_all');
});

test('N01 two Content-Signal lines -> count 2; the list joins each line with 「、」 and agents with ", "', async () => {
  const r = await cached('contentSignalTwoLines', V.contentSignalTwoLines);
  assert.ok(r.ids.includes('G12'));
  const g = r.byId.G12;
  assert.equal(g.count, 2);
  assert.equal(g.data.signals.length, 2);
  assert.deepEqual(g.data.signals[0].agents, ['gptbot', 'claudebot']);
  assert.equal(g.summary, expectedG12Summary('ai-train=no（適用 gptbot, claudebot）、search=yes, ai-train=no（適用 *）'));
  // G03 is still produced from the Disallow rules (Content-Signal does not touch rules)
  assert.ok(r.ids.includes('G03'));
});

test('N01 no Content-Signal line -> no G12 (S01, S04, robots 404)', async () => {
  for (const [name, b] of [['s01', S.s01], ['s04', S.s04], ['robots404', S.robots404]]) {
    const r = await cached(name, b);
    assert.ok(!r.ids.includes('G12'), name);
  }
});

test('N01 G12 also runs when the home page is not analyzable (home 503)', async () => {
  const r = await cached('contentSignalHome503', V.contentSignalHome503);
  assert.equal(r.snapshot.homeAnalyzable, false);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(r.ids.includes('G12'), r.ids.join(','));
  assert.equal(r.byId.G12.count, 1);
});
