import { VERSION } from './version.js';
import {
  REDIRECT_STATUSES,
  cleanUrl,
  isSameSite,
  normalizeInputUrl,
  pathAndQuery,
  stripQuery,
  stripWww,
} from './url.js';
import {
  isAllowedByRules,
  normalizePath,
  parseRobots,
  robotsPolicyFor,
  rulesFor,
} from './robots.js';
import { OUR_TOKEN } from './bots.js';
import { decodeBody, extractPage, stripInlineStyles } from './parse.js';
import { looksLikeHtml, parseSitemap } from './sitemap.js';

export const SKIP_EXTENSIONS = Object.freeze([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.pdf', '.zip', '.rar', '.7z',
  '.mp4', '.mp3', '.mov', '.avi', '.css', '.js', '.json', '.xml', '.txt', '.doc', '.docx',
  '.xls', '.xlsx', '.ppt', '.pptx', '.gz',
]);

export const CRAWL_LIMITS = Object.freeze({ discovered: 5000, inlinksPerUrl: 50, maxHops: 5 });

const FAILURE_REASONS = new Set([
  'robots_unknown', 'robots_disallow_all', 'robots_overflow', 'blocked_for_tool',
  'home_not_analyzable', 'home_unavailable', 'offsite', 'robots_final_unknown',
]);
const DEFECT_REASONS = new Set([
  ...FAILURE_REASONS,
  'fetch_errors', 'access_blocked', 'truncated', 'timed_out', 'page_unanalyzable',
  'sitemap_unverifiable', 'parse_limit', 'budget_exhausted',
]);
const REASON_ORDER = [
  'robots_unknown', 'robots_disallow_all', 'robots_overflow', 'blocked_for_tool',
  'home_not_analyzable', 'home_unavailable', 'offsite', 'robots_final_unknown',
  'fetch_errors', 'access_blocked', 'truncated', 'timed_out', 'page_unanalyzable',
  'sitemap_unverifiable', 'parse_limit', 'budget_exhausted', 'page_limit',
  'robots_skipped', 'sitemap_limit',
];

function flattenResult(result, requestedUrl) {
  const raw = result && typeof result === 'object' ? result : {};
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : raw;
  return {
    status: Number.isFinite(meta.status) ? meta.status : 0,
    finalUrl: meta.finalUrl || requestedUrl,
    location: meta.location || null,
    chain: Array.isArray(meta.chain) ? meta.chain : [],
    stop: meta.stop || null,
    error: meta.error || null,
    bodyLimit: Number.isFinite(meta.bodyLimit) ? meta.bodyLimit : 0,
    skipped: meta.skipped || null,
    truncated: Boolean(meta.truncated),
    accessBlocked: Boolean(meta.accessBlocked),
    truncatedHeaders: Boolean(meta.truncatedHeaders),
    headers: meta.headers && typeof meta.headers === 'object' ? meta.headers : {},
    ourPolicy: meta.ourPolicy || null,
    bytes: raw.bytes == null ? null : raw.bytes instanceof Uint8Array ? raw.bytes : new Uint8Array(raw.bytes),
  };
}

function failedResult(url, error) {
  return flattenResult({ status: 0, finalUrl: url, error, bytes: null }, url);
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
}

function taipeiIso(value) {
  const shifted = new Date(timestamp(value) + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+08:00`;
}

function isSkippable(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return SKIP_EXTENSIONS.some((extension) => path.endsWith(extension));
  } catch {
    return true;
  }
}

function contentType(result) {
  return result.headers?.['content-type'] ?? result.headers?.['Content-Type'] ?? null;
}

function pageIsHtml(result, text) {
  const type = contentType(result);
  if (type != null) return /(?:^|;)\s*(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu.test(String(type));
  return looksLikeHtml(text, null);
}

function uniqueOrigins(info, requestedOrigin) {
  const origins = new Set([requestedOrigin]);
  const add = (value) => {
    try { origins.add(new URL(value).origin); } catch { /* malformed metadata stays isolated */ }
  };
  for (const hop of info.chain || []) {
    add(hop?.url);
  }
  add(info.finalUrl);
  return origins;
}

export async function runAudit(startUrl, {
  fetchFn,
  parseHtml,
  maxPages = 15,
  delayMs = 300,
  timeBudgetMs = 90000,
  onProgress = () => {},
  now = () => new Date(),
  random = Math.random,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is required');
  if (typeof parseHtml !== 'function') throw new TypeError('parseHtml is required');
  const normalized = normalizeInputUrl(startUrl);
  if (!normalized) throw new TypeError('invalid startUrl');
  const start = stripQuery(normalized);
  const startObject = new URL(start);
  const siteHost = stripWww(startObject.hostname);
  const origin0 = startObject.origin;
  const homeUrl0 = `${origin0}/`;
  const startedAt = timestamp(now());
  const reasons = new Set();
  const robotsByOrigin = new Map();
  const disabledKinds = new Set();
  let lastFetchAtLeastOnce = false;
  let timedOut = false;
  let pageRequests = 0;
  let sitemapRequests = 0;
  let robotsInitial = null;
  let stoppedOffsite = false;
  let homeSkippedByRobots = false;

  const elapsed = () => timestamp(now()) - startedAt;
  const hasTime = () => {
    if (elapsed() >= timeBudgetMs) {
      timedOut = true;
      reasons.add('timed_out');
      return false;
    }
    return true;
  };

  async function request(url, kind) {
    if (disabledKinds.has(kind)) return failedResult(url, 'proxy_budget_exhausted');
    if (kind === 'sitemap' && sitemapRequests >= 4) {
      reasons.add('sitemap_limit');
      return failedResult(url, 'sitemap_limit');
    }
    if (!hasTime()) return failedResult(url, 'timeout');
    if (lastFetchAtLeastOnce && delayMs > 0) {
      await sleep(delayMs);
      if (!hasTime()) return failedResult(url, 'timeout');
    }
    lastFetchAtLeastOnce = true;
    if (kind === 'page') pageRequests += 1;
    if (kind === 'sitemap') sitemapRequests += 1;
    let result;
    try {
      result = flattenResult(await fetchFn(url, kind), url);
    } catch {
      result = failedResult(url, 'network');
    }
    if (result.error === 'proxy_budget_exhausted') {
      disabledKinds.add(kind);
      reasons.add('budget_exhausted');
    }
    try { onProgress({ kind, url, status: result.status, error: result.error }); } catch { /* progress cannot break an audit */ }
    return result;
  }

  function robotsFailureReason(info) {
    if (info?.parsed?.overflow) return 'robots_overflow';
    if (info?.ourPolicy?.policy === 'disallow_all') return 'robots_disallow_all';
    return 'robots_unknown';
  }

  async function ensureRobots(origin) {
    if (robotsByOrigin.has(origin)) return robotsByOrigin.get(origin);
    const url = `${origin}/robots.txt`;
    const result = await request(url, 'robots');
    const text = result.bytes == null ? null : decodeBody(result.bytes, contentType(result));
    let policy = robotsPolicyFor({ ...result, bytes: result.bytes });
    let parsed = null;
    if (policy === 'parse' && text != null) {
      parsed = parseRobots(text, { truncated: result.truncated });
      if (parsed.overflow) policy = 'unknown';
    }
    const info = {
      url,
      origin,
      status: result.status,
      policy,
      ourPolicy: result.ourPolicy,
      error: result.error,
      accessBlocked: result.accessBlocked,
      truncated: result.truncated,
      stop: result.stop,
      chain: result.chain,
      headers: result.headers,
      skipped: result.skipped,
      text,
      parsed,
    };
    for (const representedOrigin of uniqueOrigins(result, origin)) {
      robotsByOrigin.set(representedOrigin, { ...info, origin: representedOrigin, url: `${representedOrigin}/robots.txt` });
    }
    if (!robotsByOrigin.has(origin)) robotsByOrigin.set(origin, info);
    return info;
  }

  function ourAllowed(url) {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { return false; }
    const info = robotsByOrigin.get(parsedUrl.origin);
    const policy = info?.ourPolicy?.policy;
    if (policy === 'allow_all') return true;
    if (policy !== 'rules' || !info?.parsed || info.parsed.overflow) return false;
    const selected = rulesFor(info.parsed, OUR_TOKEN).rules;
    return isAllowedByRules(selected, normalizePath(pathAndQuery(parsedUrl)));
  }

  async function fetchFollow(initialUrl, kind) {
    const chain = [];
    const seen = new Set();
    let current = initialUrl;
    let previous = null;
    for (let hop = 0; hop <= CRAWL_LIMITS.maxHops; hop += 1) {
      const origin = new URL(current).origin;
      await ensureRobots(origin);
      if (!ourAllowed(current)) {
        return {
          ...(previous || failedResult(current, null)),
          finalUrl: current,
          chain,
          stop: 'robots_disallowed',
          bytes: null,
        };
      }
      if (!hasTime()) return { ...(previous || failedResult(current, 'timeout')), finalUrl: current, chain, bytes: null };
      seen.add(current);
      const result = await request(current, kind);
      previous = result;
      if (!REDIRECT_STATUSES.includes(result.status) || !result.location) {
        return { ...result, finalUrl: current, chain, stop: result.stop || null };
      }
      const location = cleanUrl(result.location, current);
      chain.push({ url: current, status: result.status, location });
      if (!location) return { ...result, finalUrl: current, chain, stop: result.stop || 'bad_redirect', bytes: null };
      if (!isSameSite(location, siteHost)) return { ...result, finalUrl: current, location, chain, stop: 'offsite', bytes: null };
      if (seen.has(location)) return { ...result, finalUrl: current, location, chain, stop: 'loop', bytes: null };
      if (hop === CRAWL_LIMITS.maxHops) return { ...result, finalUrl: current, location, chain, stop: 'max_hops', bytes: null };
      current = location;
    }
    return { ...(previous || failedResult(current, null)), finalUrl: current, chain, stop: 'max_hops', bytes: null };
  }

  let origin = origin0;
  let home = homeUrl0;
  let robots = await ensureRobots(origin0);
  const earlySnapshot = () => finalizeSnapshot({
    version: VERSION,
    startUrl: start,
    siteHost,
    origin,
    home,
    scannedAt: taipeiIso(now()),
    robots,
    robotsInitial,
    sitemaps: [],
    sitemapUrls: [],
    pages: [],
    discovered: {},
    probes: { soft404: null, http: null },
    homeAnalyzable: false,
    homeSkippedByRobots,
    stoppedOffsite,
  }, reasons, maxPages, pageRequests, 0, 0, timedOut);

  if (!robots?.ourPolicy || ['disallow_all', 'unknown'].includes(robots.ourPolicy.policy)) {
    reasons.add(robotsFailureReason(robots));
    return earlySnapshot();
  }
  if (!ourAllowed(homeUrl0)) {
    homeSkippedByRobots = true;
    reasons.add('blocked_for_tool');
    return earlySnapshot();
  }

  const homeResult = await fetchFollow(homeUrl0, 'page');
  if (homeResult.stop === 'offsite') {
    stoppedOffsite = true;
    reasons.add('offsite');
  } else {
    home = homeResult.finalUrl || homeUrl0;
    origin = new URL(home).origin;
  }
  if (origin !== origin0) robotsInitial = robotsByOrigin.get(origin0) || robots;
  robots = robotsByOrigin.get(origin) || await ensureRobots(origin);

  const discovered = {};
  let discoveryOverflow = false;
  let skippedByRobots = 0;
  const skippedUrls = new Set();
  const queue = [];
  const queued = new Set();

  function discover(rawUrl, { referrer = null, fromSitemap = false, depth = 0, enqueue = true } = {}) {
    const url = cleanUrl(rawUrl);
    if (!url || !isSameSite(url, siteHost) || isSkippable(url)) return null;
    if (!Object.hasOwn(discovered, url)) {
      if (Object.keys(discovered).length >= CRAWL_LIMITS.discovered) {
        discoveryOverflow = true;
        reasons.add('parse_limit');
        return null;
      }
      discovered[url] = { inlinks: [], fromSitemap: Boolean(fromSitemap), crawled: false };
    } else if (fromSitemap) {
      discovered[url].fromSitemap = true;
    }
    if (referrer && !discovered[url].inlinks.includes(referrer)) {
      if (discovered[url].inlinks.length < CRAWL_LIMITS.inlinksPerUrl) discovered[url].inlinks.push(referrer);
      else {
        discoveryOverflow = true;
        reasons.add('parse_limit');
      }
    }
    if (enqueue && !queued.has(url)) {
      queued.add(url);
      queue.push({ url, depth });
    }
    return url;
  }

  const pages = [];
  const finalSeen = new Map();

  async function makePageEntry(requestedUrl, depth, result) {
    let text = null;
    let isHtml = false;
    let page = null;
    let duplicateOf = null;
    const finalUrl = result.finalUrl || requestedUrl;
    if (result.bytes != null) {
      text = decodeBody(result.bytes, contentType(result));
      isHtml = pageIsHtml(result, text);
    }
    if (finalSeen.has(finalUrl)) duplicateOf = finalSeen.get(finalUrl);
    else finalSeen.set(finalUrl, finalUrl);
    if (!duplicateOf && result.status === 200 && isHtml && !result.error && !result.accessBlocked && !result.stop) {
      try {
        const doc = await parseHtml(stripInlineStyles(text), finalUrl);
        page = extractPage(doc, finalUrl);
      } catch {
        page = null;
      }
    }
    return {
      url: requestedUrl,
      finalUrl,
      status: result.status,
      chain: result.chain || [],
      stop: result.stop || null,
      headers: result.headers || {},
      error: result.error || null,
      accessBlocked: Boolean(result.accessBlocked),
      truncated: Boolean(result.truncated),
      truncatedHeaders: Boolean(result.truncatedHeaders),
      isHtml,
      page,
      duplicateOf,
      depth,
    };
  }

  const homeEntry = await makePageEntry(homeUrl0, 0, homeResult);
  pages.push(homeEntry);
  discover(homeUrl0, { depth: 0, enqueue: false });
  discovered[homeUrl0].crawled = true;
  if (home !== homeUrl0) discover(home, { depth: 0, enqueue: false });
  if (discovered[home]) discovered[home].crawled = true;

  const homeAnalyzable = homeEntry.status === 200 && homeEntry.isHtml && homeEntry.page !== null
    && !homeEntry.error && !homeEntry.accessBlocked && !homeEntry.stop;

  if (stoppedOffsite) {
    return finalizeSnapshot({
      version: VERSION, startUrl: start, siteHost, origin, home, scannedAt: taipeiIso(now()), robots,
      robotsInitial, sitemaps: [], sitemapUrls: [], pages, discovered,
      probes: { soft404: null, http: null }, homeAnalyzable: false, homeSkippedByRobots, stoppedOffsite,
    }, reasons, maxPages, pageRequests, skippedByRobots, countNotCrawled(discovered, skippedUrls), timedOut);
  }

  if (!robots?.ourPolicy || ['disallow_all', 'unknown'].includes(robots.ourPolicy.policy)) {
    reasons.add('robots_final_unknown');
    return finalizeSnapshot({
      version: VERSION, startUrl: start, siteHost, origin, home, scannedAt: taipeiIso(now()), robots,
      robotsInitial, sitemaps: [], sitemapUrls: [], pages, discovered,
      probes: { soft404: null, http: null }, homeAnalyzable, homeSkippedByRobots, stoppedOffsite,
    }, reasons, maxPages, pageRequests, skippedByRobots, countNotCrawled(discovered, skippedUrls), timedOut);
  }

  if (!homeAnalyzable) {
    reasons.add([429, 503].includes(homeEntry.status) ? 'home_unavailable' : 'home_not_analyzable');
    if (homeEntry.error) reasons.add('fetch_errors');
    if (homeEntry.accessBlocked) reasons.add('access_blocked');
    if (homeEntry.truncated) reasons.add('truncated');
    return finalizeSnapshot({
      version: VERSION, startUrl: start, siteHost, origin, home, scannedAt: taipeiIso(now()), robots,
      robotsInitial, sitemaps: [], sitemapUrls: [], pages, discovered,
      probes: { soft404: null, http: null }, homeAnalyzable, homeSkippedByRobots, stoppedOffsite,
    }, reasons, maxPages, pageRequests, skippedByRobots, countNotCrawled(discovered, skippedUrls), timedOut);
  }

  const sitemaps = [];
  const sitemapUrls = [];
  const sitemapUrlSeen = new Set();
  const declaredSitemaps = [];
  for (const raw of robots?.parsed?.sitemaps || []) {
    const url = cleanUrl(raw, origin);
    if (url && isSameSite(url, siteHost) && !declaredSitemaps.includes(url)) declaredSitemaps.push(url);
    if (declaredSitemaps.length >= 2) break;
  }
  const sitemapCandidates = declaredSitemaps.length
    ? declaredSitemaps.map((url) => ({ url, fallback: false }))
    : [{ url: `${origin}/sitemap.xml`, fallback: true }];

  function addSitemapPageUrl(raw) {
    const url = cleanUrl(raw);
    if (!url || sitemapUrlSeen.has(url) || sitemapUrls.length >= CRAWL_LIMITS.discovered) return;
    sitemapUrlSeen.add(url);
    sitemapUrls.push(url);
  }

  async function inspectSitemap(url, fallback) {
    if (/\.gz(?:$|\?)/iu.test(new URL(url).pathname + new URL(url).search)) {
      const record = { url, status: 0, kind: 'gzip', urlCount: 0, fallback, error: null, truncated: false, accessBlocked: false };
      sitemaps.push(record);
      reasons.add('sitemap_unverifiable');
      return { record, parsed: null };
    }
    await ensureRobots(new URL(url).origin);
    if (!ourAllowed(url)) {
      const record = { url, status: 0, kind: 'robots_disallowed', urlCount: 0, fallback, error: null, truncated: false, accessBlocked: false };
      sitemaps.push(record);
      reasons.add('sitemap_unverifiable');
      return { record, parsed: null };
    }
    if (sitemapRequests >= 4) {
      reasons.add('sitemap_limit');
      return { record: null, parsed: null };
    }
    const result = await fetchFollow(url, 'sitemap');
    let kind = 'error';
    let parsed = null;
    let error = result.error;
    if (result.stop === 'robots_disallowed') kind = 'robots_disallowed';
    else if ((result.status === 404 || result.status === 410) && !result.error && !result.accessBlocked) {
      kind = 'missing';
      error = null;
    } else if (result.status === 200 && result.bytes != null && !result.error && !result.accessBlocked && !result.truncated) {
      const text = decodeBody(result.bytes, contentType(result));
      if (looksLikeHtml(text, contentType(result))) kind = 'html';
      else {
        parsed = parseSitemap(text);
        kind = parsed.kind;
        error = parsed.error;
      }
    }
    const record = {
      url,
      status: result.status,
      kind,
      urlCount: parsed?.urls?.length || 0,
      fallback,
      error: error || null,
      truncated: Boolean(result.truncated),
      accessBlocked: Boolean(result.accessBlocked),
    };
    sitemaps.push(record);
    if (kind !== 'missing' && (kind === 'error' || kind === 'robots_disallowed' || result.truncated || result.accessBlocked)) reasons.add('sitemap_unverifiable');
    return { record, parsed };
  }

  for (const candidate of sitemapCandidates) {
    if (disabledKinds.has('sitemap')) break;
    const parent = await inspectSitemap(candidate.url, candidate.fallback);
    if (!parent.parsed) continue;
    if (parent.parsed.kind === 'urlset') {
      for (const url of parent.parsed.urls) addSitemapPageUrl(url);
      continue;
    }
    if (parent.parsed.kind === 'index') {
      for (let i = 0; i < parent.parsed.urls.length; i += 1) {
        if (disabledKinds.has('sitemap')) break;
        const childUrl = cleanUrl(parent.parsed.urls[i]);
        if (!childUrl || !isSameSite(childUrl, siteHost)) continue;
        if (sitemapRequests >= 4) {
          reasons.add('sitemap_limit');
          break;
        }
        const child = await inspectSitemap(childUrl, false);
        if (child.parsed?.kind === 'urlset') for (const url of child.parsed.urls) addSitemapPageUrl(url);
      }
    }
  }

  const sourceForLinks = homeEntry.finalUrl || homeEntry.url;
  if (start !== home && start !== homeUrl0) discover(start, { depth: 0 });
  for (const link of homeEntry.page.links) discover(link.url, { referrer: sourceForLinks, depth: 1 });
  for (const url of sitemapUrls) discover(url, { fromSitemap: true, depth: 0 });

  while (queue.length && pages.length < maxPages && !timedOut) {
    if (disabledKinds.has('page')) break;
    const item = queue.shift();
    if (!item || discovered[item.url]?.crawled) continue;
    const itemOrigin = new URL(item.url).origin;
    await ensureRobots(itemOrigin);
    if (!ourAllowed(item.url)) {
      skippedUrls.add(item.url);
      skippedByRobots += 1;
      reasons.add('robots_skipped');
      continue;
    }
    if (!hasTime()) break;
    const result = await fetchFollow(item.url, 'page');
    discovered[item.url].crawled = true;
    const entry = await makePageEntry(item.url, item.depth, result);
    pages.push(entry);
    if (entry.finalUrl !== item.url) {
      discover(entry.finalUrl, { depth: item.depth, enqueue: false });
      if (entry.stop === 'robots_disallowed') {
        skippedUrls.add(entry.finalUrl);
        skippedByRobots += 1;
        reasons.add('robots_skipped');
      } else if (discovered[entry.finalUrl]) {
        discovered[entry.finalUrl].crawled = true;
      }
    }
    if (entry.error) reasons.add(entry.error === 'proxy_budget_exhausted' ? 'budget_exhausted' : 'fetch_errors');
    if (entry.status === 429 || entry.status === 503) reasons.add('fetch_errors');
    if (entry.accessBlocked) reasons.add('access_blocked');
    if (entry.truncated) reasons.add('truncated');
    if (entry.status === 200 && !entry.duplicateOf && (!entry.isHtml || !entry.page)) reasons.add('page_unanalyzable');
    if (entry.page?.limitsHit?.length) reasons.add('parse_limit');
    if (entry.error === 'proxy_budget_exhausted') break;
    if (!entry.page || entry.duplicateOf || entry.stop) continue;
    for (const link of entry.page.links) discover(link.url, {
      referrer: entry.finalUrl,
      depth: item.depth + 1,
    });
  }

  const notCrawledBeforeProbes = countNotCrawled(discovered, skippedUrls);
  if (notCrawledBeforeProbes > 0 && pages.length >= maxPages) reasons.add('page_limit');
  if (discoveryOverflow) reasons.add('parse_limit');

  const probes = { soft404: null, http: null };
  if (homeAnalyzable && !timedOut) {
    const randomValue = Math.max(0, Math.min(0xffffffff, Math.floor(Number(random()) * 0x100000000)));
    const softUrl = `${origin}/seo-check-404-${randomValue.toString(16).padStart(8, '0')}`;
    if (ourAllowed(softUrl) && !disabledKinds.has('probe')) probes.soft404 = toProbe(softUrl, await request(softUrl, 'probe'));
    if (origin.startsWith('https://') && !timedOut && !disabledKinds.has('probe')) {
      const httpOrigin = `http://${new URL(home).host}`;
      await ensureRobots(httpOrigin);
      const httpUrl = `${httpOrigin}${pathAndQuery(home)}`;
      if (ourAllowed(httpUrl)) probes.http = toProbe(httpUrl, await request(httpUrl, 'probe'));
    }
  }

  return finalizeSnapshot({
    version: VERSION,
    startUrl: start,
    siteHost,
    origin,
    home,
    scannedAt: taipeiIso(now()),
    robots,
    robotsInitial,
    sitemaps,
    sitemapUrls,
    pages,
    discovered,
    probes,
    homeAnalyzable,
    homeSkippedByRobots,
    stoppedOffsite,
  }, reasons, maxPages, pageRequests, skippedByRobots, countNotCrawled(discovered, skippedUrls), timedOut);
}

function toProbe(url, result) {
  return {
    url,
    status: result.status,
    location: result.location || null,
    error: result.error || null,
    accessBlocked: Boolean(result.accessBlocked),
  };
}

function countNotCrawled(discovered, skippedUrls) {
  return Object.entries(discovered).filter(([url, info]) => !info.crawled && !skippedUrls.has(url)).length;
}

function finalizeSnapshot(base, reasons, maxPages, requests, skippedByRobots, notCrawled, timedOut) {
  if (timedOut) reasons.add('timed_out');
  const orderedReasons = REASON_ORDER.filter((reason) => reasons.has(reason));
  for (const reason of reasons) if (!orderedReasons.includes(reason)) orderedReasons.push(reason);
  const failed = orderedReasons.some((reason) => FAILURE_REASONS.has(reason));
  const status = failed ? 'failed' : orderedReasons.length ? 'partial' : 'complete';
  return {
    ...base,
    coverage: {
      status,
      reasons: orderedReasons,
      defects: orderedReasons.some((reason) => DEFECT_REASONS.has(reason)),
    },
    limits: {
      maxPages,
      crawled: base.pages.length,
      requests,
      skippedByRobots,
      notCrawled,
      timedOut: Boolean(timedOut),
    },
  };
}
