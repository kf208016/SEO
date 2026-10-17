// SPEC-001 §5.4 robots.js — cases R01–R30 (R29 Worker/DO/frontend parts live in worker.test.mjs / scenarios.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRobots,
  normalizePath,
  matchRule,
  rulesFor,
  isAllowedByRules,
  explain,
  isAllowed,
  robotsPolicyForStatus,
  robotsPolicyFor,
  OUR_RULES_MAX,
} from '../public/core/robots.js';

const allowed = (txt, token, path, opts) => isAllowed(parseRobots(txt, opts), token, path);

test('R01 User-agent: * / Disallow: / blocks googlebot on /', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /\n', 'googlebot', '/'), false);
});

test('R02 Allow: /p beats Disallow: / for /page (longest match)', () => {
  assert.equal(allowed('User-agent: *\nAllow: /p\nDisallow: /\n', 'googlebot', '/page'), true);
});

test('R03 equal-length Allow and Disallow -> allow wins', () => {
  assert.equal(allowed('User-agent: *\nAllow: /folder\nDisallow: /folder\n', 'x', '/folder/page'), true);
});

test('R04 Disallow: /*.htm (longer) beats Allow: /page for /page.htm', () => {
  assert.equal(allowed('User-agent: *\nAllow: /page\nDisallow: /*.htm\n', 'x', '/page.htm'), false);
});

test('R05 Allow: /$ + Disallow: / -> / allowed, /page.htm blocked', () => {
  const txt = 'User-agent: *\nAllow: /$\nDisallow: /\n';
  assert.equal(allowed(txt, 'x', '/'), true);
  assert.equal(allowed(txt, 'x', '/page.htm'), false);
});

test('R06 empty Disallow allows everything', () => {
  assert.equal(allowed('User-agent: *\nDisallow:\n', 'x', '/anything'), true);
});

test('R07 two separate GPTBot groups are merged', () => {
  const txt = 'User-agent: GPTBot\nDisallow: /a\n\nUser-agent: Other\nDisallow: /z\n\nUser-agent: GPTBot\nDisallow: /b\n';
  assert.equal(allowed(txt, 'gptbot', '/a'), false);
  assert.equal(allowed(txt, 'gptbot', '/b'), false);
  assert.equal(allowed(txt, 'gptbot', '/z'), true);
});

test('R08 * blocks all, Googlebot Allow: / -> googlebot allowed, gptbot blocked (no merge with *)', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n';
  assert.equal(allowed(txt, 'googlebot', '/page'), true);
  assert.equal(allowed(txt, 'gptbot', '/page'), false);
});

test('R09 googlebot-image falls back to the googlebot group', () => {
  const txt = 'User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /x\n';
  assert.equal(allowed(txt, 'googlebot-image', '/x'), false);
  // googlebot-news / googlebot-video too
  assert.equal(allowed(txt, 'googlebot-news', '/x'), false);
  assert.equal(allowed(txt, 'googlebot-video', '/x'), false);
});

test('R09b googlebot-image uses its own group when present; * when neither exists', () => {
  const own = 'User-agent: Googlebot\nDisallow: /g\n\nUser-agent: Googlebot-Image\nDisallow: /i\n';
  assert.equal(allowed(own, 'googlebot-image', '/i'), false);
  assert.equal(allowed(own, 'googlebot-image', '/g'), true);
  const star = 'User-agent: *\nDisallow: /s\n';
  assert.equal(allowed(star, 'googlebot-image', '/s'), false);
});

test('R10 consecutive user-agent lines form one group', () => {
  const txt = 'User-agent: a\nUser-agent: b\nDisallow: /x\n';
  assert.equal(allowed(txt, 'b', '/x'), false);
  assert.equal(allowed(txt, 'a', '/x'), false);
});

test('R10b a user-agent after rules starts a new group', () => {
  const txt = 'User-agent: a\nDisallow: /x\nUser-agent: b\nDisallow: /y\n';
  assert.equal(allowed(txt, 'a', '/y'), true);
  assert.equal(allowed(txt, 'a', '/x'), false);
  assert.equal(allowed(txt, 'b', '/x'), true);
  assert.equal(allowed(txt, 'b', '/y'), false);
});

test('R11 upper-case fields and UA, comments, BOM, CRLF', () => {
  const txt = '﻿# leading comment\r\nUSER-AGENT: GOOGLEBOT # the bot\r\nDISALLOW: /x # no x\r\n';
  assert.equal(allowed(txt, 'googlebot', '/x'), false);
  assert.equal(allowed(txt, 'googlebot', '/y'), true);
  // bare CR line breaks
  assert.equal(allowed('User-agent: googlebot\rDisallow: /x\r', 'googlebot', '/x'), false);
});

test('R12 Disallow: /*.pdf$ -> /a.pdf blocked, /a.pdf?x=1 allowed', () => {
  const txt = 'User-agent: *\nDisallow: /*.pdf$\n';
  assert.equal(allowed(txt, 'x', '/a.pdf'), false);
  assert.equal(allowed(txt, 'x', '/a.pdf?x=1'), true);
});

test('R13 paths are case sensitive', () => {
  const txt = 'User-agent: *\nDisallow: /Page\n';
  assert.equal(allowed(txt, 'x', '/page'), true);
  assert.equal(allowed(txt, 'x', '/Page'), false);
});

test('R14 rules before any user-agent are ignored', () => {
  const txt = 'Disallow: /x\nUser-agent: *\nDisallow: /y\n';
  assert.equal(allowed(txt, 'x', '/x'), true);
  assert.equal(allowed(txt, 'x', '/y'), false);
  assert.equal(allowed('Disallow: /\n', 'x', '/anything'), true);
});

test('R15 /robots.txt itself is always allowed', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /\n', 'x', '/robots.txt'), true);
});

test('R16 user-agent product token stops at the first non [a-z0-9_-] char', () => {
  assert.equal(allowed('User-agent: GPTBot/1.1\nDisallow: /\n', 'gptbot', '/'), false);
});

test('R17 Disallow: /fish prefix semantics', () => {
  const txt = 'User-agent: *\nDisallow: /fish\n';
  for (const p of ['/fish.html', '/fishheads', '/fish.php?id=1']) assert.equal(allowed(txt, 'x', p), false, p);
  for (const p of ['/Fish.asp', '/catfish', '/?id=fish']) assert.equal(allowed(txt, 'x', p), true, p);
});

test('R18 Disallow: /fish/', () => {
  const txt = 'User-agent: *\nDisallow: /fish/\n';
  assert.equal(allowed(txt, 'x', '/fish/salmon.htm'), false);
  assert.equal(allowed(txt, 'x', '/fish'), true);
  assert.equal(allowed(txt, 'x', '/fish.html'), true);
});

test('R19 Disallow: /fish*.php', () => {
  const txt = 'User-agent: *\nDisallow: /fish*.php\n';
  assert.equal(allowed(txt, 'x', '/fishheads/catfish.php?p=1'), false);
  assert.equal(allowed(txt, 'x', '/Fish.PHP'), true);
});

test('R20 Sitemap line inside a group does not end the group; sitemaps collected', () => {
  const txt = 'User-agent: Googlebot\nSitemap: https://a.com/sitemap.xml\nDisallow: /x\n';
  const parsed = parseRobots(txt);
  assert.equal(isAllowed(parsed, 'googlebot', '/x'), false);
  assert.ok(Array.isArray(parsed.sitemaps));
  assert.ok(parsed.sitemaps.includes('https://a.com/sitemap.xml'));
});

test('R21 non-ASCII rule matches both encoded and raw paths', () => {
  const txt = 'User-agent: *\nDisallow: /產品\n';
  assert.equal(allowed(txt, 'x', '/%E7%94%A2%E5%93%81/a'), false);
  assert.equal(allowed(txt, 'x', '/產品/a'), false);
  assert.equal(allowed(txt, 'x', '/%e7%94%a2%e5%93%81/a'), false);
});

test('R22 robotsPolicyForStatus', () => {
  assert.equal(robotsPolicyForStatus(200), 'parse');
  assert.equal(robotsPolicyForStatus(204), 'parse');
  assert.equal(robotsPolicyForStatus(404), 'allow_all');
  assert.equal(robotsPolicyForStatus(403), 'allow_all');
  assert.equal(robotsPolicyForStatus(410), 'allow_all');
  assert.equal(robotsPolicyForStatus(429), 'disallow_all');
  assert.equal(robotsPolicyForStatus(503), 'disallow_all');
  assert.equal(robotsPolicyForStatus(500), 'disallow_all');
  assert.equal(robotsPolicyForStatus(0), 'disallow_all');
  assert.equal(robotsPolicyForStatus(null), 'disallow_all');
});

test('R23 percent-encoding normalisation', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /foo%62ar\n', 'x', '/foobar'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /a%2fb\n', 'x', '/a%2Fb'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /a%2Fb\n', 'x', '/a/b'), true);
});

test('R24 %2A stays a literal (not a wildcard)', () => {
  const txt = 'User-agent: *\nDisallow: /a%2A\n';
  assert.equal(allowed(txt, 'x', '/a%2A'), false);
  assert.equal(allowed(txt, 'x', '/abc'), true);
});

test('R25 truncated:true drops the last line', () => {
  const txt = 'User-agent: *\nDisallow: /a\nDisallow: /b';
  assert.equal(allowed(txt, 'x', '/b'), false);
  assert.equal(allowed(txt, 'x', '/b', { truncated: true }), true);
  assert.equal(allowed(txt, 'x', '/a', { truncated: true }), false);
});

test('R26 10,000 rules with 5 "*" each + 2,048-char path: explain finishes within 2 s', () => {
  const lines = ['User-agent: *'];
  for (let i = 0; i < 10000; i++) lines.push(`Disallow: /*a*a*a*a*b${i}`);
  const parsed = parseRobots(lines.join('\n'));
  assert.equal(parsed.overflow, false);
  const path = '/' + 'a'.repeat(2047);
  assert.equal(path.length, 2048);
  const t0 = performance.now();
  const r = explain(parsed, 'x', path);
  const dt = performance.now() - t0;
  assert.equal(r.allowed, true);
  assert.ok(dt < 2000, `explain took ${dt} ms`);
});

test('R27 robotsPolicyFor', () => {
  const base = {
    status: 200,
    finalUrl: 'https://a.com/robots.txt',
    location: null,
    chain: [],
    stop: null,
    error: null,
    bodyLimit: 512000,
    skipped: null,
    truncated: false,
    accessBlocked: false,
    truncatedHeaders: false,
    headers: { 'content-type': 'text/plain', 'x-robots-tag': null, 'content-length': '1', 'cf-mitigated': null },
    ourPolicy: null,
    bytes: new Uint8Array([65]),
  };
  assert.equal(robotsPolicyFor({ ...base, status: 403, accessBlocked: true }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, status: 503, accessBlocked: true, headers: { ...base.headers, 'cf-mitigated': 'challenge' } }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, status: 0, error: 'network', bytes: null }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, status: 200, error: 'stream_error', bytes: null }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, bytes: null }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, skipped: 'non_text', bytes: null }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, stop: 'loop' }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, status: 301, stop: 'offsite', bytes: null, skipped: 'redirect' }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, status: 301, bytes: null, skipped: 'redirect', location: 'https://a.com/x' }), 'unknown');
  assert.equal(robotsPolicyFor({ ...base, status: 404 }), 'allow_all');
  // extras following the same rule
  assert.equal(robotsPolicyFor({ ...base }), 'parse');
  assert.equal(robotsPolicyFor({ ...base, bytes: new Uint8Array(0) }), 'parse');
  assert.equal(robotsPolicyFor({ ...base, status: 503 }), 'disallow_all');
  assert.equal(robotsPolicyFor({ ...base, status: 429 }), 'disallow_all');
});

test('R28 matchRule wildcard and anchor semantics', () => {
  assert.equal(matchRule('/a*b*c$', '/aXbYc'), true);
  assert.equal(matchRule('/a*b*c$', '/aXbYcZ'), false);
  for (const p of ['/', '/x', '/a/b/c?d=1', '/%E7%94%A2']) assert.equal(matchRule('/*', p), true, p);
  assert.equal(matchRule('/$', '/'), true);
  assert.equal(matchRule('/$', '/a'), false);
  assert.equal(matchRule('/$', '/?q=1'), false);
  assert.equal(matchRule('/a$b', '/a$b'), true);
  assert.equal(matchRule('/a$b', '/a$bc'), true);
  assert.equal(matchRule('/a$b', '/a'), false);
  assert.equal(matchRule('/a$b', '/ab'), false);
});

test('R28b matchRule: plain prefix, repeated stars, trailing star with anchor', () => {
  assert.equal(matchRule('/fish', '/fish.html'), true);
  assert.equal(matchRule('/fish', '/catfish'), false);
  assert.equal(matchRule('/a**b', '/aXXb'), true);
  assert.equal(matchRule('/a*$', '/a'), true);
  assert.equal(matchRule('/a*$', '/abc'), true);
  assert.equal(matchRule('/abc$', '/abc'), true);
  assert.equal(matchRule('/abc$', '/abcd'), false);
  assert.equal(matchRule('/*.php$', '/x.php'), true);
  assert.equal(matchRule('/*.php$', '/x.php5'), false);
  assert.equal(matchRule('/*.php$', '/a.php/b.php'), true);
});

test('R29 single rule of 2,001 chars is ignored and sets overflow', () => {
  const long = '/' + 'a'.repeat(2000); // 2,001 chars
  const parsed = parseRobots(`User-agent: *\nDisallow: ${long}\n`);
  assert.equal(parsed.overflow, true);
  assert.equal(isAllowed(parsed, 'x', long), true);
  // boundary: exactly 2,000 chars is kept
  const ok = '/' + 'a'.repeat(1999);
  const p2 = parseRobots(`User-agent: *\nDisallow: ${ok}\n`);
  assert.equal(p2.overflow, false);
  assert.equal(isAllowed(p2, 'x', ok), false);
});

test('R29 10,001 rules -> overflow true; 10,000 -> overflow false', () => {
  const mk = (n) => ['User-agent: *', ...Array.from({ length: n }, (_, i) => `Disallow: /p${i}`)].join('\n');
  assert.equal(parseRobots(mk(10001)).overflow, true);
  assert.equal(parseRobots(mk(10000)).overflow, false);
});

test('R29 our group with 1,001 rules parses without overflow but exceeds OUR_RULES_MAX', () => {
  assert.equal(OUR_RULES_MAX, 1000);
  const txt = ['User-agent: KinsuiSEOCheck', ...Array.from({ length: 1001 }, (_, i) => `Disallow: /r${i}`)].join('\n');
  const parsed = parseRobots(txt);
  assert.equal(parsed.overflow, false);
  assert.equal(rulesFor(parsed, 'kinsuiseocheck').rules.length, 1001);
  assert.ok(rulesFor(parsed, 'kinsuiseocheck').rules.length > OUR_RULES_MAX);
});

test('R30 rulesFor returns only the specific group when * and kinsuiseocheck both exist', () => {
  const txt = 'User-agent: *\nDisallow: /a\nDisallow: /b\n\nUser-agent: KinsuiSEOCheck\nDisallow: /c\n';
  const r = rulesFor(parseRobots(txt), 'kinsuiseocheck');
  assert.equal(r.agent, 'kinsuiseocheck');
  assert.equal(r.rules.length, 1);
  assert.equal(isAllowedByRules(r.rules, '/a'), true);
  assert.equal(isAllowedByRules(r.rules, '/b'), true);
  assert.equal(isAllowedByRules(r.rules, '/c'), false);
});

test('R30b rulesFor: no matching group and no * -> agent null, rules empty; * fallback', () => {
  const none = rulesFor(parseRobots('User-agent: other\nDisallow: /\n'), 'kinsuiseocheck');
  assert.equal(none.agent, null);
  assert.equal(none.rules.length, 0);
  const star = rulesFor(parseRobots('User-agent: *\nDisallow: /a\n'), 'kinsuiseocheck');
  assert.equal(star.agent, '*');
  assert.equal(star.rules.length, 1);
});

test('isAllowedByRules: longest match wins, equal length allow wins, no match allows', () => {
  const r = rulesFor(parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nAllow: /c\nDisallow: /c\n'), 'x').rules;
  assert.equal(isAllowedByRules(r, '/a/x'), false);
  assert.equal(isAllowedByRules(r, '/a/b/x'), true);
  assert.equal(isAllowedByRules(r, '/c'), true);
  assert.equal(isAllowedByRules(r, '/zzz'), true);
});

test('explain: null robots allows; returns { allowed, agent, rule }', () => {
  assert.equal(explain(null, 'googlebot', '/x').allowed, true);
  const e = explain(parseRobots('User-agent: *\nDisallow: /x\n'), 'googlebot', '/x/y');
  assert.equal(e.allowed, false);
  assert.ok('agent' in e && 'rule' in e);
  assert.equal(e.agent, '*');
  const ok = explain(parseRobots('User-agent: *\nDisallow: /x\n'), 'googlebot', '/y');
  assert.equal(ok.allowed, true);
});

test('normalizePath rules', () => {
  assert.equal(normalizePath('/foo%62ar'), '/foobar');
  assert.equal(normalizePath('/%7e%41'), '/~A');
  assert.equal(normalizePath('/a%2fb'), '/a%2Fb');
  assert.equal(normalizePath('/a%2a'), '/a%2A');
  assert.equal(normalizePath('/a%24'), '/a%24');
  assert.equal(normalizePath('/產品'), '/%E7%94%A2%E5%93%81');
  assert.equal(normalizePath('/%e7%94%a2'), '/%E7%94%A2');
  assert.equal(normalizePath('/%zz'), '/%zz');
  assert.equal(normalizePath('/a b'), '/a b');
  assert.equal(normalizePath('/a*b$'), '/a*b$');
});

test('parseRobots: empty user-agent value and lines without ":" are ignored', () => {
  const p = parseRobots('User-agent:\nDisallow: /x\nnonsense line\nUser-agent: *\nDisallow: /y\n');
  assert.equal(p.overflow, false);
  assert.equal(isAllowed(p, 'x', '/y'), false);
});

// ------------------------------------------------------------------ v1.5 A1: rule objects are { allow, path }
test('A1 rule objects are { allow: boolean, path } (normalised) in groups[].rules, rulesFor().rules and explain().rule', () => {
  const parsed = parseRobots('User-agent: *\nDisallow: /x\nAllow: /x/y\nDisallow: /產品\n');
  assert.ok(Array.isArray(parsed.groups));
  const all = parsed.groups.flatMap((g) => g.rules);
  assert.deepEqual(all, [
    { allow: false, path: '/x' },
    { allow: true, path: '/x/y' },
    { allow: false, path: '/%E7%94%A2%E5%93%81' },
  ]);
  assert.deepEqual(rulesFor(parsed, 'kinsuiseocheck').rules, all);
  assert.deepEqual(explain(parsed, 'googlebot', '/x/z').rule, { allow: false, path: '/x' });
  assert.deepEqual(explain(parsed, 'googlebot', '/x/y/z').rule, { allow: true, path: '/x/y' });
  // hand-built rule objects work with isAllowedByRules
  const rules = [{ allow: false, path: '/private' }, { allow: true, path: '/private/ok' }];
  assert.equal(isAllowedByRules(rules, '/private/x'), false);
  assert.equal(isAllowedByRules(rules, '/private/ok/1'), true);
  assert.equal(isAllowedByRules(rules, '/public'), true);
});

// ------------------------------------------------------------------ mutation gap RB14
test('RB14 each literal segment after a "*" must be found after the previous segment', () => {
  assert.equal(matchRule('/a*a', '/a'), false);
  assert.equal(matchRule('/a*a', '/aa'), true);
  assert.equal(matchRule('/a*a', '/aXa'), true);
  assert.equal(matchRule('/x*y*z', '/xzy'), false);
  assert.equal(matchRule('/x*y*z', '/xyz'), true);
  assert.equal(matchRule('/x*y*z', '/x-y-z-'), true);
  assert.equal(matchRule('/ab*b', '/ab'), false);
  assert.equal(matchRule('/a*a$', '/a'), false);
  assert.equal(matchRule('/*ab*ba$', '/aba'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /a*a\n', 'x', '/a'), true);
  assert.equal(allowed('User-agent: *\nDisallow: /x*y*z\n', 'x', '/xzy'), true);
  assert.equal(allowed('User-agent: *\nDisallow: /x*y*z\n', 'x', '/xyz'), false);
});
