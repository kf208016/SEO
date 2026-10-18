// Scenario site builders for SPEC-002 (v1.9) cases N01–N15. Same conventions as scenarios.mjs.
import { createFakeSite, goodSiteRoutes, page, ORG_JSONLD } from './fakesite.mjs';
import { START } from './scenarios.mjs';

export { START };
const ORIGIN = 'https://a.com';
const ALLOW_ROBOTS = 'User-agent: *\nDisallow:\n';

// ---------------------------------------------------------------- raw document builder
// Elements are concatenated without whitespace so visible-text lengths are exact.
export function rawDoc({ title = '範例頁面', url = null, lang = 'zh-Hant-TW', head = '', body = '' } = {}) {
  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>` +
    `<meta name="description" content="${title} 的頁面說明，介紹本頁內容。"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    (url ? `<link rel="canonical" href="${url}">` : '') +
    `<meta property="og:title" content="${title}"><meta property="og:image" content="https://a.com/og.png">${head}</head><body>${body}</body></html>`
  );
}

// ---------------------------------------------------------------- N01 Content-Signal
export const CS_LINE = 'Content-Signal: search=yes, ai-train=no';
export const CS_ROBOTS = `User-agent: *\n${CS_LINE}\nDisallow:\n\nSitemap: https://a.com/sitemap.xml\n`;

export function contentSignalSite() {
  return { site: createFakeSite({ routes: goodSiteRoutes({ robots: CS_ROBOTS }) }), start: START };
}
export function contentSignalTwoLines() {
  const robots = `User-agent: GPTBot\nUser-agent: ClaudeBot\nContent-Signal: ai-train=no\nDisallow: /\n\nUser-agent: *\n${CS_LINE}\nDisallow:\n\nSitemap: https://a.com/sitemap.xml\n`;
  return { site: createFakeSite({ routes: goodSiteRoutes({ robots }) }), start: START };
}
// home 503 (not analyzable) but robots.txt carries a Content-Signal line
export function contentSignalHome503() {
  const routes = goodSiteRoutes({ robots: CS_ROBOTS });
  routes[ORIGIN + '/'] = { status: 503, html: '<html><body>Service Unavailable</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}

// ---------------------------------------------------------------- N10 robots 429
export function robots429() {
  const routes = goodSiteRoutes();
  routes[ORIGIN + '/robots.txt'] = { status: 429, text: 'Too Many Requests' };
  return { site: createFakeSite({ routes }), start: START };
}

// ---------------------------------------------------------------- N03 / N04 main-area page
export const N03_H1 = '產品總覽';
export const N03_H2 = '第二層標題';
export const N03_H3 = '第三層標題';
export const N03_MAIN_TEXT = '字'.repeat(40);
export const N03_ALTS = ['產品一', '產品二', '產品三', '產品四'];
const HEADER_FILLER = '頭'.repeat(500 - N03_H1.length - N03_H2.length - N03_H3.length);
export const N03_HEADER_TEXT = N03_H1 + N03_H2 + N03_H3 + HEADER_FILLER; // 500 chars

// Body with <header>(500 chars, h1/h2/h3, one img) + main area (text + 5 imgs, one 16x16 icon) + aside + footer.
export function n03Body({ main = true, mainText = N03_MAIN_TEXT, video = false, iframe = false, iconAlt = null, extraMain = '', h1 = N03_H1 } = {}) {
  const open = main ? '<main>' : '<div class="content">';
  const close = main ? '</main>' : '</div>';
  const imgs = N03_ALTS.map((alt, i) => `<img src="/img/p${i + 1}.png" alt="${alt}">`).join('');
  const icon = iconAlt === null ? '<img src="/img/icon.png" width="16" height="16">' : `<img src="/img/icon.png" width="16" height="16" alt="${iconAlt}">`;
  return (
    `<header><h1>${h1}</h1><h2>${N03_H2}</h2><h3>${N03_H3}</h3><p>${HEADER_FILLER}</p><img src="/img/logo.png" alt="標誌"></header>` +
    '<nav><a href="/">首頁連結</a><img src="/img/nav.png" alt="導覽圖"></nav>' +
    `${open}<p>${mainText}</p>${imgs}${icon}${video ? '<video src="/v.mp4"></video>' : ''}${iframe ? '<iframe src="https://www.youtube.com/embed/x"></iframe>' : ''}${extraMain}${close}` +
    '<aside><p>側欄文字</p><img src="/img/aside.png" alt="側欄圖"></aside>' +
    '<footer><p>頁尾文字</p><img src="/img/footer.png" alt="頁尾圖"></footer>'
  );
}

export function n03Html(opts = {}) {
  const { title = '範例產品頁', url = 'https://a.com/landing', ...rest } = opts;
  return rawDoc({ title, url, body: n03Body(rest) });
}

// C14 site: healthy home linking to one inner page built from n03Html.
export function imageOnlySite({ path = '/landing', title = '範例產品頁', h1 = N03_H1, iframe = false, mainText = N03_MAIN_TEXT } = {}) {
  const url = new URL(path, ORIGIN).href;
  const routes = goodSiteRoutes({ paths: ['/'], robots: ALLOW_ROBOTS, sitemap: false, overrides: { '/': { page: { links: [path] } } } });
  routes[url] = { html: n03Html({ title, url, h1, iframe, mainText }) };
  return { site: createFakeSite({ routes }), start: START, url };
}

// G06 shell page that would also satisfy the raw C14 numbers (3 imgs, no text)
export function jsShellWithImages() {
  const url = ORIGIN + '/app';
  const routes = goodSiteRoutes({ paths: ['/'], robots: ALLOW_ROBOTS, sitemap: false, overrides: { '/': { page: { links: ['/app'] } } } });
  routes[url] = {
    html: rawDoc({
      title: '應用程式頁',
      url,
      body: '<div id="root"></div><main><img src="/img/a.png"><img src="/img/b.png"><img src="/img/c.png"></main><script src="/static/app.js"></script>',
    }),
  };
  return { site: createFakeSite({ routes }), start: START, url };
}

// ---------------------------------------------------------------- N05 text preview
export function headingRichHome(count = 35) {
  const body = Array.from({ length: count }, (_, i) => `<h2>標題 ${i + 1}</h2>`).join('');
  return { site: createFakeSite({ routes: goodSiteRoutes({ overrides: { '/': { page: { body } } } }) }), start: START };
}
export function noTextHome() {
  const routes = goodSiteRoutes({ paths: ['/'], robots: ALLOW_ROBOTS, sitemap: false });
  routes[ORIGIN + '/'] = { html: rawDoc({ title: '圖片首頁', url: ORIGIN + '/', body: '<img src="/img/hero.png" alt="主視覺"><img src="/img/logo.png" alt="標誌">' }) };
  return { site: createFakeSite({ routes }), start: START };
}
export function noHeadingHome() {
  const routes = goodSiteRoutes({ paths: ['/'], robots: ALLOW_ROBOTS, sitemap: false });
  routes[ORIGIN + '/'] = { html: rawDoc({ title: '沒有標題的首頁', url: ORIGIN + '/', body: '<p>這一頁有文字，但原始 HTML 裡沒有任何 H1 到 H3 標題。</p>' }) };
  return { site: createFakeSite({ routes }), start: START };
}

// ---------------------------------------------------------------- N12 buckets
export const N12_LINKS = ['/privacy', '/cart', '/blog/a', '/about', '/products/x', '/products/y', '/?id=5', '/zh/產品/z', '/other1', '/page/2'];
export const N12_EXPECTED = ['/products/x', '/products/y', '/?id=5', '/zh/產品/z', '/blog/a', '/about', '/other1', '/privacy', '/cart', '/page/2'];
export const N12_BUCKETS = ['product', 'product', 'product', 'product', 'content', 'trust', 'other', 'excluded', 'excluded', 'excluded'];
export const abs = (p) => new URL(p, ORIGIN).href;

// Home links to `links` (document order); every linked page exists (200) with a unique title; no sitemap.
export function bucketSite(links, { start = START, extraPaths = [] } = {}) {
  const routes = { [ORIGIN + '/robots.txt']: { text: ALLOW_ROBOTS } };
  routes[ORIGIN + '/'] = { html: page({ title: '金水範例公司｜首頁', description: '金水範例公司首頁說明。', canonical: ORIGIN + '/', links, jsonld: [ORG_JSONLD], h1: '首頁' }) };
  for (const p of [...links, ...extraPaths]) {
    const url = abs(p);
    routes[url] = { html: page({ title: `金水範例公司｜${p}`, description: `${p} 的說明。`, canonical: url, links: ['/'], h1: `頁面 ${p}` }) };
  }
  return { site: createFakeSite({ routes }), start };
}
export const n12Site = () => bucketSite(N12_LINKS);
export const n12EightProducts = () => bucketSite([...Array.from({ length: 8 }, (_, i) => `/products/${i + 1}`), '/blog/a', '/about']);
export const n12StartNotHome = () => bucketSite(N12_LINKS, { start: ORIGIN + '/blog/post?utm=x', extraPaths: ['/blog/post'] });

// ---------------------------------------------------------------- N13 hreflang
const alt = (lang, href) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;

// home + /en/ with reciprocal hreflang (zh-TW and `second`), home also has an English link
export function hreflangSite({ second = 'en', secondHref = 'https://a.com/en/', homeLinks = ['/about', '/en/'], homeHead = null } = {}) {
  const head = homeHead ?? alt('zh-TW', 'https://a.com/') + alt(second, secondHref);
  const routes = goodSiteRoutes({ paths: ['/', '/about'], robots: ALLOW_ROBOTS, sitemap: false, overrides: { '/': { page: { links: homeLinks, head } } } });
  routes[ORIGIN + '/en/'] = { html: page({ title: 'Kinsui Example Co.｜Home', description: 'English home page.', canonical: ORIGIN + '/en/', lang: 'en', links: ['/'], head: alt('zh-TW', 'https://a.com/') + alt('en', 'https://a.com/en/'), h1: 'Home' }) };
  return { site: createFakeSite({ routes }), start: START };
}
export const hreflangOk = () => hreflangSite();
export const hreflangCode = (code) => () => hreflangSite({ second: code });
export const hreflangBadHref = () => hreflangSite({ second: 'en', secondHref: 'javascript:x' });
// en points at /gone, which the home links to and which answers 404
export const hreflang404 = () => hreflangSite({ second: 'en', secondHref: 'https://a.com/gone', homeLinks: ['/about', '/en/', '/gone'] });
// every href valid but none is the home page itself
export const hreflangNoSelf = () => hreflangSite({ homeHead: alt('zh-TW', 'https://a.com/about') + alt('en', 'https://a.com/en/'), homeLinks: ['/about', '/en/'] });
// hreflang lists the page's canonical rather than its URL -> still "self"
export function hreflangSelfByCanonical() {
  const routes = goodSiteRoutes({ paths: ['/', '/about'], robots: ALLOW_ROBOTS, sitemap: false, overrides: { '/': { page: { links: ['/about', '/p2'] } } } });
  routes[ORIGIN + '/p2'] = { html: page({ title: '金水範例公司｜第二頁', canonical: ORIGIN + '/p-canon', links: ['/'], head: alt('zh-TW', 'https://a.com/p-canon') + alt('en', 'https://a.com/en/p2') }) };
  routes[ORIGIN + '/p-canon'] = { html: page({ title: '金水範例公司｜正規頁', canonical: ORIGIN + '/p-canon', links: ['/'] }) };
  routes[ORIGIN + '/en/p2'] = { html: page({ title: 'Kinsui｜Page two', canonical: ORIGIN + '/en/p2', lang: 'en', links: ['/'] }) };
  return { site: createFakeSite({ routes }), start: START };
}
// no hreflang anywhere; home has a language-switch link
export function hreflangMissing({ href = '/en/', text = 'English' } = {}) {
  const routes = goodSiteRoutes({ paths: ['/', '/about'], robots: ALLOW_ROBOTS, sitemap: false, overrides: { '/': { page: { links: ['/about', { href, text }] } } } });
  const url = abs(href);
  routes[url] = { html: page({ title: `Kinsui Example Co.｜${text}`, description: 'Localized page.', canonical: url, lang: 'en', links: ['/'], h1: 'Localized' }) };
  return { site: createFakeSite({ routes }), start: START };
}
export const hreflangMissingByPath = () => hreflangMissing({ href: '/ja/', text: '日本語版サイト' });
export const hreflangMissingNegative = () => hreflangMissing({ href: '/global/', text: 'English Version Page' });
