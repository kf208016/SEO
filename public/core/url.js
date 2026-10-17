export const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

function uppercasePercentEncoding(value) {
  return value.replace(/%[0-9a-f]{2}/giu, (match) => match.toUpperCase());
}

function normalizePercentEncoding(url) {
  url.pathname = uppercasePercentEncoding(url.pathname);
  url.search = uppercasePercentEncoding(url.search);
  return url;
}

export function stripWww(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return host.startsWith('www.') ? host.slice(4) : host;
}

export function normalizeInputUrl(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);
    return normalizePercentEncoding(url).href;
  } catch {
    return null;
  }
}

export function cleanUrl(href, base) {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);
    return normalizePercentEncoding(url).href;
  } catch {
    return null;
  }
}

export function pathAndQuery(url) {
  const parsed = url instanceof URL ? url : new URL(url);
  return parsed.pathname + parsed.search;
}

export function isSameSite(url, siteHost) {
  try {
    const parsed = url instanceof URL ? url : new URL(url);
    return stripWww(parsed.hostname) === stripWww(siteHost);
  } catch {
    return false;
  }
}

export function stripQuery(url) {
  const parsed = url instanceof URL ? url : new URL(url);
  return parsed.origin + parsed.pathname;
}
