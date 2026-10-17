import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

import { decodeBody, extractPage, fnv1a } from '../public/core/parse.js';
import { looksLikeHtml, parseSitemap } from '../public/core/sitemap.js';
import { runAudit } from '../public/core/crawl.js';
import { botAccess, runChecks } from '../public/core/checks.js';
import { computeScore } from '../public/core/score.js';
import { cleanUrl, normalizeInputUrl } from '../public/core/url.js';

const encoder = new TextEncoder();
const parser = new DOMParser();
const parseHtml = (html) => parser.parseFromString(html, 'text/html');

function bytes(value) {
  return encoder.encode(value);
}

function result(url, {
  status = 200,
  body = null,
  type = 'text/html; charset=utf-8',
  location = null,
  error = null,
  accessBlocked = false,
  truncated = false,
  ourPolicy = null,
} = {}) {
  return {
    status,
    finalUrl: url,
    location,
    chain: [],
    stop: null,
    error,
    skipped: null,
    truncated,
    accessBlocked,
    truncatedHeaders: false,
    headers: { 'content-type': type },
    ourPolicy,
    bytes: body == null ? null : bytes(body),
  };
}

const allowRobots = (url) => result(url, {
  status: 404,
  type: 'text/plain',
  ourPolicy: { policy: 'allow_all', rulesCount: 0 },
});

function simplePage(url, extra = '') {
  return result(url, {
    body: `<!doctype html><html lang="zh-TW"><head><title>${url}</title><meta name="description" content="${url}"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${url}"><meta property="og:title" content="x"><meta property="og:image" content="https://a.com/i.png"></head><body><h1>x</h1>${extra}</body></html>`,
  });
}

function htmlPage(url, { head = '', body = '<h1>x</h1>' } = {}) {
  return result(url, {
    body: `<!doctype html><html lang="zh-TW"><head><title>${url}</title><meta name="description" content="${url}"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${url}"><meta property="og:title" content="x"><meta property="og:image" content="https://a.com/i.png">${head}</head><body>${body}</body></html>`,
  });
}

const findingIds = (snapshot) => new Set(runChecks(snapshot).map((finding) => finding.id));

async function audit(startUrl, fetchFn, options = {}) {
  return runAudit(startUrl, {
    fetchFn,
    parseHtml,
    delayMs: 0,
    sleep: async () => {},
    now: () => new Date('2026-10-17T00:00:00Z'),
    random: () => 0.5,
    ...options,
  });
}

test('P01 big5 meta charset decodes the title', () => {
  const prefix = bytes('<meta charset="big5"><title>');
  const suffix = bytes('</title>');
  const input = new Uint8Array(prefix.length + 4 + suffix.length);
  input.set(prefix);
  input.set([0xa4, 0xa4, 0xa4, 0xe5], prefix.length); // 中文
  input.set(suffix, prefix.length + 4);
  assert.match(decodeBody(input, 'text/html'), /<title>中文<\/title>/u);
});

test('P02 content-type charset takes priority over meta charset', () => {
  const input = bytes('<meta charset="big5"><title>中文</title>');
  assert.match(decodeBody(input, 'text/html; Charset="UTF-8"'), /中文/u);
});

test('P03 UTF-8 BOM takes priority over content-type charset', () => {
  const source = bytes('<title>中文</title>');
  const input = new Uint8Array(source.length + 3);
  input.set([0xef, 0xbb, 0xbf]);
  input.set(source, 3);
  assert.equal(decodeBody(input, 'text/html; charset=big5'), '<title>中文</title>');
});

test('P04 extractPage handles base, JSON-LD, visibility, SPA, alt and invalid canonical', () => {
  const doc = parseHtml(`<!doctype html><html><head>
    <base href="/base/"><title> First </title>
    <META NAME="ROBOTS" CONTENT="NOINDEX">
    <link rel="canonical" href="item"><link rel="canonical" href="javascript:x">
    <script type="application/ld+json">{"@graph":[{"@type":["Organization","LocalBusiness"]}]}</script>
    <script type="application/ld+json">{broken</script><style>hidden style</style>
    </head><body><div id="root">Visible <script>hidden script</script></div><img src="/x.png" alt=""></body></html>`);
  const page = extractPage(doc, 'https://a.com/start');
  assert.deepEqual(page.canonicals, ['https://a.com/base/item']);
  assert.equal(page.canonicalTagCount, 2);
  assert.deepEqual(page.metaRobots, ['noindex']);
  assert.equal(page.jsonld[0].ok, true);
  assert.deepEqual(page.jsonld[0].types, ['Organization', 'LocalBusiness']);
  assert.equal(page.jsonld[1].ok, false);
  assert.equal(page.hasSpaRoot, true);
  assert.equal(page.spaRootTextLength, 7);
  assert.equal(page.images[0].hasAlt, true);
  assert.equal(page.textLength, Array.from('Visible').length);
});

test('P05 parseSitemap supports roots, prefixes, CDATA, entities and HTML detection', () => {
  assert.deepEqual(parseSitemap('\uFEFF<urlset><url><loc><![CDATA[https://a.com/a?x=1&y=2]]></loc></url><url><loc>https://a.com/b&amp;c</loc></url></urlset>'), {
    kind: 'urlset', urls: ['https://a.com/a?x=1&y=2', 'https://a.com/b&c'], error: null,
  });
  assert.equal(parseSitemap('<sm:sitemapindex xmlns:sm="x"><sm:sitemap><sm:loc>https://a.com/s.xml</sm:loc></sm:sitemap></sm:sitemapindex>').kind, 'index');
  assert.equal(parseSitemap('<rss/>').kind, 'invalid');
  assert.equal(looksLikeHtml('   <!DOCTYPE HTML><html>', null), true);
  assert.equal(looksLikeHtml('<urlset/>', 'text/html; charset=utf-8'), true);
});

test('P06 fnv1a matches all specified vectors', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  assert.equal(fnv1a('foobar'), 'bf9cf968');
});

test('P07 insecureResources includes script, stylesheet and iframe but not image', () => {
  const page = extractPage(parseHtml('<html><head><script src="http://x/s.js"></script><link rel="stylesheet" href="http://x/a.css"></head><body><iframe src="http://x/f"></iframe><img src="http://x/i.png"></body></html>'), 'https://a.com/');
  assert.deepEqual(page.insecureResources.map((item) => item.tag).sort(), ['iframe', 'script', 'stylesheet']);
});

test('P08 meta charset after byte 1024 is ignored', () => {
  const text = `${' '.repeat(1500)}<meta charset="big5"><title>中文</title>`;
  assert.match(decodeBody(bytes(text), 'text/html'), /中文/u);
});

test('P09 meta refresh resolves a relative destination', () => {
  const page = extractPage(parseHtml('<meta http-equiv="refresh" content="0; url=/new">'), 'https://a.com/old');
  assert.deepEqual(page.metaRefresh, { delay: 0, url: 'https://a.com/new' });
});

test('P10 link and JSON depth limits are enforced without throwing', () => {
  const links = Array.from({ length: 3000 }, (_, index) => `<a href="/${index}">x</a>`).join('');
  let deep = { '@type': 'Leaf' };
  for (let index = 0; index < 40; index += 1) deep = { child: deep };
  const page = extractPage(parseHtml(`<script type="application/ld+json">${JSON.stringify(deep)}</script>${links}`), 'https://a.com/');
  assert.equal(page.links.length, 2000);
  assert.ok(page.limitsHit.includes('links'));
  assert.ok(page.limitsHit.includes('jsonDepth'));
});

test('S01 a healthy eight-page website has no P0-P2 finding and scores green', async () => {
  const urls = ['https://a.com/', ...Array.from({ length: 7 }, (_, index) => `https://a.com/p${index + 1}`)];
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return result(url, {
      body: 'User-agent: *\nAllow: /\nSitemap: https://a.com/sitemap.xml', type: 'text/plain',
      ourPolicy: { policy: 'rules', rulesCount: 1 },
    });
    if (url === 'https://a.com/sitemap.xml') return result(url, {
      type: 'application/xml', body: `<urlset>${urls.map((item) => `<url><loc>${item}</loc></url>`).join('')}</urlset>`,
    });
    if (kind === 'probe') return result(url, {
      status: url.startsWith('http:') ? 301 : 404,
      location: url.startsWith('http:') ? url.replace('http:', 'https:') : null,
    });
    const index = urls.indexOf(url);
    return htmlPage(url, {
      head: '<script type="application/ld+json">{"@type":"Organization"}</script>',
      body: `<h1>Page ${index}</h1>`,
    });
  });
  const findings = runChecks(snapshot);
  assert.equal(findings.some((item) => ['P0', 'P1', 'P2'].includes(item.severity)), false);
  const score = computeScore(findings, snapshot.coverage);
  assert.ok(score.score >= 85);
  assert.equal(score.grade, 'green');
  assert.equal(score.scoreStatus, 'valid');
});

test('S02 tool-wide robots disallow stops after the robots request', async () => {
  const calls = [];
  const snapshot = await audit('https://a.com/', async (url) => {
    calls.push(url);
    return result(url, { body: 'User-agent: *\nDisallow: /', type: 'text/plain', ourPolicy: { policy: 'disallow_all', rulesCount: 1 } });
  });
  assert.deepEqual(calls, ['https://a.com/robots.txt']);
  assert.equal(snapshot.coverage.status, 'failed');
  assert.ok(snapshot.coverage.reasons.includes('robots_disallow_all'));
});

test('S03 noindex on the home page is a capped red P0 result', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return htmlPage(url, { head: '<meta name="robots" content="noindex">' });
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 404, type: 'application/xml' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  const findings = runChecks(snapshot);
  assert.ok(findings.some((item) => item.id === 'T04'));
  const score = computeScore(findings, snapshot.coverage);
  assert.ok(score.score <= 40);
  assert.equal(score.grade, 'red');
});

test('S04 AI search and training bot blocks are classified separately', async () => {
  const text = [
    'User-agent: OAI-SearchBot', 'User-agent: PerplexityBot', 'Disallow: /',
    'User-agent: GPTBot', 'User-agent: ClaudeBot', 'Disallow: /',
  ].join('\n');
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return result(url, { body: text, type: 'text/plain', ourPolicy: { policy: 'allow_all', rulesCount: 0 } });
    if (url === 'https://a.com/') return simplePage(url);
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 404, type: 'application/xml' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  const findings = runChecks(snapshot);
  const g01 = findings.find((item) => item.id === 'G01');
  const g03 = findings.find((item) => item.id === 'G03');
  assert.deepEqual(new Set(g01.data.tokens), new Set(['OAI-SearchBot', 'PerplexityBot']));
  assert.deepEqual(new Set(g03.data.tokens), new Set(['GPTBot', 'ClaudeBot']));
  assert.equal(findings.some((item) => item.id === 'T03'), false);
});

test('S05 an empty SPA shell is identified as JavaScript-dependent', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return result(url, {
      body: '<!doctype html><html lang="zh-TW"><head><title>x</title><meta name="description" content="x"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://a.com/"><meta property="og:title" content="x"><meta property="og:image" content="https://a.com/i.png"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    });
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 404, type: 'application/xml' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  assert.ok(findingIds(snapshot).has('G06'));
});

test('S06 a deliberately messy sample emits the specified mixed findings', async () => {
  const links = ['/multi', '/invalid', '/dup1', '/dup2'].map((path) => `<a href="${path}">x</a>`).join('');
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 404, type: 'application/xml' });
    if (kind === 'probe') return result(url, { status: 404 });
    if (url === 'https://a.com/') return result(url, { body: `<!doctype html><html lang="zh-TW"><head>
      <title></title><title>second</title><meta name="description" content="home"><meta name="viewport" content="width=device-width">
      <link rel="canonical" href="https://other.example/"><meta name="robots" content="nosnippet">
      <meta http-equiv="refresh" content="5; url=/later"><script src="http://cdn.example/x.js"></script>
      <script type="application/ld+json">{bad</script><script type="application/ld+json">{"@type":"FAQPage"}</script>
      </head><body><h1>x</h1><img src="/x.png">${links}</body></html>` });
    if (url.endsWith('/multi')) return htmlPage(url, { head: '<link rel="canonical" href="/one"><link rel="canonical" href="/two">' });
    if (url.endsWith('/invalid')) return result(url, { body: '<html lang="zh-TW"><head><title>invalid</title><meta name="description" content="invalid"><meta name="viewport" content="width=device-width"><link rel="canonical" href="javascript:x"></head><body><h1>x</h1></body></html>' });
    if (url.endsWith('/dup1') || url.endsWith('/dup2')) return result(url, { body: `<html lang="zh-TW"><head><title>Same</title><meta name="description" content="${url}"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${url}"></head><body><h1>x</h1></body></html>` });
    return simplePage(url);
  });
  const ids = findingIds(snapshot);
  for (const id of ['C01', 'C02', 'C11', 'C12', 'T15', 'T16', 'C09', 'G05', 'T34', 'T36', 'T33', 'T38']) assert.ok(ids.has(id), id);
  assert.equal(runChecks(snapshot).find((item) => item.id === 'T16').severity, 'P1');
});

test('S07 a 503 robots response emits T02 and prevents the home request', async () => {
  const calls = [];
  const snapshot = await audit('https://a.com/', async (url) => {
    calls.push(url);
    return result(url, { status: 503, type: 'text/plain', ourPolicy: { policy: 'disallow_all', rulesCount: 0 } });
  });
  assert.deepEqual(calls, ['https://a.com/robots.txt']);
  assert.ok(findingIds(snapshot).has('T02'));
  assert.equal(snapshot.coverage.status, 'failed');
});

test('S08 live HTTP and random-path probes emit T09 and T11', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return simplePage(url);
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 404, type: 'application/xml' });
    if (kind === 'probe') return result(url, { status: 200 });
    return simplePage(url);
  });
  const ids = findingIds(snapshot);
  assert.ok(ids.has('T09'));
  assert.ok(ids.has('T11'));
});

test('S09 an offsite home redirect stops the audit and emits T28', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    return result(url, { status: 301, location: 'https://b.com/' });
  });
  assert.equal(snapshot.stoppedOffsite, true);
  assert.equal(snapshot.coverage.status, 'failed');
  assert.ok(findingIds(snapshot).has('T28'));
});

test('S10 six broken destinations among ten linked pages emit P1 T12 with referrers', async () => {
  const links = Array.from({ length: 10 }, (_, index) => `<a href="/p${index}">p</a>`).join('');
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return simplePage(url, links);
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 404, type: 'application/xml' });
    if (kind === 'probe') return result(url, { status: 404 });
    const number = Number(url.match(/\/p(\d+)$/u)?.[1]);
    return number < 6 ? result(url, { status: 404 }) : simplePage(url);
  });
  const finding = runChecks(snapshot).find((item) => item.id === 'T12');
  assert.equal(finding.severity, 'P1');
  assert.ok(Object.values(finding.data.referrers).every((items) => items.includes('https://a.com/')));
});

test('S11 a Bingbot block emits G02 and caps the score at 79', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return result(url, { body: 'User-agent: Bingbot\nDisallow: /', type: 'text/plain', ourPolicy: { policy: 'allow_all', rulesCount: 0 } });
    if (url === 'https://a.com/') return simplePage(url);
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 404, type: 'application/xml' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  const findings = runChecks(snapshot);
  assert.ok(findings.some((item) => item.id === 'G02'));
  assert.ok(computeScore(findings, snapshot.coverage).score <= 79);
});

test('S13 page sampling stops at 15 and reports 26 eligible URLs not crawled', async () => {
  const homeLinks = Array.from({ length: 40 }, (_, index) => `<a href="/p${index}">p</a>`).join('');
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return simplePage(url, homeLinks);
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    if (kind === 'probe') return result(url, { status: url.startsWith('http:') ? 301 : 404, location: url.startsWith('http:') ? url.replace('http:', 'https:') : null });
    return simplePage(url);
  });
  assert.equal(snapshot.pages.length, 15);
  assert.equal(snapshot.limits.notCrawled, 26);
  assert.equal(snapshot.coverage.status, 'partial');
  assert.ok(snapshot.coverage.reasons.includes('page_limit'));
});

test('S14 a challenged robots response is unknown and only emits T29', async () => {
  const snapshot = await audit('https://a.com/', async (url) => result(url, {
    status: 403,
    type: 'text/plain',
    accessBlocked: true,
    ourPolicy: { policy: 'unknown', rulesCount: 0 },
  }));
  const ids = findingIds(snapshot);
  assert.ok(ids.has('T29'));
  assert.equal(ids.has('T02'), false);
  assert.equal(ids.has('T22'), false);
  assert.equal(snapshot.pages.length, 0);
});

test('S15 redirect updates origin and obtains robots for each origin in order', async () => {
  const calls = [];
  const snapshot = await audit('https://www.a.com/', async (url, kind) => {
    calls.push(url);
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://www.a.com/') return result(url, { status: 301, location: 'https://a.com/', body: null });
    if (url === 'https://a.com/') return simplePage(url);
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  assert.deepEqual(calls.slice(0, 4), [
    'https://www.a.com/robots.txt', 'https://www.a.com/', 'https://a.com/robots.txt', 'https://a.com/',
  ]);
  assert.equal(snapshot.origin, 'https://a.com');
  assert.equal(snapshot.robots.origin, 'https://a.com');
  assert.equal(snapshot.robotsInitial.origin, 'https://www.a.com');
  assert.ok(calls.includes('https://a.com/sitemap.xml'));
  assert.ok(calls.includes('https://a.com/seo-check-404-80000000'));
  assert.ok(calls.includes('http://a.com/robots.txt'));
});

test('S16 an HTML fallback sitemap emits T18 but not T19', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return simplePage(url);
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 200, body: '<!doctype html><html><body>not xml</body></html>' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  const ids = findingIds(snapshot);
  assert.ok(ids.has('T18'));
  assert.equal(ids.has('T19'), false);
});

test('S17 a tool-only block fails closed without declaring Googlebot blocked', async () => {
  const snapshot = await audit('https://a.com/', async (url) => result(url, {
    body: 'User-agent: KinsuiSEOCheck\nDisallow: /',
    type: 'text/plain',
    ourPolicy: { policy: 'rules', rulesCount: 1 },
  }));
  const ids = findingIds(snapshot);
  assert.equal(snapshot.pages.length, 0);
  assert.equal(snapshot.coverage.status, 'failed');
  assert.equal(ids.has('T03'), false);
  assert.equal(botAccess(snapshot).find((row) => row.token === 'Googlebot').status, 'declared_allowed');
});

test('S18 a non-home start path is crawled immediately after the home page', async () => {
  const snapshot = await audit('https://a.com/blog/post?utm=x', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    if (kind === 'probe') return result(url, { status: 404 });
    return simplePage(url);
  });
  assert.equal(snapshot.pages[0].url, 'https://a.com/');
  assert.equal(snapshot.pages[1].url, 'https://a.com/blog/post');
});

test('S19 a redirected destination blocked for the tool is never requested', async () => {
  const calls = [];
  const robotsText = 'User-agent: KinsuiSEOCheck\nDisallow: /private';
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    calls.push(url);
    if (kind === 'robots') return result(url, { body: robotsText, type: 'text/plain', ourPolicy: { policy: 'rules', rulesCount: 1 } });
    if (url === 'https://a.com/') return simplePage(url, '<a href="/old">old</a>');
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    if (url === 'https://a.com/old') return result(url, { status: 301, location: 'https://a.com/private' });
    if (kind === 'probe') return result(url, { status: 404 });
    return simplePage(url);
  });
  const old = snapshot.pages.find((page) => page.url === 'https://a.com/old');
  assert.equal(old.stop, 'robots_disallowed');
  assert.equal(calls.includes('https://a.com/private'), false);
});

test('S20 a 503 home is unavailable, not a generic fetch error', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    return result(url, { status: 503, type: 'text/html' });
  });
  assert.equal(snapshot.coverage.status, 'failed');
  assert.ok(snapshot.coverage.reasons.includes('home_unavailable'));
  assert.equal(snapshot.homeAnalyzable, false);
});

test('S21 access-blocked pages are partial defects and retained as evidence', async () => {
  const links = '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>';
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return simplePage(url, links);
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    if (['https://a.com/a', 'https://a.com/b', 'https://a.com/c'].includes(url)) return result(url, { status: 403, accessBlocked: true });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  assert.equal(snapshot.pages.filter((page) => page.accessBlocked).length, 3);
  assert.equal(snapshot.coverage.status, 'partial');
  assert.equal(snapshot.coverage.defects, true);
  assert.ok(snapshot.coverage.reasons.includes('access_blocked'));
});

test('S22 an unavailable fallback sitemap emits only T37, not T18', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') return simplePage(url);
    if (url.endsWith('/sitemap.xml')) return result(url, { status: 503, type: 'application/xml' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  const ids = findingIds(snapshot);
  assert.ok(ids.has('T37'));
  assert.equal(ids.has('T18'), false);
});

test('S23 robots policies remain isolated by scheme', async () => {
  const calls = [];
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    calls.push(url);
    if (url === 'https://a.com/robots.txt') return result(url, {
      body: 'User-agent: KinsuiSEOCheck\nDisallow: /secret', type: 'text/plain',
      ourPolicy: { policy: 'rules', rulesCount: 1 },
    });
    if (url === 'http://a.com/robots.txt') return allowRobots(url);
    if (url === 'https://a.com/') return simplePage(url, '<a href="/secret">secret</a>');
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    return result(url, { status: kind === 'probe' ? 404 : 200 });
  });
  assert.equal(calls.includes('https://a.com/secret'), false);
  assert.equal(snapshot.limits.skippedByRobots, 1);
  assert.ok(calls.includes('http://a.com/robots.txt'));
});

test('A4 normalizeInputUrl 與 cleanUrl 大寫 pathname/search 的百分比編碼並讓 crawl 去重', async () => {
  assert.equal(
    normalizeInputUrl('https://a.com/%e6%9c%8d?q=%ab%2f#fragment'),
    'https://a.com/%E6%9C%8D?q=%AB%2F',
  );
  assert.equal(
    cleanUrl('/%e6%9c%8d?q=%ab%2f', 'https://a.com/base'),
    'https://a.com/%E6%9C%8D?q=%AB%2F',
  );

  const calls = [];
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    calls.push({ url, kind });
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') {
      return simplePage(url, '<a href="/%e6%9c%8d?q=%ab">lower</a><a href="/%E6%9C%8D?q=%AB">upper</a>');
    }
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    if (kind === 'probe') return result(url, { status: 404 });
    return simplePage(url);
  });
  const normalized = 'https://a.com/%E6%9C%8D?q=%AB';
  assert.equal(calls.filter((call) => call.kind === 'page' && call.url === normalized).length, 1);
  assert.equal(Object.keys(snapshot.discovered).filter((url) => url.includes('%E6%9C%8D')).length, 1);
  assert.equal(Object.keys(snapshot.discovered).some((url) => /%e6|%9c|%8d|%ab/u.test(url)), false);
});

test('A6 duplicateOf 頁面不加入 page_unanalyzable', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return allowRobots(url);
    if (url === 'https://a.com/') {
      return simplePage(url, '<a href="/canonical">canonical</a><a href="/alias">alias</a>');
    }
    if (url === 'https://a.com/sitemap.xml') return result(url, { status: 404, type: 'application/xml' });
    if (url === 'https://a.com/alias') return result(url, { status: 301, location: '/canonical' });
    if (kind === 'probe') return result(url, { status: 404 });
    return simplePage(url);
  });
  const duplicate = snapshot.pages.find((entry) => entry.url === 'https://a.com/alias');
  assert.equal(duplicate.finalUrl, 'https://a.com/canonical');
  assert.equal(duplicate.duplicateOf, 'https://a.com/canonical');
  assert.equal(duplicate.page, null);
  assert.equal(snapshot.coverage.reasons.includes('page_unanalyzable'), false);
  assert.equal(snapshot.coverage.status, 'complete');
});

test('A9 fallback sitemap 404/410 為 missing，觸發 T18 且不觸發 T37', async () => {
  for (const status of [404, 410]) {
    const snapshot = await audit('https://a.com/', async (url, kind) => {
      if (kind === 'robots') return allowRobots(url);
      if (url === 'https://a.com/') return simplePage(url);
      if (url === 'https://a.com/sitemap.xml') return result(url, { status, type: 'application/xml' });
      if (kind === 'probe') return result(url, { status: 404 });
      return simplePage(url);
    });
    assert.deepEqual(snapshot.sitemaps[0], {
      url: 'https://a.com/sitemap.xml',
      status,
      kind: 'missing',
      urlCount: 0,
      fallback: true,
      error: null,
      truncated: false,
      accessBlocked: false,
    });
    const ids = findingIds(snapshot);
    assert.ok(ids.has('T18'));
    assert.equal(ids.has('T37'), false);
    assert.equal(snapshot.coverage.reasons.includes('sitemap_unverifiable'), false);
  }
});

test('A9 宣告 sitemap 的 404 維持 error，觸發 T37 而不觸發 T18', async () => {
  const snapshot = await audit('https://a.com/', async (url, kind) => {
    if (kind === 'robots') return result(url, {
      body: 'User-agent: *\nAllow: /\nSitemap: https://a.com/declared.xml',
      type: 'text/plain',
      ourPolicy: { policy: 'allow_all', rulesCount: 0 },
    });
    if (url === 'https://a.com/') return simplePage(url);
    if (url === 'https://a.com/declared.xml') return result(url, { status: 404, type: 'application/xml' });
    if (kind === 'probe') return result(url, { status: 404 });
    return simplePage(url);
  });
  assert.equal(snapshot.sitemaps[0].fallback, false);
  assert.equal(snapshot.sitemaps[0].kind, 'error');
  const ids = findingIds(snapshot);
  assert.ok(ids.has('T37'));
  assert.equal(ids.has('T18'), false);
});

test('A10 首頁不可分析時停止 sitemap、其他頁面與 probes', async () => {
  const calls = [];
  const snapshot = await audit('https://a.com/start', async (url, kind) => {
    calls.push({ url, kind });
    if (kind === 'robots') return result(url, {
      body: 'User-agent: *\nAllow: /\nSitemap: https://a.com/declared.xml',
      type: 'text/plain',
      ourPolicy: { policy: 'allow_all', rulesCount: 0 },
    });
    if (url === 'https://a.com/') return result(url, { status: 200, body: 'plain text', type: 'text/plain' });
    throw new Error(`unexpected request: ${kind} ${url}`);
  });
  assert.deepEqual(calls, [
    { url: 'https://a.com/robots.txt', kind: 'robots' },
    { url: 'https://a.com/', kind: 'page' },
  ]);
  assert.equal(snapshot.pages.length, 1);
  assert.deepEqual(snapshot.sitemaps, []);
  assert.deepEqual(snapshot.probes, { soft404: null, http: null });
  assert.equal(snapshot.limits.requests, 1);
  assert.equal(snapshot.coverage.status, 'failed');
  assert.ok(snapshot.coverage.reasons.includes('home_not_analyzable'));
});
