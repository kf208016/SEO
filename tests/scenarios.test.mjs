// SPEC-001 §12.4 whole-site scenarios S01–S23 (+ R29 frontend part, finding invariants)
// fake fetchFn (tests/helpers/fakesite.mjs) -> runAudit -> runChecks -> computeScore -> botAccess
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, allStrings } from './helpers/pipeline.mjs';
import * as S from './helpers/scenarios.mjs';
import { SOURCES } from '../public/core/sources.js';
import { BOTS } from '../public/core/bots.js';
import { VERSION } from '../public/core/version.js';
import { SKIP_EXTENSIONS, CRAWL_LIMITS } from '../public/core/crawl.js';

const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, INFO: 4 };
const has = (r, id) => r.ids.includes(id);
const kinds = (site) => [...new Set(site.requests.map((q) => q.kind))];

async function go(builder) {
  const sc = builder();
  const r = await runPipeline(sc.site, sc.start);
  return { ...r, site: sc.site, sc };
}

// ------------------------------------------------------------------ finding table (§6.1) and sources (§9)
const TABLE = {
  T01: ['home_unreachable', 'tech', ['P0'], 'verified'],
  T02: ['robots_server_error', 'tech', ['P0'], 'verified'],
  T03: ['googlebot_blocked_home', 'tech', ['P0'], 'verified'],
  T04: ['home_noindex', 'tech', ['P0'], 'verified'],
  T05: ['many_noindex', 'tech', ['P2'], 'inferred'],
  T06: ['noindex_pages', 'tech', ['INFO'], 'verified'],
  T07: ['noindex_blocked_by_robots', 'tech', ['P2'], 'verified'],
  T08: ['no_https', 'tech', ['P1'], 'verified'],
  T09: ['http_not_redirected', 'tech', ['P2'], 'verified'],
  T11: ['random_path_2xx', 'tech', ['P3'], 'inferred'],
  T12: ['broken_internal', 'tech', ['P1', 'P2'], 'verified'],
  T13: ['fetch_errors', 'tech', ['INFO'], 'unverifiable'],
  T14: ['redirect_chain', 'tech', ['P2', 'P3'], 'verified'],
  T15: ['canonical_multiple', 'tech', ['P1'], 'verified'],
  T16: ['canonical_cross_domain', 'tech', ['P1', 'P2'], 'verified'],
  T17: ['canonical_to_bad', 'tech', ['P2'], 'verified'],
  T18: ['sitemap_missing', 'tech', ['INFO'], 'verified'],
  T19: ['sitemap_invalid', 'tech', ['P2'], 'verified'],
  T20: ['sitemap_bad_urls', 'tech', ['P2'], 'verified'],
  T21: ['sitemap_foreign_host', 'tech', ['P3'], 'unverifiable'],
  T22: ['robots_missing', 'tech', ['INFO'], 'verified'],
  T23: ['viewport_missing', 'tech', ['P2'], 'verified'],
  T24: ['lang_missing', 'tech', ['INFO'], 'verified'],
  T28: ['home_redirect_offsite', 'tech', ['INFO'], 'verified'],
  T29: ['home_unverifiable', 'tech', ['INFO'], 'unverifiable'],
  T30: ['canonical_missing', 'tech', ['INFO'], 'verified'],
  T31: ['canonical_http', 'tech', ['P2'], 'verified'],
  T33: ['meta_refresh', 'tech', ['P3'], 'verified'],
  T34: ['mixed_content', 'tech', ['P2'], 'verified'],
  T35: ['page_nofollow', 'tech', ['P3'], 'verified'],
  T36: ['multiple_title', 'tech', ['P3'], 'verified'],
  T37: ['sitemap_unverifiable', 'tech', ['INFO'], 'unverifiable'],
  T38: ['canonical_invalid', 'tech', ['P2'], 'verified'],
  T39: ['robots_truncated', 'tech', ['INFO'], 'verified'],
  C01: ['title_missing', 'content', ['P1'], 'verified'],
  C02: ['title_duplicate', 'content', ['P2'], 'verified'],
  C03: ['title_generic', 'content', ['P3'], 'inferred'],
  C04: ['meta_description_missing', 'content', ['P3'], 'verified'],
  C05: ['meta_description_duplicate', 'content', ['P3'], 'verified'],
  C06: ['h1_missing', 'content', ['P3'], 'verified'],
  C09: ['img_alt_missing', 'content', ['P3'], 'verified'],
  C10: ['og_missing', 'content', ['INFO'], 'verified'],
  C11: ['jsonld_invalid', 'content', ['P3'], 'verified'],
  C12: ['faq_schema', 'content', ['INFO'], 'verified'],
  G01: ['ai_search_blocked', 'geo', ['P2'], 'verified'],
  G02: ['bingbot_blocked', 'geo', ['P1'], 'verified'],
  G03: ['training_blocked', 'geo', ['INFO'], 'verified'],
  G04: ['user_fetch_blocked', 'geo', ['INFO'], 'verified'],
  G05: ['nosnippet', 'geo', ['P2'], 'verified'],
  G06: ['js_shell', 'geo', ['P3'], 'inferred'],
  G07: ['org_schema_missing', 'geo', ['INFO'], 'inferred'],
  G10: ['bing_noarchive', 'geo', ['INFO'], 'verified'],
  G11: ['partial_block', 'geo', ['INFO'], 'verified'],
};

const SRC = {};
const addSrc = (ids, srcs) => ids.forEach((id) => (SRC[id] = srcs));
addSrc(['T01', 'T11', 'T12', 'T13'], ['google-http-errors']);
addSrc(['T02', 'T03', 'T22', 'T39', 'G11'], ['google-robots']);
addSrc(['T04', 'T05', 'T06', 'T07', 'T35'], ['google-noindex']);
addSrc(['T15', 'T16', 'T17', 'T30', 'T31', 'T38'], ['google-canonical']);
addSrc(['T18', 'T19', 'T20', 'T21', 'T37'], ['google-sitemaps']);
addSrc(['T23'], ['google-mobile']);
addSrc(['C01', 'C02', 'C03', 'T36'], ['google-title']);
addSrc(['C04', 'C05'], ['google-snippet']);
addSrc(['G05'], ['google-snippet', 'google-ai-features']);
addSrc(['G06'], ['google-js-seo']);
addSrc(['C11', 'G07'], ['google-sd-policies']);
addSrc(['C12'], ['google-sd-policies', 'google-updates']);
addSrc(['G02', 'G10'], ['bing-chat-controls']);
addSrc(['T08', 'T09', 'T14', 'T28', 'T29', 'T33', 'T34', 'T24', 'C06', 'C09', 'C10'], ['google-starter']);

const BOT_SOURCE = Object.fromEntries(BOTS.map((b) => [b.token, b.source]));

function checkInvariants(findings, label) {
  const seen = new Set();
  for (const f of findings) {
    const where = `${label} ${f.id}`;
    assert.ok(!seen.has(f.id), `${where}: id appears more than once`);
    seen.add(f.id);
    const row = TABLE[f.id];
    assert.ok(row, `${where}: unknown finding id`);
    const [code, section, sevs, evidence] = row;
    assert.equal(f.code, code, `${where} code`);
    assert.equal(f.section, section, `${where} section`);
    assert.ok(sevs.includes(f.severity), `${where} severity ${f.severity}`);
    assert.equal(f.evidence, evidence, `${where} evidence`);
    assert.equal(f.scored, f.severity !== 'INFO', `${where} scored`);
    assert.ok(Array.isArray(f.urls), `${where} urls array`);
    assert.ok(f.urls.length <= 50, `${where} urls <= 50`);
    assert.equal(typeof f.count, 'number', `${where} count`);
    assert.equal(typeof f.title, 'string');
    assert.ok(f.title.length > 0, `${where} title`);
    assert.equal(typeof f.summary, 'string', `${where} summary`);
    assert.ok(Array.isArray(f.sources) && f.sources.length > 0, `${where} sources`);
    for (const s of f.sources) assert.ok(typeof s === 'string' && SOURCES[s], `${where} source ${s} must be a SOURCES id`);
    for (const s of SRC[f.id] || []) assert.ok(f.sources.includes(s), `${where} must cite ${s}`);
    if (['G01', 'G03', 'G04'].includes(f.id) && f.data && Array.isArray(f.data.tokens)) {
      for (const t of f.data.tokens) if (BOT_SOURCE[t]) assert.ok(f.sources.includes(BOT_SOURCE[t]), `${where} must cite ${BOT_SOURCE[t]} for ${t}`);
    }
  }
  for (let i = 1; i < findings.length; i++) {
    const a = findings[i - 1];
    const b = findings[i];
    const ok = SEV_RANK[a.severity] < SEV_RANK[b.severity] || (SEV_RANK[a.severity] === SEV_RANK[b.severity] && a.id < b.id);
    assert.ok(ok, `${label}: order ${a.severity}/${a.id} before ${b.severity}/${b.id}`);
  }
}

// ------------------------------------------------------------------ S01–S23
test('S01 healthy site: no P0–P2, score >= 85, green, valid; 8 pages crawled', async () => {
  const r = await go(S.s01);
  const bad = r.findings.filter((f) => ['P0', 'P1', 'P2'].includes(f.severity)).map((f) => f.id);
  assert.deepEqual(bad, []);
  assert.ok(r.score.score >= 85, `score ${r.score.score}`);
  assert.equal(r.score.grade, 'green');
  assert.equal(r.score.scoreStatus, 'valid');
  assert.equal(r.snapshot.coverage.status, 'complete');
  assert.deepEqual(r.snapshot.coverage.reasons, []);
  assert.equal(r.snapshot.coverage.defects, false);
  assert.equal(r.snapshot.limits.crawled, 8);
  assert.equal(r.snapshot.limits.maxPages, 15);
  assert.equal(r.snapshot.pages.length, 8);
  assert.equal(r.snapshot.homeAnalyzable, true);
  assert.equal(r.snapshot.version, VERSION);
  assert.equal(r.snapshot.siteHost, 'a.com');
  assert.equal(r.snapshot.origin, 'https://a.com');
  assert.equal(r.snapshot.home, 'https://a.com/');
  assert.equal(r.snapshot.scannedAt, '2026-10-17T10:03:04+08:00');
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'allow_all');
  assert.equal(r.snapshot.robotsInitial, null);
  assert.ok(r.snapshot.sitemaps.some((s) => s.url === 'https://a.com/sitemap.xml' && s.kind === 'urlset' && s.fallback === false));
  assert.equal(r.snapshot.sitemapUrls.length, 8);
  assert.equal(r.snapshot.probes.soft404.status, 404);
  assert.equal(r.snapshot.probes.http.status, 301);
  assert.deepEqual(r.site.violations, []);
  // first request is the robots.txt of the start origin
  assert.deepEqual(r.site.requests[0], { url: 'https://a.com/robots.txt', kind: 'robots' });
});

test('S02 robots "*" Disallow: / -> T03; only robots requests; coverage failed; score null; red', async () => {
  const r = await go(S.s02);
  assert.ok(has(r, 'T03'));
  assert.equal(r.byId.T03.severity, 'P0');
  assert.deepEqual(kinds(r.site), ['robots']);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.equal(r.snapshot.coverage.defects, true);
  assert.equal(r.snapshot.homeSkippedByRobots, true);
  assert.equal(r.score.score, null);
  assert.equal(r.score.scoreStatus, 'unavailable');
  assert.equal(r.score.grade, 'red');
  assert.deepEqual(r.site.violations, []);
});

test('S03 home noindex -> T04; score <= 40; red', async () => {
  const r = await go(S.s03);
  assert.ok(has(r, 'T04'));
  assert.equal(r.byId.T04.severity, 'P0');
  assert.ok(r.score.score !== null && r.score.score <= 40, `score ${r.score.score}`);
  assert.equal(r.score.grade, 'red');
});

test('S04 GPTBot, ClaudeBot, OAI-SearchBot, PerplexityBot blocked -> G01 and G03; no T03', async () => {
  const r = await go(S.s04);
  assert.ok(has(r, 'G01'));
  assert.ok(has(r, 'G03'));
  assert.ok(!has(r, 'T03'));
  for (const t of ['OAI-SearchBot', 'PerplexityBot']) assert.ok(r.byId.G01.data.tokens.includes(t), 'G01 ' + t);
  assert.ok(!r.byId.G01.data.tokens.includes('Claude-SearchBot'));
  for (const t of ['GPTBot', 'ClaudeBot']) assert.ok(r.byId.G03.data.tokens.includes(t), 'G03 ' + t);
  assert.equal(r.byId.G01.count, 2);
  assert.equal(r.byId.G03.count, 2);
  // botAccess rows: BOTS order, statuses
  assert.deepEqual(r.bots.map((b) => b.token), BOTS.map((b) => b.token));
  const st = Object.fromEntries(r.bots.map((b) => [b.token, b.status]));
  assert.equal(st.GPTBot, 'declared_disallowed');
  assert.equal(st.ClaudeBot, 'declared_disallowed');
  assert.equal(st['OAI-SearchBot'], 'declared_disallowed');
  assert.equal(st.PerplexityBot, 'declared_disallowed');
  assert.equal(st.Googlebot, 'declared_allowed');
  assert.equal(st['Claude-SearchBot'], 'declared_allowed');
  for (const b of r.bots) {
    const ref = BOTS.find((x) => x.token === b.token);
    assert.equal(b.company, ref.company);
    assert.equal(b.category, ref.category);
    assert.equal(b.purpose, ref.purpose);
    assert.equal(b.source, ref.source);
    assert.ok(Array.isArray(b.blockedUrls));
  }
});

test('S05 SPA shell (#root empty, external script) -> G06', async () => {
  const r = await go(S.s05);
  assert.ok(has(r, 'G06'));
  assert.equal(r.byId.G06.severity, 'P3');
  assert.ok(r.byId.G06.urls.includes('https://a.com/'));
});

test('S06 messy site -> C01 C02 C11 C12 T15 T16(home P1) C09 G05 T34 T36 T33 T38', async () => {
  const r = await go(S.s06);
  for (const id of ['C01', 'C02', 'C11', 'C12', 'T15', 'T16', 'C09', 'G05', 'T34', 'T36', 'T33', 'T38']) assert.ok(has(r, id), id);
  assert.equal(r.byId.T16.severity, 'P1');
  assert.ok(r.byId.T16.urls.includes('https://a.com/'));
  assert.ok(r.byId.C01.urls.includes('https://a.com/p1'));
  assert.ok(r.byId.C02.urls.includes('https://a.com/p2') && r.byId.C02.urls.includes('https://a.com/p3'));
  assert.equal(r.byId.C02.count, 2);
  assert.ok(r.byId.C02.data && Array.isArray(r.byId.C02.data.groups));
  assert.ok(r.byId.C11.urls.includes('https://a.com/p4'));
  assert.ok(r.byId.C12.urls.includes('https://a.com/p5'));
  assert.ok(r.byId.T15.urls.includes('https://a.com/p6'));
  assert.ok(r.byId.C09.urls.includes('https://a.com/p7'));
  assert.ok(r.byId.G05.urls.includes('https://a.com/p8'));
  assert.ok(r.byId.T34.urls.includes('https://a.com/p9'));
  assert.ok(r.byId.T36.urls.includes('https://a.com/p10'));
  assert.ok(r.byId.T33.urls.includes('https://a.com/p11'));
  assert.ok(r.byId.T38.urls.includes('https://a.com/p12'));
  assert.equal(r.snapshot.limits.crawled, 13);
});

test('S07 robots 503 -> T02; home not fetched; coverage failed', async () => {
  const r = await go(S.s07);
  assert.ok(has(r, 'T02'));
  assert.equal(r.byId.T02.severity, 'P0');
  assert.equal(r.byId.T02.evidence, 'verified');
  assert.equal(r.byId.T02.count, 1);
  assert.ok(!r.site.requested('https://a.com/', 'page'));
  assert.deepEqual(kinds(r.site), ['robots']);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.equal(r.score.grade, 'red');
});

test('S08 http version 200 -> T09; random URL 200 -> T11', async () => {
  const r = await go(S.s08);
  assert.ok(has(r, 'T09'));
  assert.ok(has(r, 'T11'));
  assert.equal(r.snapshot.probes.http.status, 200);
  assert.equal(r.snapshot.probes.soft404.status, 200);
  assert.match(r.snapshot.probes.soft404.url, /^https:\/\/a\.com\/seo-check-404-[0-9a-f]{8}$/);
  assert.equal(r.snapshot.probes.http.url, 'http://a.com/');
  // probes are kind probe and never follow redirects
  assert.ok(r.site.requested('http://a.com/', 'probe'));
  assert.ok(r.site.requested(r.snapshot.probes.soft404.url, 'probe'));
});

test('S09 home 301 to another domain -> T28; stoppedOffsite; coverage failed; other domain never requested', async () => {
  const r = await go(S.s09);
  assert.ok(has(r, 'T28'));
  assert.ok(!has(r, 'T01'));
  assert.equal(r.snapshot.stoppedOffsite, true);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(r.snapshot.coverage.reasons.includes('offsite'));
  assert.ok(!r.site.requests.some((q) => q.url.includes('b-other.com')));
  assert.equal(r.score.score, null);
  assert.equal(r.score.grade, 'gray');
  assert.deepEqual(r.site.violations, []);
});

test('S10 10 internal links, 6 return 404 -> T12 P1 with referrers pointing at the home page', async () => {
  const r = await go(S.s10);
  assert.ok(has(r, 'T12'));
  const t12 = r.byId.T12;
  assert.equal(t12.severity, 'P1');
  assert.equal(t12.count, 6);
  for (const p of S.S10_BROKEN) assert.ok(t12.urls.includes('https://a.com' + p), p);
  assert.ok(t12.data && t12.data.referrers, 'data.referrers');
  assert.ok(allStrings(t12.data.referrers).includes('https://a.com/'), 'referrers include the home page');
});

test('S11 Bingbot blocked -> G02; score <= 79', async () => {
  const r = await go(S.s11);
  assert.ok(has(r, 'G02'));
  assert.equal(r.byId.G02.severity, 'P1');
  assert.ok(r.score.score <= 79);
  assert.equal(r.bots.find((b) => b.token === 'Bingbot').status, 'declared_disallowed');
});

test('S13 home with 40 internal links -> crawled 15, notCrawled 26, sample_only, green', async () => {
  const r = await go(S.s13);
  assert.equal(r.snapshot.limits.crawled, 15);
  assert.equal(r.snapshot.pages.length, 15);
  assert.equal(r.snapshot.limits.notCrawled, 26);
  assert.equal(r.snapshot.coverage.status, 'partial');
  assert.ok(r.snapshot.coverage.reasons.includes('page_limit'));
  assert.equal(r.snapshot.coverage.defects, false);
  assert.equal(r.score.scoreStatus, 'sample_only');
  const bad = r.findings.filter((f) => ['P0', 'P1', 'P2'].includes(f.severity)).map((f) => f.id);
  assert.deepEqual(bad, []);
  assert.equal(r.score.grade, 'green');
  // crawl order: home, then links in document order
  assert.equal(r.snapshot.pages[0].url, 'https://a.com/');
  assert.equal(r.snapshot.pages[1].url, 'https://a.com/item-1');
  assert.equal(r.snapshot.pages[14].url, 'https://a.com/item-14');
  assert.equal(r.site.urls('page').length, 15);
});

test('S14 robots 403 + cf-mitigated: challenge -> policy unknown; home not fetched; T29; no T02, no T22', async () => {
  const r = await go(S.s14);
  assert.equal(r.snapshot.robots.policy, 'unknown');
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'unknown');
  assert.equal(r.snapshot.robots.accessBlocked, true);
  assert.ok(!r.site.requested('https://a.com/', 'page'));
  assert.ok(has(r, 'T29'));
  assert.ok(!has(r, 'T02'));
  assert.ok(!has(r, 'T22'));
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.equal(r.score.grade, 'gray');
});

test('S15 start https://www.a.com/: robots and origin follow the home redirect', async () => {
  const r = await go(S.s15);
  assert.deepEqual(r.site.requests.slice(0, 4), [
    { url: 'https://www.a.com/robots.txt', kind: 'robots' },
    { url: 'https://www.a.com/', kind: 'page' },
    { url: 'https://a.com/robots.txt', kind: 'robots' },
    { url: 'https://a.com/', kind: 'page' },
  ]);
  assert.equal(r.snapshot.robots.origin, 'https://a.com');
  assert.equal(r.snapshot.robots.url, 'https://a.com/robots.txt');
  assert.ok(r.snapshot.robotsInitial);
  assert.equal(r.snapshot.robotsInitial.origin, 'https://www.a.com');
  assert.equal(r.snapshot.robotsInitial.url, 'https://www.a.com/robots.txt');
  assert.equal(r.snapshot.origin, 'https://a.com');
  assert.equal(r.snapshot.home, 'https://a.com/');
  assert.ok(r.site.requested('https://a.com/sitemap.xml', 'sitemap'));
  assert.ok(!r.site.requested('https://www.a.com/sitemap.xml'));
  const soft = r.site.requests.find((q) => q.kind === 'probe' && q.url.includes('/seo-check-404-'));
  assert.ok(soft, 'soft404 probe requested');
  assert.match(soft.url, /^https:\/\/a\.com\/seo-check-404-[0-9a-f]{8}$/);
  const httpRobots = r.site.indexOf('http://a.com/robots.txt', 'robots');
  const httpProbe = r.site.indexOf('http://a.com/', 'probe');
  assert.ok(httpRobots >= 0, 'http robots requested');
  assert.ok(httpProbe > httpRobots, 'http probe comes after http robots');
  assert.deepEqual(r.site.violations, []);
});

test('S16 no declared sitemap, /sitemap.xml returns HTML 200 -> T18, no T19', async () => {
  const r = await go(S.s16);
  assert.ok(has(r, 'T18'));
  assert.ok(!has(r, 'T19'));
  assert.ok(!has(r, 'T37'));
  const sm = r.snapshot.sitemaps.find((s) => s.url === 'https://a.com/sitemap.xml');
  assert.ok(sm);
  assert.equal(sm.kind, 'html');
  assert.equal(sm.fallback, true);
});

test('S17 robots only disallows KinsuiSEOCheck -> home not fetched, failed, no T03, Googlebot declared_allowed', async () => {
  const r = await go(S.s17);
  assert.ok(!r.site.requested('https://a.com/', 'page'));
  assert.deepEqual(kinds(r.site), ['robots']);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(!has(r, 'T03'));
  assert.equal(r.bots.find((b) => b.token === 'Googlebot').status, 'declared_allowed');
  assert.equal(r.snapshot.homeSkippedByRobots, true);
  assert.ok(r.snapshot.coverage.reasons.includes('blocked_for_tool'), 'reason blocked_for_tool');
});

test('S18 start https://a.com/blog/post?utm=x -> pages[0] home, pages[1] start without query', async () => {
  const r = await go(S.s18);
  assert.equal(r.snapshot.pages[0].url, 'https://a.com/');
  assert.equal(r.snapshot.pages[1].url, 'https://a.com/blog/post');
  assert.ok(!r.site.requests.some((q) => q.url.includes('utm=')));
});

test('S19 /old 301 -> /private (disallowed for us) -> stop robots_disallowed; /private never requested', async () => {
  const r = await go(S.s19);
  const old = r.snapshot.pages.find((p) => p.url === 'https://a.com/old');
  assert.ok(old, '/old page entry');
  assert.equal(old.stop, 'robots_disallowed');
  assert.ok(!r.site.requested('https://a.com/private'));
  assert.deepEqual(r.site.violations, []);
});

test('S20 home 503 -> no T01; T29; coverage failed (home_unavailable)', async () => {
  const r = await go(S.s20);
  assert.ok(!has(r, 'T01'));
  assert.ok(has(r, 'T29'));
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(r.snapshot.coverage.reasons.includes('home_unavailable'));
  assert.ok(Array.isArray(r.byId.T29.data.reasons));
  assert.ok(r.byId.T29.data.reasons.includes('home_unavailable'));
});

test('S21 three internal pages 403 -> not in T12; listed in T13; partial with defects; at most yellow', async () => {
  const r = await go(S.s21);
  const blocked = S.S21_BLOCKED.map((p) => 'https://a.com' + p);
  if (has(r, 'T12')) for (const u of blocked) assert.ok(!r.byId.T12.urls.includes(u), u);
  assert.ok(has(r, 'T13'));
  for (const u of blocked) assert.ok(r.byId.T13.urls.includes(u), 'T13 ' + u);
  assert.equal(r.snapshot.coverage.status, 'partial');
  assert.equal(r.snapshot.coverage.defects, true);
  assert.ok(r.snapshot.coverage.reasons.includes('access_blocked'));
  assert.notEqual(r.score.grade, 'green');
  assert.equal(r.score.grade, 'yellow');
  for (const id of ['T01', 'T12', 'T17', 'T20']) {
    if (has(r, id)) for (const u of blocked) assert.ok(!r.byId[id].urls.includes(u), `${id} must not list ${u}`);
  }
});

test('S22 no declared sitemap, /sitemap.xml 503 -> T37 only, no T18', async () => {
  const r = await go(S.s22);
  assert.ok(has(r, 'T37'));
  assert.ok(!has(r, 'T18'));
  assert.ok(r.snapshot.coverage.reasons.includes('sitemap_unverifiable'));
});

test('S23 https robots disallows /secret, http robots 404 -> https://a.com/secret is never requested', async () => {
  const r = await go(S.s23);
  assert.ok(!r.site.requested('https://a.com/secret'));
  assert.deepEqual(r.site.violations, []);
  // the http and https origins keep separate robots info
  assert.notEqual(r.site.policyByOrigin.get('http://a.com')?.policy, undefined);
});

// ------------------------------------------------------------------ R29 frontend part
test('R29 our group with 1,001 rules -> Worker ourPolicy unknown -> frontend stops before the home page', async () => {
  const r = await go(S.r29Frontend);
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'unknown');
  assert.ok(!r.site.requested('https://a.com/', 'page'));
  assert.deepEqual(kinds(r.site), ['robots']);
  assert.equal(r.snapshot.coverage.status, 'failed');
});

// ------------------------------------------------------------------ extras with precise rules
test('T22 robots 404 -> T22 (INFO); everything allowed', async () => {
  const r = await go(S.robots404);
  assert.ok(has(r, 'T22'));
  assert.equal(r.byId.T22.severity, 'INFO');
  assert.equal(r.byId.T22.count, 1);
  assert.equal(r.snapshot.robots.policy, 'allow_all');
  assert.equal(r.bots.find((b) => b.token === 'Googlebot').status, 'declared_allowed');
  assert.ok(r.site.requested('https://a.com/', 'page'));
});

test('T01 home 404 -> T01 P0; only the reduced check set runs', async () => {
  const r = await go(S.home404);
  assert.ok(has(r, 'T01'));
  assert.equal(r.byId.T01.severity, 'P0');
  assert.ok(!has(r, 'T29'));
  assert.equal(r.score.grade, 'red');
  const allowedIds = ['T01', 'T02', 'T03', 'T22', 'T28', 'T29', 'T39', 'G01', 'G02', 'G03', 'G04'];
  for (const id of r.ids) assert.ok(allowedIds.includes(id), `unexpected ${id} when the home page is not analyzable`);
});

test('T21 60 foreign URLs in the sitemap -> count 60, urls capped at 50 in discovery order', async () => {
  const r = await go(S.foreignSitemap);
  assert.ok(has(r, 'T21'));
  const t21 = r.byId.T21;
  assert.equal(t21.count, 60);
  assert.equal(t21.urls.length, 50);
  assert.deepEqual(t21.urls, r.sc.foreign.slice(0, 50));
  assert.ok(!r.site.requests.some((q) => q.url.includes('foreign-host')));
});

test('G04 ChatGPT-User blocked -> G04 INFO with tokens; not G01', async () => {
  const r = await go(S.userFetchBlocked);
  assert.ok(has(r, 'G04'));
  assert.ok(r.byId.G04.data.tokens.includes('ChatGPT-User'));
  assert.ok(!has(r, 'G01'));
});

test('G07 home without Organization JSON-LD -> G07 INFO', async () => {
  const r = await go(S.noOrgSchema);
  assert.ok(has(r, 'G07'));
  const s01 = await go(S.s01);
  assert.ok(!has(s01, 'G07'));
});

test('crawl constants', () => {
  assert.deepEqual(CRAWL_LIMITS, { discovered: 5000, inlinksPerUrl: 50, maxHops: 5 });
  assert.deepEqual(SKIP_EXTENSIONS, ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.pdf', '.zip', '.rar', '.7z', '.mp4', '.mp3', '.mov', '.avi', '.css', '.js', '.json', '.xml', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.gz']);
});

// ------------------------------------------------------------------ v1.5 (DEBATE-001 驗收第一輪 A4–A6, A9, A10)
test('A4 /%e6%9c%8d and /%E6%9C%8D are the same URL: crawled once, with upper-case hex', async () => {
  const r = await go(S.percentCase);
  const same = (u) => u.toLowerCase() === S.PCT_UPPER.toLowerCase();
  const hits = r.site.requests.filter((q) => q.kind === 'page' && same(q.url));
  assert.equal(hits.length, 1, 'one page request for the path');
  assert.equal(hits[0].url, S.PCT_UPPER);
  assert.ok(!r.site.requested(S.PCT_LOWER));
  assert.equal(r.snapshot.pages.filter((p) => same(p.url)).length, 1);
  assert.equal(Object.keys(r.snapshot.discovered).filter(same).length, 1);
  assert.deepEqual(Object.keys(r.snapshot.discovered).filter(same), [S.PCT_UPPER]);
  assert.ok(!has(r, 'C02'));
  assert.equal(r.snapshot.limits.crawled, 9);
});

test('A5 home 301 -> www whose canonical is that final URL (also listed in the sitemap) -> no T17, no T20', async () => {
  const r = await go(S.wwwHomeCanonical);
  assert.equal(r.snapshot.home, 'https://www.a.com/');
  assert.equal(r.snapshot.homeAnalyzable, true);
  assert.ok(r.snapshot.sitemapUrls.includes('https://www.a.com/'));
  assert.ok(!has(r, 'T17'), 'canonical to the final URL of a redirect is fine');
  assert.ok(!has(r, 'T20'), 'sitemap URL equal to the final URL is fine');
});

test('A5 lookupTarget (T17): canonical to a URL that was requested and redirected / 404 / noindex -> T17; to a final URL -> no T17', async () => {
  const r = await go(S.canonicalTargets);
  assert.ok(has(r, 'T17'));
  const urls = r.byId.T17.urls;
  for (const p of ['/p', '/r', '/s']) assert.ok(urls.includes('https://a.com' + p), 'T17 ' + p);
  assert.ok(!urls.includes('https://a.com/q'), '/q canonical is the final URL of /old (step 2 ignores the chain)');
  assert.equal(r.byId.T17.severity, 'P2');
});

test('A5 lookupTarget (T20): sitemap URLs that redirect, 404, are noindex or canonicalise elsewhere -> T20; healthy ones not', async () => {
  const r = await go(S.canonicalTargets);
  assert.ok(has(r, 'T20'));
  const urls = r.byId.T20.urls;
  for (const p of ['/old', '/gone', '/noidx', '/p']) assert.ok(urls.includes('https://a.com' + p), 'T20 ' + p);
  assert.ok(!urls.includes('https://a.com/'), 'home is healthy');
});

test('A6 a link redirecting to an already crawled page is a duplicate, not page_unanalyzable', async () => {
  const r = await go(S.duplicateRedirect);
  const dup = r.snapshot.pages.find((p) => p.url === 'https://a.com/dup');
  assert.ok(dup, '/dup page entry');
  assert.equal(dup.finalUrl, 'https://a.com/');
  assert.notEqual(dup.duplicateOf, null);
  assert.equal(dup.page, null);
  assert.ok(!r.snapshot.coverage.reasons.includes('page_unanalyzable'));
  assert.equal(r.snapshot.coverage.defects, false);
  assert.equal(r.snapshot.coverage.status, 'complete');
  assert.equal(r.score.grade, 'green');
});

test('A9 fallback /sitemap.xml 404 or 410 -> kind missing -> T18, no T37, no sitemap defect', async () => {
  for (const b of [S.fallbackSitemapGone, S.fallbackSitemap410]) {
    const r = await go(b);
    const sm = r.snapshot.sitemaps.find((x) => x.url === 'https://a.com/sitemap.xml');
    assert.ok(sm, 'fallback sitemap entry');
    assert.equal(sm.kind, 'missing');
    assert.equal(sm.fallback, true);
    assert.ok(has(r, 'T18'));
    assert.equal(r.byId.T18.count, 1);
    assert.ok(!has(r, 'T37'));
    assert.ok(!r.snapshot.coverage.reasons.includes('sitemap_unverifiable'));
    assert.equal(r.snapshot.coverage.status, 'complete');
  }
});

test('A9 a declared sitemap returning 404 -> kind error -> T37 (no T18, no T19)', async () => {
  const r = await go(S.declaredSitemap404);
  const sm = r.snapshot.sitemaps.find((x) => x.url === 'https://a.com/sm.xml');
  assert.ok(sm);
  assert.equal(sm.fallback, false);
  assert.equal(sm.kind, 'error');
  assert.ok(has(r, 'T37'));
  assert.ok(!has(r, 'T18'));
  assert.ok(!has(r, 'T19'));
  assert.ok(r.snapshot.coverage.reasons.includes('sitemap_unverifiable'));
  assert.ok(!r.site.requested('https://a.com/sitemap.xml'), 'no fallback when a sitemap is declared');
});

test('A10 home not analyzable -> no sitemap, page or probe request after the home request', async () => {
  for (const [name, b, reason] of [
    ['503', S.s20, 'home_unavailable'],
    ['404', S.home404, 'home_not_analyzable'],
    ['non-HTML', S.homeNotHtml, 'home_not_analyzable'],
    ['500 challenge', S.homeChallenge500, 'home_not_analyzable'],
  ]) {
    const r = await go(b);
    const idx = r.site.indexOf('https://a.com/', 'page');
    assert.ok(idx >= 0, `${name}: home requested`);
    const after = r.site.requests.slice(idx + 1).filter((q) => q.kind !== 'robots');
    assert.deepEqual(after, [], `${name}: requests after the home page`);
    assert.deepEqual(r.site.urls('page'), ['https://a.com/'], `${name}: only the home page`);
    assert.equal(r.snapshot.homeAnalyzable, false);
    assert.equal(r.snapshot.coverage.status, 'failed');
    assert.ok(r.snapshot.coverage.reasons.includes(reason), `${name}: reason ${reason}`);
  }
});

// ------------------------------------------------------------------ mutation gaps CK01–CK07, CR01
test('CK01 home 500 with cf-mitigated: challenge -> no T01 (accessBlocked), T29', async () => {
  const r = await go(S.homeChallenge500);
  assert.equal(r.snapshot.pages[0].accessBlocked, true);
  assert.ok(!has(r, 'T01'));
  assert.ok(has(r, 'T29'));
});

test('CK02 robots 503 with cf-mitigated: challenge -> no T02 (accessBlocked), home not fetched', async () => {
  const r = await go(S.robotsChallenge503);
  assert.equal(r.snapshot.robots.accessBlocked, true);
  assert.ok(!has(r, 'T02'));
  assert.ok(has(r, 'T29'));
  assert.ok(!r.site.requested('https://a.com/', 'page'));
});

test('CK03 linked page 502 with cf-mitigated: challenge is not counted in T12 (only the real 404 is)', async () => {
  const r = await go(S.pageChallenge502);
  assert.ok(has(r, 'T12'));
  assert.ok(!r.byId.T12.urls.includes('https://a.com/bad'));
  assert.ok(r.byId.T12.urls.includes('https://a.com/gone'));
  assert.equal(r.byId.T12.count, 1);
  assert.equal(r.byId.T12.severity, 'P2');
  assert.ok(has(r, 'T13'));
  assert.ok(r.byId.T13.urls.includes('https://a.com/bad'));
});

test('CK04 2 of 10 linked internal pages 404 -> T12 is P2 (P1 needs n >= 5 and >= 10%)', async () => {
  const r = await go(S.tenLinksTwoBroken);
  assert.ok(has(r, 'T12'));
  assert.equal(r.byId.T12.severity, 'P2');
  assert.equal(r.byId.T12.count, 2);
  for (const p of S.CK04_BROKEN) assert.ok(r.byId.T12.urls.includes('https://a.com' + p), p);
  assert.equal(r.snapshot.limits.crawled, 11);
});

test('CK07 SPA root holding 50 chars of text -> no G06 (control: 19 chars -> G06)', async () => {
  const r50 = await go(S.ALL_SCENARIOS.spaRoot50);
  const home = r50.snapshot.pages[0].page;
  assert.equal(home.hasSpaRoot, true);
  assert.equal(home.spaRootTextLength, 50);
  assert.ok(home.textLength < 200);
  assert.ok(home.scriptSrcCount >= 1);
  assert.ok(!has(r50, 'G06'));
  const r19 = await go(S.ALL_SCENARIOS.spaRoot19);
  assert.equal(r19.snapshot.pages[0].page.spaRootTextLength, 19);
  assert.ok(has(r19, 'G06'));
});

test('CR01 Worker ourPolicy unknown for the start origin -> only robots requested, even though the robots text allows all', async () => {
  const r = await go(S.workerUnknownStart);
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'unknown');
  assert.deepEqual(kinds(r.site), ['robots']);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.deepEqual(r.site.violations, []);
});

test('CR01 Worker ourPolicy unknown for http://a.com -> no http probe (other origins unaffected)', async () => {
  const r = await go(S.workerUnknownHttp);
  assert.ok(r.site.requested('https://a.com/', 'page'));
  assert.ok(r.site.requested('http://a.com/robots.txt', 'robots'));
  assert.ok(!r.site.requests.some((q) => q.kind !== 'robots' && q.url.startsWith('http://')), 'nothing but robots on http://a.com');
  assert.equal(r.snapshot.probes.http, null);
  assert.deepEqual(r.site.violations, []);
});

test('CR01 robots overflow (Worker ourPolicy unknown) -> only robots requested', async () => {
  const r = await go(S.workerUnknownOverflow);
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'unknown');
  assert.deepEqual(kinds(r.site), ['robots']);
  assert.equal(r.snapshot.coverage.status, 'failed');
});

// ------------------------------------------------------------------ coverage reasons (§5.7 steps 2 and 4)
test('COV01 start-origin robots.txt 503 -> failed with robots_disallow_all (not blocked_for_tool), no page request', async () => {
  const r = await go(S.s07);
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'disallow_all');
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(r.snapshot.coverage.reasons.includes('robots_disallow_all'), JSON.stringify(r.snapshot.coverage.reasons));
  assert.ok(!r.snapshot.coverage.reasons.includes('blocked_for_tool'));
  assert.equal(r.snapshot.homeSkippedByRobots, false);
  assert.deepEqual(r.site.urls('page'), []);
});

test('COV02 start-origin robots.txt 403 + cf-mitigated: challenge -> failed with robots_unknown (not blocked_for_tool)', async () => {
  const r = await go(S.s14);
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'unknown');
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(r.snapshot.coverage.reasons.includes('robots_unknown'), JSON.stringify(r.snapshot.coverage.reasons));
  assert.ok(!r.snapshot.coverage.reasons.includes('blocked_for_tool'));
  assert.equal(r.snapshot.homeSkippedByRobots, false);
  assert.deepEqual(r.site.urls('page'), []);
});

test('COV03 robots disallows only KinsuiSEOCheck for / -> blocked_for_tool and homeSkippedByRobots (contrast with COV01/COV02)', async () => {
  const r = await go(S.s17);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(r.snapshot.coverage.reasons.includes('blocked_for_tool'), JSON.stringify(r.snapshot.coverage.reasons));
  assert.ok(!r.snapshot.coverage.reasons.includes('robots_unknown'));
  assert.ok(!r.snapshot.coverage.reasons.includes('robots_disallow_all'));
  assert.equal(r.snapshot.homeSkippedByRobots, true);
  assert.deepEqual(r.site.urls('page'), []);
});

test('COV04 final-origin robots unknown after the home redirect -> robots_final_unknown; score unavailable, null, gray', async () => {
  // AMBIGUOUS: §5.7 fetchFollow checks ourAllowed before every hop and returns finalUrl = the last REQUESTED URL,
  // so https://a.com/ (unknown policy) is never requested and a literal reading keeps origin = https://www.a.com.
  // Step 4 only makes sense if home/origin is the redirect target https://a.com/; this test follows step 4.
  const r = await go(S.finalOriginRobotsUnknown);
  assert.equal(r.snapshot.coverage.status, 'failed');
  assert.ok(r.snapshot.coverage.reasons.includes('robots_final_unknown'), JSON.stringify(r.snapshot.coverage.reasons));
  assert.equal(r.snapshot.origin, 'https://a.com');
  assert.equal(r.snapshot.robots.origin, 'https://a.com');
  assert.equal(r.snapshot.robots.ourPolicy.policy, 'unknown');
  assert.ok(r.snapshot.robotsInitial);
  assert.equal(r.snapshot.robotsInitial.origin, 'https://www.a.com');
  assert.ok(!r.findings.some((f) => f.severity === 'P0'), 'no P0 finding expected here');
  assert.equal(r.score.scoreStatus, 'unavailable');
  assert.equal(r.score.score, null);
  assert.equal(r.score.grade, 'gray');
});

test('COV05 final-origin robots unknown: no sitemap, page or probe request after the a.com robots request', async () => {
  const r = await go(S.finalOriginRobotsUnknown);
  assert.deepEqual(r.site.requests.slice(0, 3), [
    { url: 'https://www.a.com/robots.txt', kind: 'robots' },
    { url: 'https://www.a.com/', kind: 'page' },
    { url: 'https://a.com/robots.txt', kind: 'robots' },
  ]);
  const idx = r.site.indexOf('https://a.com/robots.txt', 'robots');
  const after = r.site.requests.slice(idx + 1).filter((q) => q.kind !== 'robots');
  // the only page the coordinator's description tolerates here is the a.com home hop; §5.7 fetchFollow
  // (ourAllowed before every hop) and the DO (policy unknown -> robots_disallowed) both forbid it
  assert.ok(after.every((q) => q.kind === 'page' && q.url === 'https://a.com/'), 'nothing but the a.com home hop: ' + JSON.stringify(after));
  assert.ok(!r.site.requested('https://a.com/', 'page'), 'https://a.com/ must not be requested: its ourPolicy is unknown (§5.7 fetchFollow, DO robots_disallowed)');
  assert.ok(!r.site.requests.some((q) => q.kind === 'sitemap' || q.kind === 'probe'));
  assert.deepEqual(r.site.violations, []);
});

// ------------------------------------------------------------------ invariants over every scenario
test('Finding invariants (unique id, table code/section/severity/evidence, scored, order, urls<=50, valid sources)', async () => {
  for (const [name, builder] of Object.entries(S.ALL_SCENARIOS)) {
    const r = await go(builder);
    checkInvariants(r.findings, name);
    // coverage shape
    const c = r.snapshot.coverage;
    assert.ok(['complete', 'partial', 'failed'].includes(c.status), name);
    assert.equal(c.status === 'complete', c.reasons.length === 0, `${name}: complete iff no reasons`);
    if (c.status === 'failed') assert.equal(c.defects, true, `${name}: failed implies defects`);
    // the browser never asked for something the DO would refuse
    assert.deepEqual(r.site.violations, [], `${name}: DO-refused requests`);
  }
});
