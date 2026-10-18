import { hostAllowed } from './guard.js';
import { resolvePublic } from './dns.js';
import { REDIRECT_STATUSES } from '../public/core/url.js';

export const BODY_LIMITS = { page: 2_000_000, robots: 512_000, sitemap: 2_000_000, probe: 0 };
export const MAX_URL_BYTES = 2048;

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; KinsuiSEOCheck/1.0; +https://seo-geo-check.fanyuchieh.workers.dev/bot.html)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.5',
};
const TEXT_TYPES = ['application/xhtml+xml', 'application/xml', 'application/rss+xml', 'application/atom+xml'];

function baseMeta(url, kind) {
  return {
    status: 0, finalUrl: url, location: null, chain: [], stop: null, error: null,
    bodyLimit: BODY_LIMITS[kind] ?? 0, skipped: null, truncated: false,
    accessBlocked: false, truncatedHeaders: false,
    headers: { 'content-type': null, 'x-robots-tag': null, 'content-length': null, 'cf-mitigated': null },
    ourPolicy: null,
  };
}

function isTimeout(error, signal) {
  return signal?.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

async function withAbort(promise, signal) {
  const guarded = Promise.resolve(promise);
  if (signal.aborted) {
    guarded.catch(() => {});
    throw signal.reason ?? new DOMException('逾時', 'AbortError');
  }
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('逾時', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([guarded, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function cancelBody(response, signal) {
  if (!response?.body) return;
  try { await withAbort(response.body.cancel(), signal); } catch { /* cancellation is best effort */ }
}

async function readLimited(response, limit, signal) {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total <= limit) {
      if (signal.aborted) throw new DOMException('逾時', 'AbortError');
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      chunks.push(chunk);
      total += chunk.byteLength;
      if (total > limit) {
        await withAbort(reader.cancel(), signal).catch(() => {});
        break;
      }
    }
  } catch (error) {
    await withAbort(reader.cancel(), signal).catch(() => {});
    throw error;
  }
  const keep = Math.min(total, limit);
  const output = new Uint8Array(keep);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= keep) break;
    const part = chunk.subarray(0, keep - offset);
    output.set(part, offset);
    offset += part.byteLength;
  }
  return { bytes: output, truncated: total > limit };
}

export async function proxyFetch(targetUrl, kind, siteHost, {
  fetchImpl = fetch,
  resolveImpl = resolvePublic,
  selfHosts = [],
  deadlineMs = 12_000,
  permit = async () => ({ ok: true }),
} = {}) {
  const meta = baseMeta(targetUrl, kind);
  if (typeof kind !== 'string' || !Object.hasOwn(BODY_LIMITS, kind)) {
    meta.error = 'host_not_allowed';
    return { meta, bytes: null };
  }
  const signal = AbortSignal.timeout(deadlineMs);
  const seen = new Set();
  let current = targetUrl;
  let redirects = 0;
  while (true) {
    if (kind === 'robots' && redirects > 0) {
      const allowed = await permit(current);
      if (!allowed?.ok) {
        meta.stop = 'permit_denied';
        meta.error = allowed?.error ?? 'permit_denied';
        meta.finalUrl = current;
        return { meta, bytes: null };
      }
    }
    if (!hostAllowed(siteHost, current, { selfHosts })) {
      meta.error = 'host_not_allowed';
      meta.finalUrl = current;
      return { meta, bytes: null };
    }
    let resolved;
    try {
      resolved = await withAbort(resolveImpl(new URL(current).hostname, { signal }), signal);
    } catch (error) {
      meta.error = isTimeout(error, signal) ? 'timeout' : 'dns_error';
      meta.finalUrl = current;
      return { meta, bytes: null };
    }
    if (!resolved?.ok) {
      meta.error = resolved?.reason === 'aborted' ? 'timeout' : resolved?.reason === 'private_address' ? 'blocked_address' : 'dns_error';
      meta.finalUrl = current;
      return { meta, bytes: null };
    }
    let response;
    try {
      response = await withAbort(fetchImpl(current, { method: 'GET', redirect: 'manual', headers: REQUEST_HEADERS, signal }), signal);
    } catch (error) {
      meta.error = isTimeout(error, signal) ? 'timeout' : 'network';
      meta.finalUrl = current;
      return { meta, bytes: null };
    }
    meta.status = response.status;
    meta.finalUrl = current;
    meta.accessBlocked = response.status === 401 || response.status === 403 || response.headers.get('cf-mitigated') === 'challenge';
    for (const name of Object.keys(meta.headers)) {
      const raw = response.headers.get(name);
      if (raw != null && raw.length > 512) {
        meta.headers[name] = raw.slice(0, 512);
        meta.truncatedHeaders = true;
      } else {
        meta.headers[name] = raw;
      }
    }
    const rawLocation = response.headers.get('location');
    let location = null;
    if (rawLocation != null) {
      try { location = new URL(rawLocation, current).href; } catch { location = null; }
    }
    meta.location = location;
    if (location && new TextEncoder().encode(location).byteLength > MAX_URL_BYTES) {
      meta.location = null;
      meta.stop = 'location_too_long';
      await cancelBody(response, signal);
      return { meta, bytes: null };
    }
    const redirect = REDIRECT_STATUSES.includes(response.status);
    if (!redirect || kind !== 'robots' || !location) {
      if (redirect) {
        meta.skipped = 'redirect';
        await cancelBody(response, signal);
        return { meta, bytes: new Uint8Array(0) };
      }
      if (kind === 'probe') {
        meta.skipped = 'probe';
        await cancelBody(response, signal);
        return { meta, bytes: new Uint8Array(0) };
      }
      const type = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if (type && !type.startsWith('text/') && !TEXT_TYPES.includes(type)) {
        meta.skipped = 'non_text';
        await cancelBody(response, signal);
        return { meta, bytes: new Uint8Array(0) };
      }
      try {
        const result = await readLimited(response, BODY_LIMITS[kind], signal);
        meta.truncated = result.truncated;
        return { meta, bytes: result.bytes };
      } catch (error) {
        meta.error = isTimeout(error, signal) ? 'timeout' : 'stream_error';
        return { meta, bytes: null };
      }
    }
    await cancelBody(response, signal);
    let next;
    try { next = new URL(location); } catch {
      meta.stop = 'bad_redirect';
      return { meta, bytes: null };
    }
    if (!hostAllowed(siteHost, next.href, { selfHosts })) {
      meta.stop = new URL(next).hostname && new URL(next).hostname.replace(/^www\./i, '').toLowerCase() !== String(siteHost).replace(/^www\./i, '').toLowerCase() ? 'offsite' : 'bad_redirect';
      return { meta, bytes: null };
    }
    if (next.pathname !== '/robots.txt' || next.search) {
      meta.stop = 'bad_redirect';
      return { meta, bytes: null };
    }
    seen.add(current);
    if (seen.has(next.href)) {
      meta.stop = 'loop';
      return { meta, bytes: null };
    }
    if (redirects >= 5) {
      meta.stop = 'max_hops';
      return { meta, bytes: null };
    }
    meta.chain.push({ url: current, status: response.status, location });
    redirects += 1;
    current = next.href;
  }
}
