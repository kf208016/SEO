// Scenario site builders for S01–S23 (SPEC-001 §12.4) and a few extra checks.
import { createFakeSite, goodSiteRoutes, page, sitemapXml, GOOD_PATHS } from './fakesite.mjs';

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

export const ALL_SCENARIOS = {
  s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23,
  r29Frontend, robots404, home404, foreignSitemap, userFetchBlocked, noOrgSchema,
};
