// SPEC-002 §6 / §10 N12 — 15-page bucketed sampling: classifyUrl, orderCandidates, BUCKET_QUOTAS, pages[].bucket, limits.buckets
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, orderCandidates, BUCKET_QUOTAS } from '../public/core/crawl.js';
import { runPipeline } from './helpers/pipeline.mjs';
import { cached, reportOf } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as V from './helpers/scenarios_v19.mjs';
import { BUCKET_LABEL } from './helpers/copy_v19.mjs';

const u = (p) => new URL(p, 'https://a.com').href;
const cls = (p, anchors) => classifyUrl(u(p), anchors);

test('N12 BUCKET_QUOTAS = { product: 6, content: 5, trust: 3 }', () => {
  assert.deepEqual(BUCKET_QUOTAS, { product: 6, content: 5, trust: 3 });
});

test('N12 classifyUrl: every §6.2 example', () => {
  assert.equal(cls('/item-1'), 'other');
  assert.equal(cls('/products/x'), 'product');
  assert.equal(cls('/p/123'), 'product');
  assert.equal(cls('/?id=5'), 'product');
  assert.equal(cls('/zh/產品/z'), 'product');
  assert.equal(cls('/page/2'), 'excluded');
  assert.equal(cls('/?page=2'), 'excluded');
  assert.equal(cls('/blog/a'), 'content');
  assert.equal(cls('/about'), 'trust');
  assert.equal(cls('/'), 'other');
});

test('N12 classifyUrl excluded: segments, pagination (page/N, ?page=, ?p=, ?pg=), sorting/filter queries, Chinese anchors', () => {
  for (const seg of ['cart', 'checkout', 'login', 'signin', 'sign-in', 'register', 'signup', 'sign-up', 'account', 'member', 'members', 'privacy', 'terms', 'policy', 'wp-login.php', 'wp-admin', 'feed', 'search', 'tag', 'tags', 'author']) {
    assert.equal(cls('/' + seg), 'excluded', seg);
    assert.equal(cls('/shop/' + seg + '/x'), 'excluded', 'excluded beats product: ' + seg);
  }
  assert.equal(cls('/page/2'), 'excluded');
  assert.equal(cls('/news/page/3'), 'excluded', 'excluded beats content');
  assert.equal(cls('/page/1'), 'other', 'page/1 is not pagination');
  assert.equal(cls('/page/x'), 'other');
  assert.equal(cls('/page'), 'other');
  assert.equal(cls('/?page=1'), 'other');
  assert.equal(cls('/?p=2'), 'excluded');
  assert.equal(cls('/?pg=10'), 'excluded');
  assert.equal(cls('/products/?page=2'), 'excluded');
  assert.equal(cls('/products/?sort=price'), 'excluded');
  assert.equal(cls('/products/?orderby=date'), 'excluded');
  assert.equal(cls('/products/?order=asc'), 'excluded');
  assert.equal(cls('/products/?filter=red'), 'excluded');
  assert.equal(cls('/products/?x=1&sort=price'), 'excluded', 'second parameter');
  assert.equal(cls('/products/?sorting=1'), 'product', 'sorting= is not sort=');
  for (const a of ['購物車', '登入', '註冊', '會員', '隱私', '條款', '政策', '退換貨', '結帳', '搜尋', '網站地圖']) {
    assert.equal(cls('/x', [a]), 'excluded', a);
    assert.equal(cls('/x', ['前往' + a + '頁面']), 'excluded', 'contains ' + a);
  }
  assert.equal(cls('/products/x', ['購物車']), 'excluded', 'excluded anchor beats product path');
});

test('N12 classifyUrl product: English segments (exact), id-like queries, Chinese segments/anchors (contains)', () => {
  for (const seg of ['product', 'products', 'item', 'items', 'service', 'services', 'shop', 'store', 'course', 'courses', 'solution', 'solutions', 'case', 'cases', 'project', 'projects', 'portfolio', 'menu', 'goods', 'detail', 'p', 'pd', 'prod']) {
    assert.equal(cls('/' + seg), 'product', seg);
    assert.equal(cls('/en/' + seg + '/42'), 'product', 'nested ' + seg);
  }
  assert.equal(cls('/Products/X'), 'product', 'lower-cased');
  for (const q of ['id', 'pid', 'pno', 'prod', 'product', 'sku', 'item', 'goods']) assert.equal(cls('/?' + q + '=5'), 'product', q);
  assert.equal(cls('/?x=1&sku=5'), 'product');
  assert.equal(cls('/?identity=5'), 'other', 'identity= is not id=');
  for (const kw of ['產品', '商品', '服務', '課程', '方案', '作品', '案例', '型錄', '系列', '品項', '菜單']) {
    assert.equal(cls('/zh/' + kw + '/z'), 'product', 'segment ' + kw);
    assert.equal(cls('/zh/' + encodeURIComponent('全部' + kw + '列表') + '/z'), 'product', 'segment containing ' + kw);
    assert.equal(cls('/x', ['查看' + kw]), 'product', 'anchor ' + kw);
  }
  assert.equal(cls('/x', ['  產品　']), 'product', 'anchor normText (NFKC + whitespace trimmed)');
  assert.equal(cls('/blog/products'), 'product', 'product beats content');
  assert.equal(cls('/about/services'), 'product', 'product beats trust');
  assert.equal(cls('/product-list'), 'other', 'segment must equal the keyword');
  assert.equal(cls('/x', ['products']), 'other', 'English keywords apply to segments only');
});

test('N12 classifyUrl content and trust: English segments, Chinese segments/anchors; priority content > trust', () => {
  for (const seg of ['blog', 'blogs', 'news', 'article', 'articles', 'post', 'posts', 'category', 'categories', 'collection', 'collections', 'faq', 'knowledge', 'tips', 'column', 'columns', 'press', 'event', 'events', 'activity', 'activities', 'topic', 'topics']) {
    assert.equal(cls('/' + seg + '/a'), 'content', seg);
  }
  for (const kw of ['最新消息', '部落格', '文章', '專欄', '常見問題', '問答', '分類', '知識', '新聞', '活動', '公告', '消息']) {
    assert.equal(cls('/zh/' + kw), 'content', 'segment ' + kw);
    assert.equal(cls('/x', [kw + '一覽']), 'content', 'anchor ' + kw);
  }
  for (const seg of ['about', 'about-us', 'contact', 'contact-us', 'company', 'team', 'stores', 'locations', 'location', 'branch', 'branches', 'history', 'brand', 'profile', 'intro', 'introduction']) {
    assert.equal(cls('/' + seg), 'trust', seg);
  }
  for (const kw of ['關於', '聯絡', '聯繫', '公司', '團隊', '門市', '據點', '簡介', '品牌', '沿革']) {
    assert.equal(cls('/zh/' + kw), 'trust', 'segment ' + kw);
    assert.equal(cls('/x', [kw + '我們']), 'trust', 'anchor ' + kw);
  }
  assert.equal(cls('/about/news'), 'content', 'content beats trust');
  assert.equal(cls('/company/blog/x'), 'content');
  assert.equal(cls('/ABOUT-US'), 'trust');
  assert.equal(cls('/other1'), 'other');
  assert.equal(cls('/x', ['連結 /x']), 'other');
  assert.equal(cls('/x', []), 'other');
  assert.equal(cls('/x'), 'other', 'anchorTexts defaults to []');
});

test('N12 classifyUrl tolerates undecodable paths and ignores the fragment', () => {
  assert.equal(cls('/%E4%BD%9C%E5%93%81'), 'product', 'decoded 作品');
  assert.equal(cls('/products%ZZ/x'), 'other', 'decodeURIComponent fails -> raw string segments ("products%zz" is not a keyword)');
  assert.equal(cls('/%ZZ/products/x'), 'product', 'raw segments still contain products');
  assert.equal(cls('/about#team'), 'trust');
});

// ------------------------------------------------------------------ orderCandidates
const item = (p, i, anchorTexts = []) => ({ url: u(p), depth: 1, anchorTexts, fromSitemap: false, i });

test('N12 orderCandidates: N12 example order (product 6 / content 5 / trust 3, rest, excluded last)', () => {
  const items = V.N12_LINKS.map((p, i) => item(p, i));
  const before = JSON.stringify(items);
  const out = orderCandidates(items);
  assert.ok(Array.isArray(out));
  assert.notEqual(out, items, 'a new array');
  assert.equal(JSON.stringify(items), before, 'input untouched');
  assert.deepEqual(
    out.map((x) => x.url),
    V.N12_EXPECTED.map(u),
  );
  assert.equal(out.length, items.length);
  // the very same objects are returned (stable, no copies required)
  for (const x of out) assert.ok(items.includes(x));
});

test('N12 orderCandidates: quotas — 8 product links -> the 7th and 8th go after content and trust; overflow keeps discovery order', () => {
  const paths = [...Array.from({ length: 8 }, (_, i) => `/products/${i + 1}`), '/blog/a', '/about', '/other1'];
  const out = orderCandidates(paths.map((p, i) => item(p, i))).map((x) => x.url);
  assert.deepEqual(out, ['/products/1', '/products/2', '/products/3', '/products/4', '/products/5', '/products/6', '/blog/a', '/about', '/products/7', '/products/8', '/other1'].map(u));
  const content = Array.from({ length: 7 }, (_, i) => `/blog/${i + 1}`);
  const trust = Array.from({ length: 5 }, (_, i) => `/about/${i + 1}`);
  const mixed = ['/other0', ...trust, ...content, '/cart'];
  const out2 = orderCandidates(mixed.map((p, i) => item(p, i))).map((x) => x.url);
  assert.deepEqual(out2, [...content.slice(0, 5), ...trust.slice(0, 3), '/other0', ...trust.slice(3), ...content.slice(5), '/cart'].map(u));
});

test('N12 orderCandidates: stable (ties keep discovery order), no de-duplication, anchors feed classification, empty input', () => {
  const dup = [item('/products/a', 0), item('/other', 1), item('/products/a', 2)];
  const out = orderCandidates(dup);
  assert.equal(out.length, 3, 'no de-duplication');
  assert.deepEqual(out.map((x) => x.i), [0, 2, 1]);
  const anchored = [item('/x1', 0, ['關於我們']), item('/x2', 1, ['最新消息']), item('/x3', 2, ['全部商品']), item('/x4', 3, ['登入']), item('/x5', 4, ['看看這個'])];
  assert.deepEqual(
    orderCandidates(anchored).map((x) => x.url),
    ['/x3', '/x2', '/x1', '/x5', '/x4'].map(u),
  );
  assert.deepEqual(orderCandidates([]), []);
});

// ------------------------------------------------------------------ whole-site
test('N12 crawl order after the home page follows orderCandidates; pages[].bucket and limits.buckets', async () => {
  const r = await cached('n12Site', V.n12Site);
  assert.equal(r.snapshot.pages[0].url, 'https://a.com/');
  assert.equal(r.snapshot.pages[0].bucket, 'home');
  assert.deepEqual(
    r.snapshot.pages.slice(1).map((p) => p.url),
    V.N12_EXPECTED.map(u),
  );
  assert.deepEqual(
    r.snapshot.pages.slice(1).map((p) => p.bucket),
    V.N12_BUCKETS,
  );
  assert.deepEqual(r.site.urls('page'), ['https://a.com/', ...V.N12_EXPECTED.map(u)], 'request order');
  assert.deepEqual(r.snapshot.limits.buckets, { product: 4, content: 1, trust: 1, other: 1, excluded: 3 });
  assert.equal(r.snapshot.limits.crawled, 11);
  assert.deepEqual(r.site.violations, []);
});

test('N12 maxPages 4 -> home + the first three product pages', async () => {
  const sc = V.n12Site();
  const r = await runPipeline(sc.site, sc.start, { maxPages: 4 });
  assert.deepEqual(
    r.snapshot.pages.map((p) => p.url),
    ['https://a.com/', ...V.N12_EXPECTED.slice(0, 3).map(u)],
  );
  assert.deepEqual(r.snapshot.limits.buckets, { product: 3, content: 0, trust: 0, other: 0, excluded: 0 });
  assert.equal(r.snapshot.limits.notCrawled, 7);
  assert.ok(r.snapshot.coverage.reasons.includes('page_limit'));
});

test('N12 eight product links -> products 7 and 8 are crawled after the content and trust pages', async () => {
  const r = await cached('n12EightProducts', V.n12EightProducts);
  assert.deepEqual(
    r.snapshot.pages.slice(1).map((p) => p.url),
    ['/products/1', '/products/2', '/products/3', '/products/4', '/products/5', '/products/6', '/blog/a', '/about', '/products/7', '/products/8'].map(u),
  );
  assert.deepEqual(r.snapshot.limits.buckets, { product: 8, content: 1, trust: 1, other: 0, excluded: 0 });
});

test('N12 start URL ≠ home stays at pages[1] with bucket start; the rest is ordered; home/start not counted in buckets', async () => {
  const r = await cached('n12StartNotHome', V.n12StartNotHome);
  assert.equal(r.snapshot.pages[0].url, 'https://a.com/');
  assert.equal(r.snapshot.pages[0].bucket, 'home');
  assert.equal(r.snapshot.pages[1].url, 'https://a.com/blog/post');
  assert.equal(r.snapshot.pages[1].bucket, 'start');
  assert.deepEqual(
    r.snapshot.pages.slice(2).map((p) => p.url),
    V.N12_EXPECTED.map(u),
  );
  assert.deepEqual(r.snapshot.limits.buckets, { product: 4, content: 1, trust: 1, other: 1, excluded: 3 });
});

test('N12 S13 (40 × /item-N, all other) and S18 (start at pages[1]) keep their v1.8 results', async () => {
  const s13 = await cached('s13', S.s13);
  assert.equal(s13.snapshot.pages.length, 15);
  assert.equal(s13.snapshot.pages[1].url, 'https://a.com/item-1');
  assert.equal(s13.snapshot.pages[14].url, 'https://a.com/item-14');
  assert.deepEqual(
    s13.snapshot.pages.slice(1).map((p) => p.url),
    Array.from({ length: 14 }, (_, i) => `https://a.com/item-${i + 1}`),
  );
  assert.ok(s13.snapshot.pages.slice(1).every((p) => p.bucket === 'other'));
  assert.equal(s13.snapshot.pages[0].bucket, 'home');
  assert.deepEqual(s13.snapshot.limits.buckets, { product: 0, content: 0, trust: 0, other: 14, excluded: 0 });
  assert.equal(s13.snapshot.limits.notCrawled, 26);
  const s18 = await cached('s18', S.s18);
  assert.equal(s18.snapshot.pages[0].url, 'https://a.com/');
  assert.equal(s18.snapshot.pages[1].url, 'https://a.com/blog/post');
  assert.equal(s18.snapshot.pages[1].bucket, 'start');
});

test('N12 S01: GOOD_PATHS are classified and ordered (products, services before news/faq/blog before about/contact)', async () => {
  const r = await cached('s01', S.s01);
  const order = r.snapshot.pages.slice(1).map((p) => p.url.replace('https://a.com', ''));
  // discovery order was /about, /services, /products, /news, /contact, /faq, /blog
  assert.deepEqual(order, ['/services', '/products', '/news', '/faq', '/blog', '/about', '/contact']);
  const b = Object.fromEntries(r.snapshot.pages.map((p) => [p.url.replace('https://a.com', ''), p.bucket]));
  assert.equal(b['/'], 'home');
  assert.equal(b['/services'], 'product');
  assert.equal(b['/products'], 'product');
  assert.equal(b['/news'], 'content');
  assert.equal(b['/faq'], 'content');
  assert.equal(b['/blog'], 'content');
  assert.equal(b['/about'], 'trust');
  assert.equal(b['/contact'], 'trust');
  assert.deepEqual(r.snapshot.limits.buckets, { product: 2, content: 3, trust: 2, other: 0, excluded: 0 });
});

test('N12 detail-mode page table has a 類型 column with the bucket labels', async () => {
  const r = await cached('n12StartNotHome', V.n12StartNotHome);
  const { doc, text } = reportOf(r, { detail: true });
  const ths = [...doc.querySelectorAll('th')].map((th) => th.textContent.trim());
  assert.ok(ths.includes('類型'), 'header 類型 in ' + JSON.stringify(ths));
  for (const label of Object.values(BUCKET_LABEL)) assert.ok(text.includes(label), label);
  // the row of /cart shows 低價值, the row of /products/x shows 產品／服務, the start row 起始網址
  // (the URL cell may show the full URL or only its path-and-query)
  const rowOf = (url) => {
    const path = url.replace('https://a.com', '');
    const cell = [...doc.querySelectorAll('td')].find((td) => {
      const t = td.textContent.trim();
      return t === url || t === path || t.startsWith(url + ' ') || t.startsWith(path + ' ');
    });
    assert.ok(cell, 'a table cell for ' + url);
    let tr = cell;
    while (tr && String(tr.tagName || '').toLowerCase() !== 'tr') tr = tr.parentNode;
    assert.ok(tr, 'row for ' + url);
    return tr;
  };
  assert.ok(rowOf('https://a.com/cart').textContent.includes(BUCKET_LABEL.excluded));
  assert.ok(rowOf('https://a.com/products/x').textContent.includes(BUCKET_LABEL.product));
  assert.ok(rowOf('https://a.com/blog/post').textContent.includes(BUCKET_LABEL.start));
  assert.ok(rowOf('https://a.com/blog/a').textContent.includes(BUCKET_LABEL.content));
  assert.ok(rowOf('https://a.com/about').textContent.includes(BUCKET_LABEL.trust));
  assert.ok(rowOf('https://a.com/other1').textContent.includes(BUCKET_LABEL.other));
  const simple = reportOf(r, { detail: false });
  assert.ok(!simple.text.includes(BUCKET_LABEL.excluded), 'the page table is a detail-mode element');
});
