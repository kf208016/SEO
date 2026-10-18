// SPEC-002 §2.3 / §10 N04 — C14 image_only_content
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached } from './helpers/report_v19.mjs';
import { createFakeSite, goodSiteRoutes } from './helpers/fakesite.mjs';
import * as V from './helpers/scenarios_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import { C14 } from './helpers/copy_v19.mjs';

// ------------------------------------------------------------------ boundary pages (SPEC-002 §2.3 thresholds)
// Inner page whose <main> holds exactly one <p> of `textLen` chars and `imgCount` images without width/height;
// the alt lengths add up to `altTotal` (first images get 20 chars each, the last one the remainder).
const BOUNDARY_URL = 'https://a.com/landing';
function boundaryHtml({ imgCount, altTotal, textLen }) {
  const alts = [];
  let left = altTotal;
  for (let i = 0; i < imgCount; i++) {
    const n = i === imgCount - 1 ? left : Math.min(20, left);
    alts.push('圖'.repeat(n));
    left -= n;
  }
  const imgs = alts.map((alt, i) => `<img src="/img/b${i + 1}.png" alt="${alt}">`).join('');
  return V.rawDoc({
    title: '範例產品頁',
    url: BOUNDARY_URL,
    body: `<header><p>${'頭'.repeat(250)}</p></header><main><p>${'字'.repeat(textLen)}</p>${imgs}</main><footer><p>頁尾</p></footer>`,
  });
}
function boundarySite(opts) {
  const routes = goodSiteRoutes({ paths: ['/'], robots: 'User-agent: *\nDisallow:\n', sitemap: false, overrides: { '/': { page: { links: ['/landing'] } } } });
  routes[BOUNDARY_URL] = { html: boundaryHtml(opts) };
  return { site: createFakeSite({ routes }), start: V.START };
}
async function boundary(opts) {
  const key = `c14boundary:${opts.imgCount}:${opts.altTotal}:${opts.textLen}`;
  const r = await cached(key, () => boundarySite(opts));
  const entry = r.snapshot.pages.find((p) => p.url === BOUNDARY_URL);
  assert.ok(entry && entry.page, key + ': inner page crawled and analyzable');
  assert.equal(entry.page.mainImageCount, opts.imgCount, key + ': mainImageCount');
  assert.equal(entry.page.mainAltChars, opts.altTotal, key + ': mainAltChars');
  assert.equal(entry.page.mainTextLength, opts.textLen, key + ': mainTextLength');
  assert.equal(entry.page.mainHasMedia, false, key);
  assert.ok(!r.ids.includes('G06'), key + ': not a JS shell (no script)');
  return r;
}
const fires = (r) => r.ids.includes('C14') && r.byId.C14.urls.includes(BOUNDARY_URL);

test('N04 N03 page as an indexable inner page -> C14 content / P3 / inferred, count 1, copy verbatim, sources google-starter + google-helpful', async () => {
  const r = await cached('imageOnly', () => V.imageOnlySite());
  const url = 'https://a.com/landing';
  const entry = r.snapshot.pages.find((p) => p.url === url);
  assert.ok(entry && entry.page, 'inner page crawled and analyzable');
  assert.equal(entry.page.mainImageCount, 4);
  assert.equal(entry.page.mainTextLength, 40);
  assert.ok(entry.page.mainAltChars < 50);
  assert.equal(entry.page.mainHasMedia, false);
  assert.ok(r.ids.includes('C14'), 'C14 present: ' + r.ids.join(','));
  const f = r.byId.C14;
  assert.equal(f.code, 'image_only_content');
  assert.equal(f.section, 'content');
  assert.equal(f.severity, 'P3');
  assert.equal(f.evidence, 'inferred');
  assert.equal(f.scored, true);
  assert.equal(f.count, 1);
  assert.deepEqual(f.urls, [url]);
  assert.equal(f.title, C14.title);
  assert.equal(f.summary, C14.summary);
  assert.equal(f.fix, C14.fix);
  for (const s of ['google-starter', 'google-helpful']) assert.ok(f.sources.includes(s), s);
  assert.ok(!r.ids.includes('G06'), 'the page has 500+ chars in the header, so it is not a JS shell');
});

test('N04 title 作品集 -> no C14 (gallery-like pages are excluded)', async () => {
  const r = await cached('imageOnlyPortfolioTitle', () => V.imageOnlySite({ title: '作品集' }));
  assert.ok(r.snapshot.pages.find((p) => p.url === 'https://a.com/landing')?.page, 'page analyzable');
  assert.ok(!r.ids.includes('C14'));
});

test('N04 exclusion also by h1 (案例) and by the decoded URL path (/作品, /gallery, /photos)', async () => {
  const h1 = await cached('imageOnlyH1Case', () => V.imageOnlySite({ h1: '客戶案例' }));
  assert.ok(!h1.ids.includes('C14'), 'h1 客戶案例');
  for (const path of ['/%E4%BD%9C%E5%93%81', '/gallery', '/photos/2026']) {
    const r = await cached('imageOnlyPath' + path, () => V.imageOnlySite({ path }));
    assert.ok(r.snapshot.pages.length >= 2, path + ' crawled');
    assert.ok(!r.ids.includes('C14'), path);
  }
  // control: a neutral path keeps C14
  const ctl = await cached('imageOnlyNeutralPath', () => V.imageOnlySite({ path: '/intro-page' }));
  assert.ok(ctl.ids.includes('C14'));
});

test('N04 same page with an <iframe> in main -> mainHasMedia -> no C14', async () => {
  const r = await cached('imageOnlyIframe', () => V.imageOnlySite({ iframe: true }));
  const entry = r.snapshot.pages.find((p) => p.url === 'https://a.com/landing');
  assert.equal(entry.page.mainHasMedia, true);
  assert.ok(!r.ids.includes('C14'));
});

test('N04 mainTextLength 150 -> no C14; 119 -> C14 (boundary < 120)', async () => {
  const long = await cached('imageOnlyText150', () => V.imageOnlySite({ mainText: '字'.repeat(150) }));
  assert.equal(long.snapshot.pages.find((p) => p.url === 'https://a.com/landing').page.mainTextLength, 150);
  assert.ok(!long.ids.includes('C14'));
  const edge = await cached('imageOnlyText119', () => V.imageOnlySite({ mainText: '字'.repeat(119) }));
  assert.ok(edge.ids.includes('C14'));
  const edge2 = await cached('imageOnlyText120', () => V.imageOnlySite({ mainText: '字'.repeat(120) }));
  assert.ok(!edge2.ids.includes('C14'), '120 chars is not "< 120"');
});

test('N04 a G06 JS-shell page with 3 images and no text is reported as G06, never as C14', async () => {
  const r = await cached('jsShellWithImages', V.jsShellWithImages);
  const entry = r.snapshot.pages.find((p) => p.url === 'https://a.com/app');
  assert.ok(entry && entry.page, 'shell page analyzable');
  assert.equal(entry.page.mainImageCount, 3);
  assert.equal(entry.page.mainTextLength, 0);
  assert.ok(r.ids.includes('G06'), 'G06 present');
  assert.ok(r.byId.G06.urls.includes('https://a.com/app'));
  assert.ok(!r.ids.includes('C14'), 'no C14 for a G06 page');
});

test('N04 boundary mainImageCount: exactly 3 images (no width/height) -> C14; 2 images -> no C14; 4 -> C14', async () => {
  const three = await boundary({ imgCount: 3, altTotal: 0, textLen: 40 });
  assert.ok(fires(three), '3 images: ' + three.ids.join(','));
  assert.equal(three.byId.C14.count, 1);
  const two = await boundary({ imgCount: 2, altTotal: 0, textLen: 40 });
  assert.ok(!two.ids.includes('C14'), '2 images: ' + two.ids.join(','));
  const four = await boundary({ imgCount: 4, altTotal: 0, textLen: 40 });
  assert.ok(fires(four), '4 images');
});

test('N04 boundary mainAltChars: alt total exactly 49 -> C14; exactly 50 -> no C14 (3 images, 40 chars of text)', async () => {
  const under = await boundary({ imgCount: 3, altTotal: 49, textLen: 40 });
  assert.ok(fires(under), 'alt 49: ' + under.ids.join(','));
  const at = await boundary({ imgCount: 3, altTotal: 50, textLen: 40 });
  assert.ok(!at.ids.includes('C14'), 'alt 50 is not "< 50": ' + at.ids.join(','));
  const far = await boundary({ imgCount: 3, altTotal: 120, textLen: 40 });
  assert.ok(!far.ids.includes('C14'), 'alt 120');
});

test('N04 boundary mainTextLength: exactly 119 -> C14; exactly 120 -> no C14 (3 images, no alt)', async () => {
  const under = await boundary({ imgCount: 3, altTotal: 0, textLen: 119 });
  assert.ok(fires(under), 'text 119: ' + under.ids.join(','));
  const at = await boundary({ imgCount: 3, altTotal: 0, textLen: 120 });
  assert.ok(!at.ids.includes('C14'), 'text 120 is not "< 120": ' + at.ids.join(','));
  const zero = await boundary({ imgCount: 3, altTotal: 0, textLen: 0 });
  assert.ok(fires(zero), 'no text at all');
});

test('N04 boundary combinations: all three thresholds at their last firing value -> C14; any one at its limit -> no C14', async () => {
  const edge = await boundary({ imgCount: 3, altTotal: 49, textLen: 119 });
  assert.ok(fires(edge), 'imgs 3 / alt 49 / text 119: ' + edge.ids.join(','));
  const altLimit = await boundary({ imgCount: 3, altTotal: 50, textLen: 119 });
  assert.ok(!altLimit.ids.includes('C14'), 'alt 50');
  const textLimit = await boundary({ imgCount: 3, altTotal: 49, textLen: 120 });
  assert.ok(!textLimit.ids.includes('C14'), 'text 120');
  const imgLimit = await boundary({ imgCount: 2, altTotal: 49, textLen: 119 });
  assert.ok(!imgLimit.ids.includes('C14'), '2 images');
});

test('N04 healthy sites (S01, S06) have no C14', async () => {
  for (const [name, b] of [['s01', S.s01], ['s06', S.s06]]) {
    const r = await cached(name, b);
    assert.ok(!r.ids.includes('C14'), name);
  }
});
