// Fake target site + fake Worker/proxy, from the browser's point of view (SPEC-001 §4.3, §4.6, §5.1).
//
// createFakeSite({ routes, fallback, httpToHttps, siteHost }) returns { fetchFn, requests, violations, ... }.
//   fetchFn(url, kind) -> FetchResult = §4.3 meta + bytes (Uint8Array|null)
//   - page / sitemap / probe: NO redirect following; 3xx -> skipped 'redirect', absolute `location`, bytes null.
//   - robots: follows same-site redirects to `/robots.txt` (no query) up to 5 times, records `chain`,
//     sets `stop` ('offsite' | 'bad_redirect' | 'loop' | 'max_hops' | 'permit_denied' | 'location_too_long'),
//     and fills `ourPolicy` exactly like §4.6 step 5.
//   - The server-side DO checks (§4.5 consume) are emulated: requests the DO would refuse are answered with
//     the app.js error object (§5.1 step 3, error 'proxy_<code>') and recorded in `violations`.
//   - Every call is recorded in `requests` as { url, kind } in order.
//
// Route spec: { status=200, html | text | xml | body(+type), headers, location, error: 'network'|'timeout' }
// or a function (url) -> spec. Unknown URLs fall back to `fallback(url)`, then (optionally) http->https 301,
// then a 404 HTML page.

import {
  parseRobots,
  rulesFor,
  robotsPolicyFor,
  isAllowedByRules,
  OUR_RULES_MAX,
} from '../../public/core/robots.js';

export const OUR_TOKEN = 'kinsuiseocheck';
export const LIMITS = { page: 2_000_000, robots: 512_000, sitemap: 2_000_000, probe: 0 };
export const BUDGETS = { robots: 8, sitemap: 4, page: 30, probe: 2 };
const REDIRECTS = [301, 302, 303, 307, 308];
const TEXT_TYPES = ['application/xhtml+xml', 'application/xml', 'application/rss+xml', 'application/atom+xml'];
const enc = new TextEncoder();

export function stripWww(h) {
  const x = String(h).toLowerCase();
  return x.startsWith('www.') ? x.slice(4) : x;
}

export function pathAndQuery(url) {
  const u = new URL(url);
  return u.pathname + u.search;
}

function byteLen(s) {
  return enc.encode(s).length;
}

function isTextType(ct) {
  if (ct === null || ct === undefined || ct === '') return true;
  const t = String(ct).split(';')[0].trim().toLowerCase();
  return t.startsWith('text/') || TEXT_TYPES.includes(t);
}

function toBytes(b) {
  if (b === null || b === undefined) return new Uint8Array(0);
  if (b instanceof Uint8Array) return b;
  return enc.encode(String(b));
}

function normalizeSpec(spec) {
  const headers = {};
  let body = null;
  let type;
  if (spec.html !== undefined) {
    body = spec.html;
    type = 'text/html; charset=utf-8';
  } else if (spec.text !== undefined) {
    body = spec.text;
    type = 'text/plain; charset=utf-8';
  } else if (spec.xml !== undefined) {
    body = spec.xml;
    type = 'application/xml';
  } else if (spec.body !== undefined) {
    body = spec.body;
    type = spec.type; // may be null -> no content-type
  }
  if (type === undefined && spec.type !== undefined) type = spec.type;
  if (type !== undefined && type !== null) headers['content-type'] = type;
  for (const [k, v] of Object.entries(spec.headers || {})) {
    if (v === null || v === undefined) delete headers[k.toLowerCase()];
    else headers[k.toLowerCase()] = String(v);
  }
  const bytes = toBytes(body);
  if (!('content-length' in headers) && body !== null) headers['content-length'] = String(bytes.length);
  return {
    status: spec.status ?? 200,
    headers,
    bytes,
    location: spec.location ?? headers.location ?? null,
    error: spec.error ?? null,
  };
}

function pickHeaders(h) {
  let truncatedHeaders = false;
  const out = {};
  for (const name of ['content-type', 'x-robots-tag', 'content-length', 'cf-mitigated']) {
    let v = h[name];
    if (v === undefined || v === null) {
      out[name] = null;
      continue;
    }
    if (v.length > 512) {
      v = v.slice(0, 512);
      truncatedHeaders = true;
    }
    out[name] = v;
  }
  return { headers: out, truncatedHeaders };
}

// app.js §5.1 step 3 error object (non-200 answer from /api/fetch)
export function proxyErrorResult(url, error) {
  return {
    status: 0,
    finalUrl: url,
    location: null,
    chain: [],
    stop: null,
    headers: {},
    error: 'proxy_' + error,
    bodyLimit: 0,
    skipped: null,
    truncated: false,
    accessBlocked: false,
    truncatedHeaders: false,
    bytes: null,
  };
}

export function createFakeSite({ routes = {}, fallback = null, httpToHttps = true, siteHost = null } = {}) {
  const requests = [];
  const violations = [];
  const budgetRefusals = [];
  const used = { robots: 0, sitemap: 0, page: 0, probe: 0 };
  const policyByOrigin = new Map();
  let host = siteHost;

  function resolveRoute(url) {
    let spec = Object.prototype.hasOwnProperty.call(routes, url) ? routes[url] : undefined;
    if (typeof spec === 'function') spec = spec(url);
    if ((spec === undefined || spec === null) && fallback) spec = fallback(url);
    if ((spec === undefined || spec === null) && httpToHttps && url.startsWith('http://')) {
      spec = { status: 301, location: 'https://' + url.slice('http://'.length) };
    }
    if (spec === undefined || spec === null) {
      spec = {
        status: 404,
        html: '<!doctype html><html lang="zh-Hant-TW"><head><title>找不到頁面</title></head><body><h1>404</h1></body></html>',
      };
    }
    return normalizeSpec(spec);
  }

  // One upstream request, no redirect following (the proxy's view of a single fetch).
  function single(url, kind) {
    const raw = resolveRoute(url);
    if (raw.error) {
      return {
        status: 0,
        finalUrl: url,
        location: null,
        chain: [],
        stop: null,
        error: raw.error,
        bodyLimit: LIMITS[kind],
        skipped: null,
        truncated: false,
        accessBlocked: false,
        truncatedHeaders: false,
        headers: { 'content-type': null, 'x-robots-tag': null, 'content-length': null, 'cf-mitigated': null },
        ourPolicy: null,
        bytes: null,
      };
    }
    const { headers, truncatedHeaders } = pickHeaders(raw.headers);
    const r = {
      status: raw.status,
      finalUrl: url,
      location: null,
      chain: [],
      stop: null,
      error: null,
      bodyLimit: LIMITS[kind],
      skipped: null,
      truncated: false,
      accessBlocked:
        raw.status === 401 ||
        raw.status === 403 ||
        String(headers['cf-mitigated'] || '').toLowerCase() === 'challenge',
      truncatedHeaders,
      headers,
      ourPolicy: null,
      bytes: null,
    };
    if (raw.status >= 300 && raw.status < 400) {
      if (raw.location) {
        const abs = new URL(raw.location, url).href;
        if (byteLen(abs) > 2048) {
          r.location = null;
          r.stop = 'location_too_long';
        } else {
          r.location = abs;
        }
      }
      r.skipped = 'redirect';
      return r;
    }
    if (kind === 'probe') {
      r.skipped = 'probe';
      return r;
    }
    if (!isTextType(headers['content-type'])) {
      r.skipped = 'non_text';
      return r;
    }
    let bytes = raw.bytes;
    if (bytes.length > LIMITS[kind]) {
      bytes = bytes.slice(0, LIMITS[kind]);
      r.truncated = true;
    }
    r.bytes = bytes;
    return r;
  }

  function computeOurPolicy(result) {
    let policy = robotsPolicyFor(result);
    let rules = [];
    let rulesCount = 0;
    if (policy === 'parse') {
      const text = new TextDecoder('utf-8').decode(result.bytes);
      const parsed = parseRobots(text, { truncated: !!result.truncated });
      if (parsed.overflow) {
        policy = 'unknown';
      } else {
        const r = rulesFor(parsed, OUR_TOKEN).rules;
        rulesCount = r.length;
        if (r.length > OUR_RULES_MAX) policy = 'unknown';
        else if (r.length === 0) policy = 'allow_all';
        else {
          policy = 'rules';
          rules = r;
        }
      }
    }
    return { policy, rules, rulesCount };
  }

  // Emulates GateCore.consume (§4.5) for the request the browser asked for.
  function doCheck(url, kind) {
    const u = new URL(url);
    if (host === null) host = stripWww(u.hostname);
    if (stripWww(u.hostname) !== host) return 'host_not_allowed';
    if (kind === 'robots') {
      if (u.pathname !== '/robots.txt' || u.search !== '') return 'kind_path';
    } else if (kind === 'sitemap') {
      const p = u.pathname.toLowerCase();
      if (!(p.endsWith('.xml') || p.includes('sitemap'))) return 'kind_path';
    }
    if (used[kind] >= BUDGETS[kind]) return 'budget_exhausted';
    if (kind !== 'robots') {
      const pol = policyByOrigin.get(u.origin);
      if (!pol) return 'robots_required';
      if (pol.policy === 'allow_all') return null;
      if (pol.policy === 'rules') return isAllowedByRules(pol.rules, pathAndQuery(url)) ? null : 'robots_disallowed';
      return 'robots_disallowed';
    }
    return null;
  }

  function fetchRobots(url) {
    const siteH = stripWww(new URL(url).hostname);
    const chain = [];
    const seen = new Set([url]);
    let current = url;
    let hops = 0;
    let stop = null;
    let r;
    for (;;) {
      r = single(current, 'robots');
      if (r.error) break;
      if (r.stop) {
        stop = r.stop; // location_too_long
        break;
      }
      if (REDIRECTS.includes(r.status) && r.location) {
        chain.push({ url: current, status: r.status, location: r.location });
        if (hops >= 5) {
          stop = 'max_hops';
          break;
        }
        const next = new URL(r.location);
        if (stripWww(next.hostname) !== siteH) {
          stop = 'offsite';
          break;
        }
        if (next.pathname !== '/robots.txt' || next.search !== '') {
          stop = 'bad_redirect';
          break;
        }
        if (seen.has(next.href)) {
          stop = 'loop';
          break;
        }
        // permit for hop 2+ (one more robots budget unit per hop)
        if (used.robots >= BUDGETS.robots) {
          stop = 'permit_denied';
          r.error = 'budget_exhausted';
          r.bytes = null;
          break;
        }
        used.robots++;
        seen.add(next.href);
        hops++;
        current = next.href;
        continue;
      }
      break;
    }
    r.chain = chain;
    r.stop = stop;
    r.finalUrl = current;
    if (r.error || r.skipped) r.bytes = null;
    const pol = computeOurPolicy(r);
    r.ourPolicy = { policy: pol.policy, rulesCount: pol.rulesCount };
    const origins = new Set([new URL(url).origin, ...chain.map((c) => new URL(c.url).origin), new URL(current).origin]);
    for (const o of origins) policyByOrigin.set(o, { policy: pol.policy, rules: pol.rules });
    return r;
  }

  async function fetchFn(url, kind) {
    requests.push({ url, kind });
    let refusal;
    try {
      refusal = doCheck(url, kind);
    } catch {
      refusal = 'invalid_url';
    }
    if (refusal) {
      if (refusal === 'budget_exhausted') budgetRefusals.push({ url, kind });
      else violations.push({ url, kind, error: refusal });
      return proxyErrorResult(url, refusal);
    }
    used[kind]++;
    if (kind === 'robots') return fetchRobots(url);
    return single(url, kind);
  }

  return {
    fetchFn,
    requests,
    violations,
    budgetRefusals,
    used,
    policyByOrigin,
    requested(url, kind) {
      return requests.some((r) => r.url === url && (kind === undefined || r.kind === kind));
    },
    indexOf(url, kind) {
      return requests.findIndex((r) => r.url === url && (kind === undefined || r.kind === kind));
    },
    urls(kind) {
      return requests.filter((r) => kind === undefined || r.kind === kind).map((r) => r.url);
    },
  };
}

// ---------------------------------------------------------------- content builders

const FILLER = '這是一段用來測試網站健檢工具的正文內容，說明公司的產品、服務與聯絡方式，讓讀者可以清楚了解。';

export const ORG_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: '金水範例公司',
  url: 'https://a.com/',
  logo: 'https://a.com/logo.png',
};

// Builds a full HTML document. `title` is inserted raw (callers may pass entities on purpose).
export function page({
  title = '範例頁面',
  extraTitles = [],
  description,
  canonical = null,
  canonicals = null,
  lang = 'zh-Hant-TW',
  viewport = true,
  og = true,
  robotsMeta = null,
  jsonld = [],
  links = [],
  h1 = '頁面主標題',
  text = FILLER.repeat(6),
  images = [{ src: '/img/photo.png', alt: '產品照片' }],
  head = '',
  body = '',
} = {}) {
  const desc = description === undefined ? `${title} 的頁面說明，介紹本頁內容。` : description;
  const parts = [];
  parts.push('<!doctype html>');
  parts.push(lang === null ? '<html>' : `<html lang="${lang}">`);
  parts.push('<head><meta charset="utf-8">');
  if (title !== null) parts.push(`<title>${title}</title>`);
  for (const t of extraTitles) parts.push(`<title>${t}</title>`);
  if (desc !== null) parts.push(`<meta name="description" content="${desc}">`);
  if (viewport) parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (robotsMeta) parts.push(`<meta name="robots" content="${robotsMeta}">`);
  const cans = canonicals ?? (canonical ? [canonical] : []);
  for (const c of cans) parts.push(`<link rel="canonical" href="${c}">`);
  if (og) {
    parts.push(`<meta property="og:title" content="${title === null ? 'og' : title}">`);
    parts.push(`<meta property="og:description" content="${desc === null ? 'og' : desc}">`);
    parts.push('<meta property="og:image" content="https://a.com/og.png">');
  }
  for (const j of jsonld) {
    parts.push(`<script type="application/ld+json">${typeof j === 'string' ? j : JSON.stringify(j)}</script>`);
  }
  parts.push(head);
  parts.push('</head><body>');
  if (h1 !== null) parts.push(`<h1>${h1}</h1>`);
  parts.push(`<p>${text}</p>`);
  for (const im of images) {
    parts.push(im.alt === undefined ? `<img src="${im.src}">` : `<img src="${im.src}" alt="${im.alt}">`);
  }
  parts.push('<nav>');
  for (const l of links) {
    const href = typeof l === 'string' ? l : l.href;
    const label = typeof l === 'string' ? '連結 ' + href : l.text;
    parts.push(`<a href="${href}">${label}</a>`);
  }
  parts.push('</nav>');
  parts.push(body);
  parts.push('</body></html>');
  return parts.join('\n');
}

function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sitemapXml(urls) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${escXml(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n'
  );
}

export const GOOD_PATHS = ['/', '/about', '/services', '/products', '/news', '/contact', '/faq', '/blog'];
const GOOD_NAMES = {
  '/': '專業五金零件供應',
  '/about': '關於我們',
  '/services': '服務項目',
  '/products': '產品介紹',
  '/news': '最新消息',
  '/contact': '聯絡我們',
  '/faq': '常見問題',
  '/blog': '技術文章',
};

// A healthy https site (S01 baseline). `robots` text, `sitemap` toggle, and per-path page() overrides.
export function goodSiteRoutes({
  origin = 'https://a.com',
  paths = GOOD_PATHS,
  robots = 'User-agent: *\nDisallow:\n\nSitemap: https://a.com/sitemap.xml\n',
  sitemap = true,
  overrides = {},
} = {}) {
  const routes = {};
  routes[origin + '/robots.txt'] = { text: robots };
  if (sitemap) routes[origin + '/sitemap.xml'] = { xml: sitemapXml(paths.map((p) => origin + p)) };
  for (const p of paths) {
    const url = origin + p;
    const isHome = p === '/';
    const name = GOOD_NAMES[p] || `頁面 ${p}`;
    const o = overrides[p] || {};
    routes[url] = {
      ...(o.route || {}),
      html: page({
        title: `金水範例公司｜${name}`,
        description: `金水範例公司的${name}頁面，提供完整說明與資訊。`,
        canonical: url,
        links: isHome ? paths.filter((x) => x !== '/') : ['/'],
        jsonld: isHome ? [ORG_JSONLD] : [],
        h1: name,
        ...(o.page || {}),
      }),
    };
  }
  return routes;
}

export function seededRandom(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
