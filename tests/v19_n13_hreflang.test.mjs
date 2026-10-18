// SPEC-002 §7 / §10 N13 — hreflangs in extractPage and checks T40 / T41 / T42
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { extractPage } from '../public/core/parse.js';
import { SOURCES } from '../public/core/sources.js';
import { cached } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as V from './helpers/scenarios_v19.mjs';
import { T40, T41, T42 } from './helpers/copy_v19.mjs';

const extract = (html, url = 'https://a.com/') => extractPage(new DOMParser().parseFromString(html, 'text/html'), url);
const head = (links) => `<!doctype html><html><head><title>t</title>${links}</head><body><p>x</p></body></html>`;

// ------------------------------------------------------------------ parse
test('N13 hreflangs: two alternate links -> two entries with absolute href', () => {
  const p = extract(head('<link rel="alternate" hreflang="zh-TW" href="/"><link rel="alternate" hreflang="en" href="/en/">'));
  assert.deepEqual(p.hreflangs, [
    { lang: 'zh-TW', href: 'https://a.com/' },
    { lang: 'en', href: 'https://a.com/en/' },
  ]);
});

test('N13 hreflangs: rel token match (case-insensitive, multi-token), hreflang attribute required, lang trimmed as-is, invalid href -> null', () => {
  const p = extract(
    head(
      '<link rel="ALTERNATE" hreflang=" en-US " href="https://a.com/en-us/">' +
        '<link rel="alternate stylesheet" hreflang="fr" href="/fr/">' +
        '<link rel="alternate" type="application/rss+xml" href="/feed">' +
        '<link rel="alternates" hreflang="de" href="/de/">' +
        '<link rel="canonical" hreflang="x" href="/c">' +
        '<link rel="alternate" hreflang="ja" href="javascript:x">' +
        '<link rel="alternate" hreflang="x-default" href="https://a.com/#top">' +
        '<link rel="alternate" hreflang="" href="/empty">',
    ),
  );
  const langs = p.hreflangs.map((h) => h.lang);
  assert.ok(langs.includes('en-US'), 'trimmed, case kept');
  assert.ok(langs.includes('fr'), 'rel with several tokens');
  assert.ok(!langs.includes('de'), 'rel="alternates" is not the alternate token');
  assert.ok(!langs.includes('x'), 'rel canonical does not count');
  assert.ok(!p.hreflangs.some((h) => h.href === 'https://a.com/feed'), 'alternate without hreflang is not collected');
  const ja = p.hreflangs.find((h) => h.lang === 'ja');
  assert.ok(ja);
  assert.equal(ja.href, null, 'javascript: href -> null');
  const xd = p.hreflangs.find((h) => h.lang === 'x-default');
  assert.equal(xd.href, 'https://a.com/', 'fragment removed');
  assert.equal(p.canonicals.length, 1, 'other fields untouched');
});

test('N13 hreflangs: relative hrefs resolve against <base href>; at most 200 entries', () => {
  const p = extract('<!doctype html><html><head><base href="https://a.com/sub/"><link rel="alternate" hreflang="en" href="en/"></head><body></body></html>', 'https://a.com/x/y');
  assert.deepEqual(p.hreflangs, [{ lang: 'en', href: 'https://a.com/sub/en/' }]);
  const many = Array.from({ length: 205 }, (_, i) => `<link rel="alternate" hreflang="en-${String(i).padStart(3, '0')}" href="/l${i}/">`).join('');
  const q = extract(head(many));
  assert.equal(q.hreflangs.length, 200);
  assert.equal(q.hreflangs[0].lang, 'en-000');
});

// ------------------------------------------------------------------ checks
const has = (r, id) => r.ids.includes(id);

function assertT(f, id, copy, evidence) {
  assert.equal(f.id, id);
  assert.equal(f.section, 'tech');
  assert.equal(f.severity, 'P3');
  assert.equal(f.evidence, evidence);
  assert.equal(f.scored, true);
  assert.equal(f.title, copy.title);
  assert.equal(f.summary, copy.summary);
  assert.ok(f.sources.includes('google-hreflang'), id + ' cites google-hreflang');
  assert.ok(SOURCES['google-hreflang']);
}

test('N13 reciprocal zh-TW / en hreflang -> two hreflangs on the home page, no T40 / T41 / T42', async () => {
  const r = await cached('hreflangOk', V.hreflangOk);
  const home = r.snapshot.pages[0].page;
  assert.equal(home.hreflangs.length, 2);
  assert.ok(home.links.some((l) => l.url === 'https://a.com/en/' && l.text.includes('/en/')), 'home links to /en/');
  for (const id of ['T40', 'T41', 'T42']) assert.ok(!has(r, id), id + ' must not fire: ' + r.ids.join(','));
});

test('N13 hreflang="xx-123-yy" -> T40 P3 verified with copy; urls contain the page', async () => {
  const r = await cached('hreflang_xx-123-yy', V.hreflangCode('xx-123-yy'));
  assert.ok(has(r, 'T40'), r.ids.join(','));
  assertT(r.byId.T40, 'T40', T40, 'verified');
  assert.equal(r.byId.T40.code, 'hreflang_invalid');
  assert.ok(r.byId.T40.urls.includes('https://a.com/'));
  assert.equal(r.byId.T40.count, 1);
});

test('N13 invalid codes -> T40: zh_TW (underscore), english (7 letters), en-, e, EN-USA, zh-Hant-TW-x', async () => {
  for (const code of ['zh_TW', 'english', 'en-', 'e', 'EN-USA', 'zh-Hant-TW-x', '123']) {
    const r = await cached('hreflang_' + code, V.hreflangCode(code));
    assert.ok(has(r, 'T40'), code + ': ' + r.ids.join(','));
    assert.ok(r.byId.T40.urls.includes('https://a.com/'), code);
  }
});

test('N13 hreflang="eu" is a well-formed two-letter code -> no T40 (reserved codes are not judged); other valid shapes too', async () => {
  for (const code of ['eu', 'EN', 'en-US', 'en-gb', 'zh-Hant', 'zh-Hant-TW', 'es-419', 'ast', 'x-default', 'X-DEFAULT']) {
    const r = await cached('hreflang_' + code, V.hreflangCode(code));
    assert.ok(!has(r, 'T40'), code + ' must not trigger T40: ' + r.ids.join(','));
    assert.ok(!has(r, 'T41'), code + ': self is listed');
    assert.ok(!has(r, 'T42'), code);
  }
});

test('N13 href="javascript:x" -> hreflangs entry with href null -> T40', async () => {
  const r = await cached('hreflangBadHref', V.hreflangBadHref);
  const home = r.snapshot.pages[0].page;
  assert.ok(home.hreflangs.some((h) => h.lang === 'en' && h.href === null));
  assert.ok(has(r, 'T40'), r.ids.join(','));
  assertT(r.byId.T40, 'T40', T40, 'verified');
  assert.ok(r.byId.T40.urls.includes('https://a.com/'));
});

test('N13 href pointing at a crawled 404 page -> T40 (lookupTarget 404／410)', async () => {
  const r = await cached('hreflang404', V.hreflang404);
  const gone = r.snapshot.pages.find((p) => p.url === 'https://a.com/gone');
  assert.ok(gone && gone.status === 404, '/gone crawled as 404');
  assert.ok(has(r, 'T40'), r.ids.join(','));
  assert.ok(r.byId.T40.urls.includes('https://a.com/'));
});

test('N13 all hrefs valid but none is the page itself -> T41 P3 verified; no T40', async () => {
  const r = await cached('hreflangNoSelf', V.hreflangNoSelf);
  const home = r.snapshot.pages[0].page;
  assert.equal(home.hreflangs.length, 2);
  assert.ok(home.hreflangs.every((h) => h.href !== null));
  assert.ok(has(r, 'T41'), r.ids.join(','));
  assertT(r.byId.T41, 'T41', T41, 'verified');
  assert.equal(r.byId.T41.code, 'hreflang_no_self');
  assert.ok(r.byId.T41.urls.includes('https://a.com/'));
  assert.ok(!has(r, 'T40'));
  assert.ok(!has(r, 'T42'), 'the page has hreflangs');
});

test('N13 an hreflang equal to the page\'s unique canonical counts as self -> no T41', async () => {
  const r = await cached('hreflangSelfByCanonical', V.hreflangSelfByCanonical);
  const p2 = r.snapshot.pages.find((p) => p.url === 'https://a.com/p2');
  assert.ok(p2 && p2.page, '/p2 analyzable');
  assert.deepEqual(p2.page.canonicals, ['https://a.com/p-canon']);
  assert.ok(p2.page.hreflangs.some((h) => h.href === 'https://a.com/p-canon'));
  if (has(r, 'T41')) assert.ok(!r.byId.T41.urls.includes('https://a.com/p2'), '/p2 lists its canonical');
  assert.ok(!has(r, 'T40'));
});

test('N13 home without hreflang but with <a href="/en/">English</a> -> T42 P3 inferred', async () => {
  const r = await cached('hreflangMissing', () => V.hreflangMissing());
  const home = r.snapshot.pages[0].page;
  assert.deepEqual(home.hreflangs, []);
  assert.ok(has(r, 'T42'), r.ids.join(','));
  assertT(r.byId.T42, 'T42', T42, 'inferred');
  assert.equal(r.byId.T42.code, 'hreflang_missing');
  assert.ok(r.byId.T42.urls.includes('https://a.com/'));
  assert.equal(r.byId.T42.count, 1);
  assert.ok(!has(r, 'T40') && !has(r, 'T41'));
});

test('N13 language switch detected by the first path segment (/ja/ with non-listed text); not by unrelated text/path', async () => {
  const byPath = await cached('hreflangMissingByPath', V.hreflangMissingByPath);
  assert.ok(has(byPath, 'T42'), byPath.ids.join(','));
  const neg = await cached('hreflangMissingNegative', V.hreflangMissingNegative);
  assert.ok(!has(neg, 'T42'), '"English Version Page" + /global/ is not a language switch: ' + neg.ids.join(','));
  for (const text of ['日本語', '简体中文', '繁體中文', 'ภาษาไทย', 'Tiếng Việt', 'ENGLISH', '英文']) {
    const r = await cached('hreflangMissingText_' + text, () => V.hreflangMissing({ href: '/lang-' + encodeURIComponent(text) + '/', text }));
    assert.ok(has(r, 'T42'), text + ': ' + r.ids.join(','));
  }
  for (const seg of ['en-us', 'zh-cn', 'kr', 'de', 'ID']) {
    const r = await cached('hreflangMissingSeg_' + seg, () => V.hreflangMissing({ href: `/${seg}/page`, text: '這裡' }));
    assert.ok(has(r, 'T42'), seg + ': ' + r.ids.join(','));
  }
});

test('N13 single-language sites (S01, S06, S13) have no T40–T42', async () => {
  for (const [name, b] of [['s01', S.s01], ['s06', S.s06], ['s13', S.s13]]) {
    const r = await cached(name, b);
    for (const id of ['T40', 'T41', 'T42']) assert.ok(!has(r, id), `${name} ${id}`);
  }
});

test('N13 T40–T42 only run when the home page is analyzable (home 503 -> none, even with a language link elsewhere)', async () => {
  const r = await cached('s20', S.s20);
  assert.equal(r.snapshot.homeAnalyzable, false);
  for (const id of ['T40', 'T41', 'T42']) assert.ok(!has(r, id), id);
});
