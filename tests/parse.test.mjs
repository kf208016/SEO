// SPEC-001 §5.2 parse.js and §5.3 sitemap.js — P01–P10
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { decodeBody, extractPage, fnv1a, normText, PARSE_LIMITS } from '../public/core/parse.js';
import { parseSitemap, looksLikeHtml } from '../public/core/sitemap.js';

const enc = new TextEncoder();
const doc = (html) => new DOMParser().parseFromString(html, 'text/html');
const extract = (html, url = 'https://a.com/page') => extractPage(doc(html), url);

// Big5 bytes for 中文測試
const BIG5_TITLE = [0xa4, 0xa4, 0xa4, 0xe5, 0xb4, 0xfa, 0xb8, 0xd5];
const TITLE = '中文測試';

function concat(...parts) {
  const arrs = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function titleOf(bytes, contentType) {
  const text = decodeBody(bytes, contentType);
  assert.equal(typeof text, 'string');
  return extract(text).title;
}

test('PARSE_LIMITS constants', () => {
  assert.deepEqual(PARSE_LIMITS, { links: 2000, images: 1000, jsonldBlocks: 50, jsonldChars: 100000, jsonDepth: 32, jsonNodes: 10000, textChars: 200000 });
});

test('P01 big5 page declared by <meta charset> (no charset in content-type) decodes the title', () => {
  const bytes = concat('<!doctype html><html><head><meta charset="big5"><title>', BIG5_TITLE, '</title></head><body></body></html>');
  assert.equal(titleOf(bytes, 'text/html'), TITLE);
});

test('P01b big5 declared via http-equiv content-type meta', () => {
  const bytes = concat('<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=big5"><title>', BIG5_TITLE, '</title></head><body></body></html>');
  assert.equal(titleOf(bytes, 'text/html'), TITLE);
});

test('P02 content-type charset wins over <meta charset>', () => {
  const bytes = concat('<!doctype html><html><head><meta charset="utf-8"><title>', BIG5_TITLE, '</title></head></html>');
  assert.equal(titleOf(bytes, 'text/html; charset="Big5"'), TITLE);
  const utf8 = concat('<!doctype html><html><head><meta charset="big5"><title>', TITLE, '</title></head></html>');
  assert.equal(titleOf(utf8, 'text/html; CHARSET=UTF-8'), TITLE);
});

test('P03 UTF-8 BOM wins over a big5 content-type', () => {
  const bytes = concat([0xef, 0xbb, 0xbf], '<!doctype html><html><head><meta charset="big5"><title>', TITLE, '</title></head></html>');
  assert.equal(titleOf(bytes, 'text/html; charset=big5'), TITLE);
});

test('P03b UTF-16LE / UTF-16BE BOMs are honoured', () => {
  const s = '<!doctype html><html><head><title>中文</title></head></html>';
  const le = [0xff, 0xfe];
  const be = [0xfe, 0xff];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    le.push(c & 0xff, c >> 8);
    be.push(c >> 8, c & 0xff);
  }
  assert.equal(titleOf(Uint8Array.from(le), 'text/html; charset=utf-8'), '中文');
  assert.equal(titleOf(Uint8Array.from(be), 'text/html'), '中文');
});

test('decodeBody: unknown charset label falls back to utf-8; no declaration -> utf-8', () => {
  const bytes = concat('<!doctype html><html><head><title>', TITLE, '</title></head></html>');
  assert.equal(titleOf(bytes, 'text/html; charset=x-made-up'), TITLE);
  assert.equal(titleOf(bytes, null), TITLE);
});

test('P04 <base href> resolves a relative canonical', () => {
  const p = extract('<!doctype html><html><head><base href="https://a.com/sub/"><link rel="canonical" href="page"></head><body></body></html>', 'https://a.com/x/y');
  assert.deepEqual(p.canonicals, ['https://a.com/sub/page']);
  assert.equal(p.canonicalTagCount, 1);
});

test('P04 JSON-LD @graph and array @type are collected; broken JSON-LD -> ok=false', () => {
  const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: 'A' }, { '@type': ['WebSite', 'Thing'] }] };
  const arr = [{ '@type': 'Product' }, { '@type': 'Offer' }];
  const p = extract(
    `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(graph)}</script><script type="application/ld+json">${JSON.stringify(arr)}</script><script type="application/ld+json">{ "@type": "Thing", </script></head><body></body></html>`,
  );
  assert.equal(p.jsonld.length, 3);
  assert.equal(p.jsonld[0].ok, true);
  for (const t of ['Organization', 'WebSite', 'Thing']) assert.ok(p.jsonld[0].types.includes(t), t);
  assert.equal(p.jsonld[1].ok, true);
  for (const t of ['Product', 'Offer']) assert.ok(p.jsonld[1].types.includes(t), t);
  assert.equal(p.jsonld[2].ok, false);
});

test('P04 visible text excludes script/style/noscript/template/svg', () => {
  const p = extract(
    '<!doctype html><html><head><title>t</title><style>.a{color:red}</style></head><body><p>Hello</p><script>var secret = 1;</script><style>.b{}</style><noscript>enable js</noscript><template><p>tpl</p></template><svg><text>svgtext</text></svg><p>  World  </p></body></html>',
  );
  // "Hello World" after whitespace collapsing
  assert.equal(p.textLength, 'Hello World'.length);
});

test('P04 #root -> hasSpaRoot and spaRootTextLength', () => {
  const p = extract('<!doctype html><html><head><title>t</title></head><body><div id="root"><span>Hi</span> <b>there</b></div><p>outside text</p></body></html>');
  assert.equal(p.hasSpaRoot, true);
  assert.equal(p.spaRootTextLength, 'Hi there'.length);
  const q = extract('<!doctype html><html><head><title>t</title></head><body><main>x</main></body></html>');
  assert.equal(q.hasSpaRoot, false);
  assert.equal(q.spaRootTextLength, null);
  for (const id of ['app', '__next', '__nuxt', 'svelte', '___gatsby']) {
    assert.equal(extract(`<!doctype html><html><body><div id="${id}"></div></body></html>`).hasSpaRoot, true, id);
  }
});

test('P04 alt="" counts as hasAlt; missing alt does not', () => {
  const p = extract('<!doctype html><html><body><img src="/a.png" alt=""><img src="/b.png"><img src="/c.png" alt="說明"></body></html>');
  assert.equal(p.images.length, 3);
  assert.equal(p.images[0].hasAlt, true);
  assert.equal(p.images[1].hasAlt, false);
  assert.equal(p.images[2].hasAlt, true);
  assert.equal(p.images[2].alt, '說明');
});

test('P04 upper-case <META NAME="ROBOTS" CONTENT="NOINDEX"> -> metaRobots ["noindex"]', () => {
  const p = extract('<!doctype html><html><head><META NAME="ROBOTS" CONTENT="NOINDEX"><title>t</title></head><body></body></html>');
  assert.deepEqual(p.metaRobots, ['noindex']);
});

test('P04 <link rel="canonical" href="javascript:x"> -> canonicalTagCount 1, canonicals []', () => {
  const p = extract('<!doctype html><html><head><link rel="canonical" href="javascript:x"></head><body></body></html>');
  assert.equal(p.canonicalTagCount, 1);
  assert.deepEqual(p.canonicals, []);
});

test('P04 extractPage returns every documented field', () => {
  const p = extract('<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>');
  for (const k of ['url', 'title', 'titleCount', 'metaDescription', 'metaRobots', 'metaBingbot', 'canonicals', 'canonicalTagCount', 'h1', 'lang', 'hasViewport', 'og', 'jsonld', 'links', 'images', 'insecureResources', 'textLength', 'textHash', 'scriptCount', 'scriptSrcCount', 'hasSpaRoot', 'spaRootTextLength', 'dataNosnippetCount', 'metaRefresh', 'limitsHit']) {
    assert.ok(k in p, k);
  }
  for (const k of ['title', 'description', 'image', 'url']) assert.ok(k in p.og, 'og.' + k);
  assert.ok(Array.isArray(p.limitsHit));
  assert.equal(p.metaRefresh, null);
});

test('extractPage: titles, description, lang, viewport, h1, og, meta robots merge', () => {
  const p = extract(
    '<!doctype html><html lang="zh-TW"><head><title>  第一  </title><title>第二</title><meta name="Description" content=" 說明文字 "><meta name="viewport" content="width=device-width"><meta name="robots" content="NoIndex, Nofollow"><meta name="googlebot" content="noindex, nosnippet"><meta property="og:title" content="OG 標題"><meta property="og:image" content="https://a.com/og.png"></head><body><h1> 主標題 </h1></body></html>',
  );
  assert.equal(p.title, '第一');
  assert.equal(p.titleCount, 2);
  assert.equal(p.metaDescription, '說明文字');
  assert.equal(p.lang, 'zh-TW');
  assert.equal(p.hasViewport, true);
  assert.equal(p.h1, '主標題');
  assert.equal(p.og.title, 'OG 標題');
  assert.equal(p.og.image, 'https://a.com/og.png');
  assert.deepEqual([...p.metaRobots].sort(), ['noindex', 'nofollow', 'nosnippet'].sort());
  assert.equal(p.metaRobots.length, 3);
});

test('extractPage: empty strings become null', () => {
  const p = extract('<!doctype html><html lang=""><head><title>   </title><meta name="description" content=""></head><body></body></html>');
  assert.equal(p.title, null);
  assert.equal(p.titleCount, 1);
  assert.equal(p.metaDescription, null);
  assert.equal(p.lang, null);
  assert.equal(p.hasViewport, false);
});

test('extractPage: canonicals de-duplicated, fragments removed; scriptCount excludes ld+json', () => {
  const p = extract(
    '<!doctype html><html><head><link rel="canonical" href="https://a.com/p#x"><link rel="CANONICAL" href="/p"><link rel="canonical" href="https://a.com/q"><script src="/a.js"></script><script>inline()</script><script type="application/ld+json">{"@type":"Thing"}</script></head><body></body></html>',
    'https://a.com/p',
  );
  assert.deepEqual(p.canonicals, ['https://a.com/p', 'https://a.com/q']);
  assert.equal(p.canonicalTagCount, 3);
  assert.equal(p.scriptSrcCount, 1);
  assert.equal(p.scriptCount, 2);
});

test('P05 parseSitemap urlset with entities, CDATA and whitespace', () => {
  const xml = '﻿<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>  https://a.com/  </loc></url>\n<url><loc>https://a.com/b?x=1&amp;y=2</loc></url>\n<url><loc><![CDATA[https://a.com/c?a=1&b=2]]></loc></url>\n<url><loc>   </loc></url>\n</urlset>';
  const r = parseSitemap(xml);
  assert.equal(r.kind, 'urlset');
  assert.deepEqual(r.urls, ['https://a.com/', 'https://a.com/b?x=1&y=2', 'https://a.com/c?a=1&b=2']);
});

test('P05 parseSitemap sitemapindex', () => {
  const r = parseSitemap('<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://a.com/s1.xml</loc></sitemap><sitemap><loc>https://a.com/s2.xml</loc></sitemap></sitemapindex>');
  assert.equal(r.kind, 'index');
  assert.deepEqual(r.urls, ['https://a.com/s1.xml', 'https://a.com/s2.xml']);
});

test('P05 parseSitemap with namespace prefixes', () => {
  const r = parseSitemap('<?xml version="1.0"?><sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://a.com/p</sm:loc></sm:url></sm:urlset>');
  assert.equal(r.kind, 'urlset');
  assert.deepEqual(r.urls, ['https://a.com/p']);
  const i = parseSitemap('<x:sitemapindex xmlns:x="ns"><x:sitemap><x:loc>https://a.com/s.xml</x:loc></x:sitemap></x:sitemapindex>');
  assert.equal(i.kind, 'index');
  assert.deepEqual(i.urls, ['https://a.com/s.xml']);
});

test('P05 parseSitemap invalid documents', () => {
  assert.equal(parseSitemap('<!doctype html><html><body>not a sitemap</body></html>').kind, 'invalid');
  assert.equal(parseSitemap('<rss version="2.0"><channel><link>https://a.com/</link></channel></rss>').kind, 'invalid');
  assert.equal(parseSitemap('').kind, 'invalid');
});

test('P05 parseSitemap caps at 5,000 URLs', () => {
  const xml = '<urlset>' + Array.from({ length: 5001 }, (_, i) => `<url><loc>https://a.com/p${i}</loc></url>`).join('') + '</urlset>';
  const r = parseSitemap(xml);
  assert.equal(r.urls.length, 5000);
  assert.equal(r.urls[0], 'https://a.com/p0');
});

test('P05 looksLikeHtml', () => {
  assert.equal(looksLikeHtml('<urlset></urlset>', 'text/html; charset=utf-8'), true);
  assert.equal(looksLikeHtml('   \n<!DOCTYPE html><html><body></body></html>', 'application/xml'), true);
  assert.equal(looksLikeHtml('<HTML><body></body></HTML>', null), true);
  assert.equal(looksLikeHtml('<?xml version="1.0"?><urlset></urlset>', 'application/xml'), false);
});

test('P06 fnv1a test vectors', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  assert.equal(fnv1a('foobar'), 'bf9cf968');
});

test('P06b fnv1a hashes the UTF-8 bytes', () => {
  // reference FNV-1a 32-bit over UTF-8 bytes
  const ref = (s) => {
    let h = 0x811c9dc5;
    for (const b of enc.encode(s)) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  assert.equal(ref('foobar'), 'bf9cf968');
  assert.equal(fnv1a('中文'), ref('中文'));
});

test('normText: NFKC, whitespace collapsed, trimmed', () => {
  assert.equal(normText('  Ａ　B\n\t C  '), 'A B C');
  assert.equal(normText('ｈｅｌｌｏ'), 'hello');
});

test('P07 insecureResources: http script/stylesheet/iframe, not img', () => {
  const p = extract(
    '<!doctype html><html><head><script src="http://cdn.example.org/a.js"></script><link rel="stylesheet" href="http://cdn.example.org/s.css"><script src="https://cdn.example.org/ok.js"></script></head><body><iframe src="http://video.example.org/embed"></iframe><img src="http://img.example.org/i.png" alt="x"></body></html>',
    'https://a.com/page',
  );
  const tags = p.insecureResources.map((r) => r.tag).sort();
  assert.deepEqual(tags, ['iframe', 'script', 'stylesheet']);
  const urls = p.insecureResources.map((r) => r.url);
  assert.ok(urls.includes('http://cdn.example.org/a.js'));
  assert.ok(urls.includes('http://cdn.example.org/s.css'));
  assert.ok(urls.includes('http://video.example.org/embed'));
  assert.ok(!urls.some((u) => u.includes('img.example.org')));
});

test('P08 <meta charset> after byte 1,500 is not used', () => {
  const bytes = concat('<!doctype html><html><head><!--', 'x'.repeat(1500), '--><meta charset="big5"><title>', BIG5_TITLE, '</title></head></html>');
  assert.notEqual(titleOf(bytes, 'text/html'), TITLE);
});

test('P09 metaRefresh "0; url=/new" -> { delay: 0, url: absolute }', () => {
  const p = extract('<!doctype html><html><head><meta http-equiv="refresh" content="0; url=/new"></head><body></body></html>', 'https://a.com/old');
  assert.deepEqual(p.metaRefresh, { delay: 0, url: 'https://a.com/new' });
  const q = extract('<!doctype html><html><head><META HTTP-EQUIV="Refresh" CONTENT="5; url=https://a.com/x"></head></html>', 'https://a.com/old');
  assert.deepEqual(q.metaRefresh, { delay: 5, url: 'https://a.com/x' });
});

test('P10 3,000 links -> 2,000 kept and limitsHit includes "links"', () => {
  const links = Array.from({ length: 3000 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('');
  const p = extract(`<!doctype html><html><body>${links}</body></html>`);
  assert.equal(p.links.length, 2000);
  assert.ok(p.limitsHit.includes('links'));
  assert.equal(p.links[0].url, 'https://a.com/p0');
});

test('P10 JSON-LD nested 40 levels does not throw and limitsHit includes "jsonDepth"', () => {
  let obj = { '@type': 'Thing', name: 'leaf' };
  for (let i = 0; i < 40; i++) obj = { '@type': 'Thing', child: obj };
  const p = extract(`<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`);
  assert.ok(p.limitsHit.includes('jsonDepth'));
  assert.equal(p.jsonld.length, 1);
});

test('extractPage: images capped at 1,000 with limitsHit "images"; JSON-LD block over jsonldChars -> too_large', () => {
  const imgs = Array.from({ length: 1001 }, (_, i) => `<img src="/i${i}.png" alt="">`).join('');
  const p = extract(`<!doctype html><html><body>${imgs}</body></html>`);
  assert.equal(p.images.length, 1000);
  assert.ok(p.limitsHit.includes('images'));
  const huge = JSON.stringify({ '@type': 'Thing', d: 'x'.repeat(100001) });
  const q = extract(`<!doctype html><html><head><script type="application/ld+json">${huge}</script></head></html>`);
  assert.equal(q.jsonld[0].ok, false);
  assert.equal(q.jsonld[0].error, 'too_large');
});
