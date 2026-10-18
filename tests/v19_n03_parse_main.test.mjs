// SPEC-002 §2.1 / §10 N03 — extractPage: headings, textPreview, mainTextLength, mainImageCount, mainAltChars, mainHasMedia
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { extractPage, PARSE_LIMITS } from '../public/core/parse.js';
import * as V from './helpers/scenarios_v19.mjs';

const doc = (html) => new DOMParser().parseFromString(html, 'text/html');
const extract = (html, url = 'https://a.com/landing') => extractPage(doc(html), url);
const len = (s) => Array.from(s).length;
const ALT_SUM = V.N03_ALTS.reduce((n, a) => n + len(a), 0);

test('N03 new fields always exist with the documented types', () => {
  const p = extract('<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>');
  assert.ok(Array.isArray(p.headings));
  assert.equal(typeof p.textPreview, 'string');
  assert.equal(typeof p.mainTextLength, 'number');
  assert.equal(typeof p.mainImageCount, 'number');
  assert.equal(typeof p.mainAltChars, 'number');
  assert.equal(typeof p.mainHasMedia, 'boolean');
  assert.ok(Array.isArray(p.hreflangs));
  assert.deepEqual(p.headings, []);
  assert.equal(p.textPreview, 'x');
  assert.equal(p.mainTextLength, 1);
  assert.equal(p.mainImageCount, 0);
  assert.equal(p.mainAltChars, 0);
  assert.equal(p.mainHasMedia, false);
});

test('N03 header(500) + main(40 chars, 5 imgs incl. one 16x16) + footer: headings h1/h2/h3 in order, preview <= 300, main numbers', () => {
  const p = extract(V.n03Html());
  assert.deepEqual(p.headings, [
    { level: 1, text: V.N03_H1 },
    { level: 2, text: V.N03_H2 },
    { level: 3, text: V.N03_H3 },
  ]);
  assert.ok(len(p.textPreview) <= 300, 'preview length ' + len(p.textPreview));
  assert.equal(len(p.textPreview), 300, 'the page has more than 300 visible chars so the preview is exactly 300');
  assert.ok(p.textLength > 300);
  assert.ok(p.textPreview.startsWith(V.N03_H1), 'preview starts with the first visible text');
  assert.equal(p.mainTextLength, 40);
  assert.equal(p.mainImageCount, 4, '5 imgs minus the 16x16 icon');
  assert.equal(p.mainAltChars, ALT_SUM);
  assert.equal(p.mainHasMedia, false);
  // existing fields are untouched: all 5 main imgs + header/nav/aside/footer imgs are still in images
  assert.equal(p.images.length, 9);
  assert.equal(p.title, '範例產品頁');
});

test('N03 textPreview is the first 300 chars (Array.from) of the visible text; short pages keep the whole text', () => {
  // SPEC-001 §5.2 leaves open whether element boundaries count as whitespace, so compare ignoring whitespace
  const long = extract(V.n03Html());
  assert.equal(len(long.textPreview), 300);
  const noWs = long.textPreview.replace(/\s+/g, '');
  assert.ok(noWs.length >= 290 && V.N03_HEADER_TEXT.startsWith(noWs), 'preview is the beginning of the visible text (header first): ' + noWs.slice(0, 40));
  const short = extract(V.rawDoc({ body: '<p>短文字😀</p>' }));
  assert.equal(short.textPreview, '短文字😀');
  assert.equal(short.textLength, 4);
  assert.equal(short.mainTextLength, 4);
  // surrogate pairs count as one character
  const emoji = extract(V.rawDoc({ body: '<p>' + '😀'.repeat(310) + '</p>' }));
  assert.equal(len(emoji.textPreview), 300);
  assert.equal(emoji.mainTextLength, 310);
});

test('N03 <video> in main -> mainHasMedia true; canvas / iframe / object / embed too; media outside main does not count', () => {
  assert.equal(extract(V.n03Html({ video: true })).mainHasMedia, true);
  assert.equal(extract(V.n03Html({ iframe: true })).mainHasMedia, true);
  for (const tag of ['<canvas></canvas>', '<object data="/x.swf"></object>', '<embed src="/x.swf">']) {
    assert.equal(extract(V.n03Html({ extraMain: tag })).mainHasMedia, true, tag);
  }
  const outside = extract(V.rawDoc({ body: '<main><p>主文</p></main><footer><video src="/v.mp4"></video></footer>' }));
  assert.equal(outside.mainHasMedia, false);
});

test('N03 without <main>: body is the main area and nav/header/footer/aside subtrees are skipped (text and images)', () => {
  const p = extract(V.n03Html({ main: false }));
  assert.equal(p.mainTextLength, 40, 'header 500 chars, nav/aside/footer text excluded');
  assert.equal(p.mainImageCount, 4, 'imgs inside header/nav/aside/footer excluded');
  assert.equal(p.mainAltChars, ALT_SUM);
  assert.equal(p.mainHasMedia, false);
  assert.deepEqual(p.headings.map((h) => h.level), [1, 2, 3]);
  const withVideo = extract(V.n03Html({ main: false, video: true }));
  assert.equal(withVideo.mainHasMedia, true);
});

test('N03 the first <main> wins; a header inside main is still skipped', () => {
  const p = extract(V.rawDoc({ body: '<main><header><p>' + '頭'.repeat(30) + '</p><img src="/h.png" alt="hh"></header><p>' + '主'.repeat(12) + '</p><img src="/a.png" alt="甲"></main><main><p>' + '次'.repeat(100) + '</p></main>' }));
  assert.equal(p.mainTextLength, 12);
  assert.equal(p.mainImageCount, 1);
  assert.equal(p.mainAltChars, 1);
});

test('N03 main image rules: both width and height <= 50 excluded; one dimension only or > 50 counted; alt of excluded icons not summed; no alt counts 0', () => {
  const body = (imgs) => `<main><p>文</p>${imgs}</main>`;
  const a = extract(V.rawDoc({ body: body('<img src="/1.png" width="50" height="50" alt="小圖示"><img src="/2.png" width="51" height="50" alt="甲"><img src="/3.png" width="16" alt="乙乙"><img src="/4.png" height="16" alt="丙丙丙"><img src="/5.png">') }));
  assert.equal(a.mainImageCount, 4);
  assert.equal(a.mainAltChars, 1 + 2 + 3);
  const icon = extract(V.n03Html({ iconAlt: '這是一個很長的圖示替代文字應該不計入總和' }));
  assert.equal(icon.mainImageCount, 4);
  assert.equal(icon.mainAltChars, ALT_SUM, 'alt of the excluded 16x16 icon is not counted');
  const empty = extract(V.rawDoc({ body: body('<img src="/1.png" alt=""><img src="/2.png" alt="   "><img src="/3.png" alt=" 全　形 ">') }));
  assert.equal(empty.mainImageCount, 3);
  assert.equal(empty.mainAltChars, len('全 形'), 'normText collapses the whitespace');
});

test('N03 headings: only h1–h3, document order, at most 30, text cut to 200 chars, empty ones skipped', () => {
  const many = Array.from({ length: 35 }, (_, i) => `<h2>標題 ${i + 1}</h2>`).join('');
  const p = extract(V.rawDoc({ body: `<h1>主</h1><h4>四</h4><h3>  三　三 </h3><h2>   </h2>${many}` }));
  assert.equal(p.headings.length, 30);
  assert.deepEqual(p.headings.slice(0, 2), [
    { level: 1, text: '主' },
    { level: 3, text: '三 三' },
  ]);
  assert.ok(p.headings.every((h) => [1, 2, 3].includes(h.level)));
  assert.ok(!p.headings.some((h) => h.text === '四'));
  assert.ok(!p.headings.some((h) => h.text === ''));
  const long = extract(V.rawDoc({ body: '<h2>' + '長'.repeat(250) + '</h2>' }));
  assert.equal(len(long.headings[0].text), 200);
});

test('N03 headings come from the whole document (not only main); hidden/skip elements do not add visible text', () => {
  const p = extract(V.rawDoc({ body: '<header><h1>頁首標題</h1></header><main><h2>主標</h2><script>var x=1</script><style>.a{}</style><noscript>enable</noscript><p>正文</p></main><footer><h3>頁尾標題</h3></footer>' }));
  assert.deepEqual(
    p.headings.map((h) => h.text),
    ['頁首標題', '主標', '頁尾標題'],
  );
  // mainTextLength follows the same visible-text rule as textLength: equal to textLength of a page holding only the main content
  const onlyMain = extract(V.rawDoc({ body: '<h2>主標</h2><p>正文</p>' }));
  assert.equal(p.mainTextLength, onlyMain.textLength, 'h2 text + p text inside main (script/style/noscript skipped)');
  assert.ok(p.mainTextLength >= 4 && p.mainTextLength <= 5);
});

test('N03 existing fields are unchanged by the new ones (textLength, textHash, images, links)', () => {
  const html = V.n03Html();
  const p = extract(html);
  // whole-page visible text still counts header / nav / aside / footer (552 chars plus whatever whitespace the
  // existing rule inserts between elements)
  const plain = len(V.N03_HEADER_TEXT + '首頁連結' + V.N03_MAIN_TEXT + '側欄文字頁尾文字');
  assert.ok(p.textLength >= plain && p.textLength <= plain + 12, `textLength ${p.textLength} ~ ${plain}`);
  assert.ok(p.textLength > p.mainTextLength, 'textLength is the whole page, mainTextLength only the main area');
  assert.equal(typeof p.textHash, 'string');
  assert.match(p.textHash, /^[0-9a-f]{8}$/);
  assert.equal(p.links.length, 1);
  assert.equal(p.links[0].url, 'https://a.com/');
  assert.equal(p.images.filter((i) => !i.hasAlt).length, 1, 'the icon has no alt');
  assert.ok(PARSE_LIMITS.textChars >= 200000);
});
