import { normalizeInputUrl, stripWww } from '../public/core/url.js';

const BLOCKED_SUFFIXES = [
  '.localhost', '.local', '.internal', '.lan', '.home', '.home.arpa',
  '.intranet', '.corp', '.onion', '.test', '.invalid', '.example', '.arpa',
];
const FORBIDDEN_SCHEME = /^(javascript|data|file|ftp|mailto|vbscript|blob|about|ws|wss):/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function checkTarget(input, { selfHosts = [] } = {}) {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid' };
  if (new TextEncoder().encode(input).byteLength > 2048) return { ok: false, reason: 'too_long' };
  const trimmed = input.trim();
  const explicit = trimmed.includes('://') ? trimmed.slice(0, trimmed.indexOf('://')) : null;
  if ((explicit && !/^https?$/i.test(explicit)) || (!explicit && FORBIDDEN_SCHEME.test(trimmed))) {
    return { ok: false, reason: 'scheme' };
  }
  const normalized = normalizeInputUrl(trimmed);
  if (!normalized) return { ok: false, reason: 'invalid' };
  const url = new URL(normalized);
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (url.port) return { ok: false, reason: 'port' };
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (IPV4.test(hostname) || hostname.startsWith('[')) return { ok: false, reason: 'ip_literal' };
  if (!hostname.includes('.') || hostname === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: 'blocked_host' };
  }
  const host = stripWww(hostname);
  const blocked = new Set(selfHosts.map((item) => String(item).trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
  if (blocked.has(hostname) || blocked.has(host)) return { ok: false, reason: 'self_host' };
  return { ok: true, url: normalized, host };
}

export function hostAllowed(siteHost, urlString, opts) {
  const checked = checkTarget(urlString, opts);
  return checked.ok && checked.host === stripWww(String(siteHost).toLowerCase().replace(/\.$/, ''));
}
