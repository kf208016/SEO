// Scenario site builders for S01–S23 (SPEC-001 §12.4) and a few extra checks.
import { createFakeSite, goodSiteRoutes, page, sitemapXml, GOOD_PATHS, ORG_JSONLD } from './fakesite.mjs';

const ALLOW_ROBOTS = 'User-agent: *\nDisallow:\n';
const ALLOW_WITH_SITEMAP = 'User-agent: *\nDisallow:\n\nSitemap: https://a.com/sitemap.xml\n';

export const START = 'https://a.com/';

export function s01() {
  return { site: createFakeSite({ routes: goodSiteRoutes() }), start: START };
}

export function s02() {
  const routes = goodSiteRoutes({ robots: 'User-agent: *\nDisallow: /\n' });
  return { site: createFakeSite({ routes }), start: START };
}

export function s03() {
  const routes = goodSiteRoutes({ overrides: { '/': { page: { robotsMeta: 'noindex' } } } });
  return { site: createFakeSite({ routes }), start: START };
}

export const S04_ROBOTS = [
  'User-agent: GPTBot',
  'Disallow: /',
  '',
  'User-agent: ClaudeBot',
  'Disallow: /',
  '',
  'User-agent: OAI-SearchBot',
  'Disallow: /',
  '',
  'User-agent: PerplexityBot',
  'Disallow: /',
  '',
  'User-agent: *',
  'Disallow:',
  '',
  'Sitemap: https://a.com/sitemap.xml',
  '',
].join('\n');

export function s04() {
  return { site: createFakeSite({ routes: goodSiteRoutes({ robots: S04_ROBOTS }) }), start: START };
}

export function s05() {
  const routes = goodSiteRoutes({
    paths: ['/'],
    overrides: {
      '/': {
        page: {
          text: '',
          h1: null,
          images: [],
          links: [],
          body: '<div id="root"></div><script src="/static/app.js"></script>',
        },
      },
    },
  });
  return { site: createFakeSite({ routes }), start: START };
}

export const S06_PATHS = ['/', '/p1', '/p2', '/p3', '/p4', '/p5', '/p6', '/p7', '/p8', '/p9', '/p10', '/p11', '/p12'];
export function s06() {
  const routes = goodSiteRoutes({
    paths: S06_PATHS,
    overrides: {
      '/': { page: { canonical: 'https://other-domain.com/' } }, // T16 (home, P1)
      '/p1': { page: { title: null } }, // C01
      '/p2': { page: { title: '重複的頁面標題' } }, // C02
      '/p3': { page: { title: '重複的頁面標題' } }, // C02
      '/p4': { page: { jsonld: ['{ "@context": "https://schema.org", "@type": "Thing", '] } }, // C11
      '/p5': { page: { jsonld: [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] }] } }, // C12
      '/p6': { page: { canonicals: ['https://a.com/p6', 'https://a.com/p6-other'] } }, // T15
      '/p7': { page: { images: [{ src: '/img/no-alt.png' }] } }, // C09
      '/p8': { page: { robotsMeta: 'nosnippet' } }, // G05
      '/p9': { page: { head: '<script src="http://cdn.example.org/lib.js"></script>' } }, // T34
      '/p10': { page: { extraTitles: ['第二個標題'] } }, // T36
      '/p11': { page: { head: '<meta http-equiv="refresh" content="5; url=/p1">' } }, // T33
      '/p12': { page: { canonicals: ['javascript:void(0)'] } }, // T38
    },
  });
  return { site: createFakeSite({ routes }), start: START };
}

export function s07() {
  const routes = goodSiteRoutes();
  routes['https://a.com/robots.txt'] = { status: 503, text: 'Service Unavailable' };
  return { site: createFakeSite({ routes }), start: START };
}

export function s08() {
  const routes = goodSiteRoutes();
  routes['http://a.com/robots.txt'] = { text: ALLOW_ROBOTS };
  routes['http://a.com/'] = { html: page({ title: 'HTTP 版首頁', canonical: 'https://a.com/' }) };
  const fallback = (url) =>
    new URL(url).pathname.startsWith('/seo-check-404-') ? { html: page({ title: '首頁內容（任何網址都回應）' }) } : undefined;
  return { site: createFakeSite({ routes, fallback }), start: START };
}

export function s09() {
  const routes = goodSiteRoutes();
  routes['https://a.com/'] = { status: 301, location: 'https://b-other.com/' };
  routes['https://b-other.com/robots.txt'] = { text: ALLOW_ROBOTS };
  routes['https://b-other.com/'] = { html: page({ title: 'B' }) };
  return { site: createFakeSite({ routes }), start: START };
}

export const S10_BROKEN = ['/broken-1', '/broken-2', '/broken-3', '/broken-4', '/broken-5', '/broken-6'];
export function s10() {
  const ok = ['/ok-1', '/ok-2', '/ok-3', '/ok-4'];
  const routes = goodSiteRoutes({
    paths: ['/', ...ok],
    overrides: { '/': { page: { links: [...ok.slice(0, 2), ...S10_BROKEN, ...ok.slice(2)] } } },
  });
  return { site: createFakeSite({ routes }), start: START };
}

export function s11() {
  const robots = 'User-agent: Bingbot\nDisallow: /\n\nUser-agent: *\nDisallow:\n\nSitemap: https://a.com/sitemap.xml\n';
  return { site: createFakeSite({ routes: goodSiteRoutes({ robots }) }), start: START };
}

export const XSS_TITLE_TEXT = '<img src=x onerror=alert(1)>';
export function s12() {
  // href attribute value decodes to: /x"><script>alert(1)</script>
  const evilPath = '/x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;';
  const routes = goodSiteRoutes({
    paths: ['/', '/a', '/b'],
    robots: '# <script>alert("robots")</script>\nUser-agent: *\nDisallow:\n\nSitemap: https://a.com/sitemap.xml\n',
    sitemap: false,
    overrides: {
      '/': { page: { links: ['/a', '/b', evilPath] } },
      // title text is the literal string <img src=x onerror=alert(1)> (entities in source)
      '/a': { page: { title: '&lt;img src=x onerror=alert(1)&gt;', canonical: 'javascript:alert(1)', description: '&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;' } },
      '/b': { page: { title: '&lt;img src=x onerror=alert(1)&gt;', description: '&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;' } },
    },
  });
  routes['https://a.com/sitemap.xml'] = {
    xml:
      '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      '<url><loc>https://a.com/</loc></url>' +
      '<url><loc>https://evil.example.net/"&gt;&lt;script&gt;alert(3)&lt;/script&gt;</loc></url>' +
      '<url><loc>javascript:alert(4)</loc></url>' +
      '</urlset>',
  };
  return { site: createFakeSite({ routes }), start: START };
}

export function s13() {
  const links = Array.from({ length: 40 }, (_, i) => `/item-${i + 1}`);
  const routes = goodSiteRoutes({
    paths: ['/', ...links],
    robots: ALLOW_WITH_SITEMAP,
    sitemap: false,
    overrides: { '/': { page: { links } } },
  });
  routes['https://a.com/sitemap.xml'] = { xml: sitemapXml(['https://a.com/', 'https://a.com/item-1', 'https://a.com/item-2']) };
  return { site: createFakeSite({ routes }), start: START };
}

export function s14() {
  const routes = goodSiteRoutes();
  routes['https://a.com/robots.txt'] = { status: 403, html: '<html><body>Just a moment...</body></html>', headers: { 'cf-mitigated': 'challenge' } };
  return { site: createFakeSite({ routes }), start: START };
}

export function s15() {
  const routes = {
    'https://www.a.com/robots.txt': { text: ALLOW_ROBOTS },
    'https://www.a.com/': { status: 301, location: 'https://a.com/' },
    'https://a.com/robots.txt': { text: ALLOW_ROBOTS },
    'https://a.com/': { html: page({ title: '金水範例公司｜首頁內容', canonical: 'https://a.com/', links: [] }) },
    'https://a.com/sitemap.xml': { xml: sitemapXml(['https://a.com/']) },
    // 404 (not a redirect to https) so the http robots result is not re-applied to the https origin
    'http://a.com/robots.txt': { status: 404, html: '<html><body>nf</body></html>' },
  };
  return { site: createFakeSite({ routes }), start: 'https://www.a.com/' };
}

export function s16() {
  const routes = goodSiteRoutes({ robots: ALLOW_ROBOTS, sitemap: false });
  routes['https://a.com/sitemap.xml'] = { html: page({ title: '這是一般網頁，不是 sitemap' }) };
  return { site: createFakeSite({ routes }), start: START };
}

export function s17() {
  const routes = goodSiteRoutes({ robots: 'User-agent: KinsuiSEOCheck\nDisallow: /\n' });
  return { site: createFakeSite({ routes }), start: START };
}

export function s18() {
  const routes = goodSiteRoutes();
  routes['https://a.com/blog/post'] = { html: page({ title: '金水範例公司｜部落格文章', canonical: 'https://a.com/blog/post', links: ['/'] }) };
  return { site: createFakeSite({ routes }), start: 'https://a.com/blog/post?utm=x' };
}

export function s19() {
  const robots = 'User-agent: KinsuiSEOCheck\nDisallow: /private\n\nUser-agent: *\nDisallow:\n';
  const routes = goodSiteRoutes({ robots, sitemap: false, overrides: { '/': { page: { links: ['/about', '/old'] } } } });
  routes['https://a.com/old'] = { status: 301, location: '/private' };
  routes['https://a.com/private'] = { html: page({ title: '私人頁面' }) };
  return { site: createFakeSite({ routes }), start: START };
}

export function s20() {
  const routes = goodSiteRoutes();
  routes['https://a.com/'] = { status: 503, html: '<html><body>Service Unavailable</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}

export const S21_BLOCKED = ['/b1', '/b2', '/b3'];
export function s21() {
  const paths = ['/', '/about', '/services', '/products', ...S21_BLOCKED];
  const routes = goodSiteRoutes({ paths });
  for (const p of S21_BLOCKED) routes['https://a.com' + p] = { status: 403, html: '<html><body>Forbidden</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}

export function s22() {
  const routes = goodSiteRoutes({ robots: ALLOW_ROBOTS, sitemap: false });
  routes['https://a.com/sitemap.xml'] = { status: 503, text: 'busy' };
  return { site: createFakeSite({ routes }), start: START };
}

export function s23() {
  const robots = 'User-agent: KinsuiSEOCheck\nDisallow: /secret\n\nUser-agent: *\nDisallow:\n';
  const routes = goodSiteRoutes({ robots, sitemap: false, overrides: { '/': { page: { links: ['/about', '/secret', 'http://a.com/secret'] } } } });
  routes['http://a.com/robots.txt'] = { status: 404, html: '<html><body>nf</body></html>' };
  routes['http://a.com/secret'] = { status: 301, location: 'https://a.com/secret' };
  routes['https://a.com/secret'] = { html: page({ title: '機密頁面' }) };
  return { site: createFakeSite({ routes }), start: START };
}

// ---------------------------------------------------------------- extras

export function r29Frontend() {
  const robots = ['User-agent: KinsuiSEOCheck', ...Array.from({ length: 1001 }, (_, i) => `Disallow: /r${i}`), '', 'User-agent: *', 'Disallow:'].join('\n');
  return { site: createFakeSite({ routes: goodSiteRoutes({ robots }) }), start: START };
}

export function robots404() {
  const routes = goodSiteRoutes({ sitemap: true });
  routes['https://a.com/robots.txt'] = { status: 404, html: '<html><body>Not Found</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}

export function home404() {
  const routes = goodSiteRoutes();
  routes['https://a.com/'] = { status: 404, html: '<html><body>Not Found</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}

export function foreignSitemap() {
  const foreign = Array.from({ length: 60 }, (_, i) => `https://foreign-host.example.net/p${i}`);
  const routes = goodSiteRoutes();
  routes['https://a.com/sitemap.xml'] = { xml: sitemapXml([...GOOD_PATHS.map((p) => 'https://a.com' + p), ...foreign]) };
  return { site: createFakeSite({ routes }), start: START, foreign };
}

export function userFetchBlocked() {
  const robots = 'User-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: *\nDisallow:\n\nSitemap: https://a.com/sitemap.xml\n';
  return { site: createFakeSite({ routes: goodSiteRoutes({ robots }) }), start: START };
}

export function noOrgSchema() {
  return { site: createFakeSite({ routes: goodSiteRoutes({ overrides: { '/': { page: { jsonld: [] } } } }) }), start: START };
}

// ---------------------------------------------------------------- v1.5 (DEBATE-001 「驗收第一輪」 A1–A10)

// A4: the same path linked with lower- and upper-case percent-encoding is one URL
export const PCT_UPPER = 'https://a.com/%E6%9C%8D';
export const PCT_LOWER = 'https://a.com/%e6%9c%8d';
export function percentCase() {
  const routes = goodSiteRoutes({
    overrides: { '/': { page: { links: [...GOOD_PATHS.filter((p) => p !== '/'), '/%e6%9c%8d', '/%E6%9C%8D'] } } },
  });
  const svc = { html: page({ title: '金水範例公司｜服務據點', canonical: PCT_UPPER, links: ['/'] }) };
  routes[PCT_UPPER] = svc;
  routes[PCT_LOWER] = svc;
  return { site: createFakeSite({ routes }), start: START };
}

// A5: home https://a.com/ 301 -> https://www.a.com/, whose canonical is itself; that URL is also in the sitemap
export function wwwHomeCanonical() {
  const routes = {
    'https://a.com/robots.txt': { text: ALLOW_ROBOTS },
    'https://a.com/': { status: 301, location: 'https://www.a.com/' },
    'https://www.a.com/robots.txt': { text: 'User-agent: *\nDisallow:\n\nSitemap: https://www.a.com/sitemap.xml\n' },
    'https://www.a.com/': { html: page({ title: '金水範例公司｜首頁內容', canonical: 'https://www.a.com/', links: ['/about'], jsonld: [ORG_JSONLD] }) },
    'https://www.a.com/about': { html: page({ title: '金水範例公司｜關於我們', canonical: 'https://www.a.com/about', links: ['/'] }) },
    'https://www.a.com/sitemap.xml': { xml: sitemapXml(['https://www.a.com/', 'https://www.a.com/about']) },
  };
  return { site: createFakeSite({ routes }), start: START };
}

// A5: canonicals / sitemap entries pointing at a requested-and-redirected URL, a 404 and a noindex page
export function canonicalTargets() {
  const routes = goodSiteRoutes({
    paths: ['/', '/p', '/q', '/r', '/s', '/new', '/noidx'],
    robots: ALLOW_WITH_SITEMAP,
    sitemap: false,
    overrides: {
      // /new is NOT linked: it is only reached as the final URL of /old
      '/': { page: { links: ['/p', '/q', '/r', '/s', '/old', '/gone', '/noidx'] } },
      '/p': { page: { canonical: 'https://a.com/old' } }, // /old was requested and redirected -> T17
      '/q': { page: { canonical: 'https://a.com/new' } }, // final URL of /old -> no T17
      '/r': { page: { canonical: 'https://a.com/gone' } }, // 404 -> T17
      '/s': { page: { canonical: 'https://a.com/noidx' } }, // noindex -> T17
      '/noidx': { page: { robotsMeta: 'noindex' } },
    },
  });
  routes['https://a.com/old'] = { status: 301, location: '/new' };
  // /gone is not routed -> 404
  routes['https://a.com/sitemap.xml'] = { xml: sitemapXml(['https://a.com/', 'https://a.com/old', 'https://a.com/gone', 'https://a.com/noidx', 'https://a.com/p']) };
  return { site: createFakeSite({ routes }), start: START };
}

// A6: an internal link that redirects to the home page (duplicate final URL)
export function duplicateRedirect() {
  const routes = goodSiteRoutes({ overrides: { '/': { page: { links: [...GOOD_PATHS.filter((p) => p !== '/'), '/dup'] } } } });
  routes['https://a.com/dup'] = { status: 301, location: '/' };
  return { site: createFakeSite({ routes }), start: START };
}

// A9: no declared sitemap and /sitemap.xml 404 (or 410) -> kind missing
export function fallbackSitemapGone(status = 404) {
  const routes = goodSiteRoutes({ robots: ALLOW_ROBOTS, sitemap: false });
  routes['https://a.com/sitemap.xml'] = { status, html: '<html><body>Not Found</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}
export const fallbackSitemap410 = () => fallbackSitemapGone(410);

// B2 (v1.6): a sitemap DECLARED in robots.txt returning 404/410 -> kind missing -> T19
export function declaredSitemapGone(status = 404, path = '/sm.xml') {
  const url = 'https://a.com' + path;
  const routes = goodSiteRoutes({ robots: `User-agent: *\nDisallow:\n\nSitemap: ${url}\n`, sitemap: false });
  routes[url] = { status, html: '<html><body>Not Found</body></html>' };
  return { site: createFakeSite({ routes }), start: START, sitemapUrl: url };
}
export const declaredSitemap404 = () => declaredSitemapGone(404, '/sm.xml');
export const declaredSitemapXml404 = () => declaredSitemapGone(404, '/sitemap.xml');
export const declaredSitemapXml410 = () => declaredSitemapGone(410, '/sitemap.xml');

// B1 (v1.6): the same small site with inline styles everywhere / without any
function stylePage(url, name, links, styled) {
  const a = (css) => (styled ? ` style="${css}"` : '');
  const blk = (css) => (styled ? `<style>${css}</style>` : '');
  return [
    `<!doctype html><html lang="zh-Hant-TW"${a('background:#fff')}><head><meta charset="utf-8">`,
    `<title>金水範例公司｜${name}</title>`,
    blk('body { margin: 0 }'),
    `<meta name="description" content="金水範例公司的${name}頁面說明。">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:title" content="${name}"><meta property="og:image" content="https://a.com/og.png">`,
    styled ? '<STYLE media="screen">\n.a { color: red; }\n.b > p { margin: 0 }\n</STYLE>' : '',
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"金水範例公司"}</script>',
    `</head><body${styled ? " STYLE='color:#333'" : ''}>`,
    `<h1${a('font-size: 2em')} class="title">${name}</h1>`,
    `<p${styled ? ' style=margin:0' : ''} id="intro" data-x="1">這是一段用來測試網站健檢工具的正文內容，說明公司的產品、服務與聯絡方式，讓讀者可以清楚了解。這是一段用來測試網站健檢工具的正文內容，說明公司的產品與服務。use style=x here</p>`,
    ...links.map((l) => `<a href="${l}"${a('color: blue')} data-track="nav">連結 ${l}</a>`),
    `<img src="/img/a.png" alt="示意圖"${a('width:10px')}>`,
    blk('.c { display: none }'),
    '</body></html>',
  ].join('\n');
}
export function styledSite(styled) {
  const paths = ['/', '/about', '/contact'];
  const names = { '/': '首頁內容', '/about': '關於我們', '/contact': '聯絡我們' };
  const routes = {
    'https://a.com/robots.txt': { text: ALLOW_WITH_SITEMAP },
    'https://a.com/sitemap.xml': { xml: sitemapXml(paths.map((p) => 'https://a.com' + p)) },
  };
  for (const p of paths) {
    const url = 'https://a.com' + p;
    routes[url] = { html: stylePage(url, names[p], p === '/' ? ['/about', '/contact'] : ['/'], styled) };
  }
  return { site: createFakeSite({ routes }), start: START };
}

// A10: home 200 but not HTML
export function homeNotHtml() {
  const routes = goodSiteRoutes();
  routes['https://a.com/'] = { status: 200, text: 'plain text home' };
  return { site: createFakeSite({ routes }), start: START };
}

// ---------------------------------------------------------------- mutation gaps (CK01–CK07, CR01)

// CK01: home 500 with cf-mitigated: challenge
export function homeChallenge500() {
  const routes = goodSiteRoutes();
  routes['https://a.com/'] = { status: 500, html: '<html><body>challenge</body></html>', headers: { 'cf-mitigated': 'challenge' } };
  return { site: createFakeSite({ routes }), start: START };
}

// CK02: robots 503 with cf-mitigated: challenge
export function robotsChallenge503() {
  const routes = goodSiteRoutes();
  routes['https://a.com/robots.txt'] = { status: 503, html: '<html><body>challenge</body></html>', headers: { 'cf-mitigated': 'challenge' } };
  return { site: createFakeSite({ routes }), start: START };
}

// CK03: linked page 502 with cf-mitigated: challenge, plus one real 404
export function pageChallenge502() {
  const routes = goodSiteRoutes({
    overrides: { '/': { page: { links: [...GOOD_PATHS.filter((p) => p !== '/'), '/bad', '/gone'] } } },
  });
  routes['https://a.com/bad'] = { status: 502, html: '<html><body>challenge</body></html>', headers: { 'cf-mitigated': 'challenge' } };
  return { site: createFakeSite({ routes }), start: START };
}

// CK04: 10 linked internal pages, 2 return 404
export const CK04_BROKEN = ['/broken-a', '/broken-b'];
export function tenLinksTwoBroken() {
  const ok = Array.from({ length: 8 }, (_, i) => '/ok-' + (i + 1));
  const routes = goodSiteRoutes({
    paths: ['/', ...ok],
    overrides: { '/': { page: { links: [...ok.slice(0, 4), ...CK04_BROKEN, ...ok.slice(4)] } } },
  });
  return { site: createFakeSite({ routes }), start: START };
}

// CK07: SPA root with n characters of visible text, page total < 200 chars, external script
export function spaRootText(n) {
  const routes = goodSiteRoutes({
    paths: ['/'],
    overrides: {
      '/': {
        page: { text: '', h1: null, images: [], links: [], body: '<div id="root"><p>' + 'a'.repeat(n) + '</p></div><script src="/static/app.js"></script>' },
      },
    },
  });
  return { site: createFakeSite({ routes }), start: START };
}

// CR01: the Worker says ourPolicy unknown for an origin although its robots.txt text would allow everything
export function workerUnknownStart() {
  const routes = goodSiteRoutes({ robots: ALLOW_WITH_SITEMAP });
  return {
    site: createFakeSite({ routes, forceOurPolicy: (origin) => (origin === 'https://a.com' ? 'unknown' : undefined) }),
    start: START,
  };
}
export function workerUnknownHttp() {
  const routes = goodSiteRoutes();
  routes['http://a.com/robots.txt'] = { text: ALLOW_ROBOTS };
  routes['http://a.com/'] = { html: page({ title: 'HTTP 版首頁' }) };
  return {
    site: createFakeSite({ routes, forceOurPolicy: (origin) => (origin === 'http://a.com' ? 'unknown' : undefined) }),
    start: START,
  };
}
export function workerUnknownOverflow() {
  // a 2,001-char rule in another group -> parse overflow -> Worker unknown, although our group allows all
  const robots = 'User-agent: Other\nDisallow: /' + 'x'.repeat(2000) + '\n\nUser-agent: *\nDisallow:\n';
  return { site: createFakeSite({ routes: goodSiteRoutes({ robots }) }), start: START };
}

// COV04/COV05 (§5.7 step 4): start https://www.a.com/, www robots allows, www home 301 -> https://a.com/,
// a.com robots.txt is a 403 challenge (Worker ourPolicy unknown)
// final origin https://a.com reached via www home 301; its robots.txt answer is `aRobots`
function finalOriginRobots(aRobots) {
  const routes = {
    'https://www.a.com/robots.txt': { text: ALLOW_ROBOTS },
    'https://www.a.com/': { status: 301, location: 'https://a.com/' },
    'https://a.com/robots.txt': aRobots,
    'https://a.com/': { html: page({ title: '金水範例公司｜首頁內容', canonical: 'https://a.com/', links: ['/about'] }) },
    'https://a.com/about': { html: page({ title: '金水範例公司｜關於我們', canonical: 'https://a.com/about', links: ['/'] }) },
    'https://a.com/sitemap.xml': { xml: sitemapXml(['https://a.com/', 'https://a.com/about']) },
  };
  return { site: createFakeSite({ routes }), start: 'https://www.a.com/' };
}
// a.com robots is a 403 challenge (accessBlocked) -> v1.7 blocked_by_site
export const finalOriginRobotsUnknown = () =>
  finalOriginRobots({ status: 403, html: '<html><body>Just a moment...</body></html>', headers: { 'cf-mitigated': 'challenge' } });
// a.com robots is a plain 403 (accessBlocked) -> v1.7 blocked_by_site
export const finalOriginRobots403 = () => finalOriginRobots({ status: 403, html: '<html><body>Forbidden</body></html>' });
// a.com robots fails with a network error (not accessBlocked) -> still robots_final_unknown
export const finalOriginRobotsNetworkError = () => finalOriginRobots({ error: 'network' });

// ---------------------------------------------------------------- v1.7 blocked_by_site
// start robots.txt plain 403 (no cf-mitigated)
export function robots403Plain() {
  const routes = goodSiteRoutes();
  routes['https://a.com/robots.txt'] = { status: 403, html: '<html><body>Forbidden</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}
// start robots.txt 401
export function robots401() {
  const routes = goodSiteRoutes();
  routes['https://a.com/robots.txt'] = { status: 401, html: '<html><body>Unauthorized</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}
// robots allows all, home page answers `status` (403 / 401)
export function homeBlocked(status = 403) {
  const routes = goodSiteRoutes();
  routes['https://a.com/'] = { status, html: '<html><body>Forbidden</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}
export const home401 = () => homeBlocked(401);
// start robots.txt network error -> still robots_unknown
export function robotsNetworkError() {
  const routes = goodSiteRoutes();
  routes['https://a.com/robots.txt'] = { error: 'network' };
  return { site: createFakeSite({ routes }), start: START };
}

export const ALL_SCENARIOS = {
  s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23,
  r29Frontend, robots404, home404, foreignSitemap, userFetchBlocked, noOrgSchema,
  percentCase, wwwHomeCanonical, canonicalTargets, duplicateRedirect, fallbackSitemapGone, fallbackSitemap410, declaredSitemap404, homeNotHtml,
  homeChallenge500, robotsChallenge503, pageChallenge502, tenLinksTwoBroken, workerUnknownStart, workerUnknownHttp, workerUnknownOverflow,
  spaRoot50: () => spaRootText(50),
  spaRoot19: () => spaRootText(19),
  finalOriginRobotsUnknown,
  declaredSitemapXml404,
  declaredSitemapXml410,
  styledOn: () => styledSite(true),
  styledOff: () => styledSite(false),
  finalOriginRobots403,
  finalOriginRobotsNetworkError,
  robots403Plain,
  robots401,
  homeBlocked,
  home401,
  robotsNetworkError,
};

// v1.8: unavailable audit whose only scored finding is T03 (robots blocks Googlebot only; home 503)
export function googlebotBlockedHome503() {
  const routes = goodSiteRoutes({ robots: 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:\n' });
  routes['https://a.com/'] = { status: 503, html: '<html><body>Service Unavailable</body></html>' };
  return { site: createFakeSite({ routes }), start: START };
}
ALL_SCENARIOS.googlebotBlockedHome503 = googlebotBlockedHome503;
