import { AuditGate } from './gate_do.js';
import { checkTarget } from './guard.js';
import { proxyFetch } from './proxy.js';
import { signToken, verifyToken } from './token.js';
import { BUDGETS } from './gate.js';
import { stripQuery } from '../public/core/url.js';
import { parseRobots, robotsPolicyFor, rulesFor, OUR_RULES_MAX } from '../public/core/robots.js';
import { encodeFrame } from '../public/core/frame.js';
import { VERSION } from '../public/core/version.js';

export { AuditGate };

const API_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const rejected = new Map();
const TEST_PREFIXES = ['1x0000', '2x0000', '3x0000'];
const encoder = new TextEncoder();

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fail(error, status, extra = {}) {
  return json({ error, ...extra }, status);
}

function selfHosts(requestUrl, env) {
  return [requestUrl.hostname, ...String(env.SELF_HOSTS ?? '').split(',')]
    .map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function misconfigured(env, hostname) {
  if (!env.AUDIT_GATE || !env.TURNSTILE_SECRET || !env.TURNSTILE_SITEKEY || typeof env.AUDIT_SECRET !== 'string' || env.AUDIT_SECRET.length < 32) return true;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    if (TEST_PREFIXES.some((prefix) => String(env.TURNSTILE_SECRET).startsWith(prefix) || String(env.TURNSTILE_SITEKEY).startsWith(prefix))) return true;
  }
  return false;
}

async function readPost(request, requestUrl) {
  if (request.method !== 'POST') return { response: fail('not_found', 404) };
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > 8192) return { response: fail('too_large', 413) };
  if (!request.headers.get('origin') || request.headers.get('origin') !== requestUrl.origin) return { response: fail('bad_origin', 403) };
  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); } catch { return { response: fail('bad_request', 400) }; }
  if (bytes.byteLength > 8192) return { response: fail('too_large', 413) };
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { response: fail('bad_request', 400) };
  }
}

function gateStub(env) {
  return env.AUDIT_GATE.get(env.AUDIT_GATE.idFromName('global'));
}

async function gateCall(stub, path, body) {
  const response = await stub.fetch(`https://audit-gate${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('gate_failed');
  return response.json();
}

function gateFailure(error) {
  if (error === 'unknown_audit' || error === 'expired') return fail(error, 401);
  if (error === 'host_mismatch') return fail('host_not_allowed', 403);
  if (error === 'kind_path' || error === 'bad_kind') return fail(error, 400);
  if (error === 'budget_exhausted' || error === 'too_fast' || error === 'rate_limited' || error === 'host_busy') return fail(error, 429);
  if (error === 'robots_required' || error === 'robots_disallowed') return fail(error, 403);
  if (error === 'daily_cap') return fail(error, 503);
  return fail('internal', 500);
}

async function edgeLimit(binding, key) {
  if (!binding) return true;
  try { return (await binding.limit({ key })).success !== false; } catch { return false; }
}

function cacheRejection(key, error, exp) {
  if (!['unknown_audit', 'expired', 'budget_exhausted'].includes(error)) return;
  rejected.delete(key);
  rejected.set(key, { error, exp });
  while (rejected.size > 10_000) rejected.delete(rejected.keys().next().value);
}

function cachedRejection(key, now) {
  const entry = rejected.get(key);
  if (!entry) return null;
  if (entry.exp <= now) {
    rejected.delete(key);
    return null;
  }
  return entry.error;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function turnstile(env, token, ip, hostname) {
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return data.success === true && data.action === 'audit_start' && ((hostname === 'localhost' || hostname === '127.0.0.1') || data.hostname === hostname);
  } catch {
    return false;
  }
}

async function start(request, requestUrl, env) {
  const parsed = await readPost(request, requestUrl);
  if (parsed.response) return parsed.response;
  const { url, turnstileToken } = parsed.body ?? {};
  if (typeof url !== 'string' || typeof turnstileToken !== 'string' || encoder.encode(url).byteLength > 2048 || encoder.encode(turnstileToken).byteLength > 2048) return fail('bad_request', 400);
  const checked = checkTarget(url, { selfHosts: selfHosts(requestUrl, env) });
  if (!checked.ok) return fail('invalid_url', 400, { reason: checked.reason });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await edgeLimit(env.RL_START, `ip:${ip}`)) return fail('rate_limited', 429);
  const stub = gateStub(env);
  const admitted = await gateCall(stub, '/admit', { ip, host: checked.host });
  if (!admitted.ok) return gateFailure(admitted.error);
  if (!await turnstile(env, turnstileToken, ip, requestUrl.hostname)) return fail('turnstile_failed', 403);
  const id = randomId();
  const opened = await gateCall(stub, '/open', { auditId: id, host: checked.host });
  if (!opened.ok) return gateFailure(opened.error);
  const token = await signToken({ id, exp: opened.audit.expiresAt }, env.AUDIT_SECRET);
  return json({ token, host: checked.host, url: stripQuery(checked.url), expiresAt: opened.audit.expiresAt, maxPages: 15, budgets: BUDGETS });
}

async function fetchTarget(request, requestUrl, env) {
  const parsed = await readPost(request, requestUrl);
  if (parsed.response) return parsed.response;
  const authorization = request.headers.get('authorization') ?? '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const token = await verifyToken(bearer, env.AUDIT_SECRET, Date.now());
  if (!token) return fail('bad_token', 401);
  const { u, k } = parsed.body ?? {};
  if (typeof u !== 'string' || encoder.encode(u).byteLength > 2048) return fail('bad_request', 400);
  if (typeof k !== 'string' || !Object.hasOwn(BUDGETS, k)) return fail('bad_kind', 400);
  const checked = checkTarget(u, { selfHosts: selfHosts(requestUrl, env) });
  if (!checked.ok) return fail('invalid_url', 400);
  if (!await edgeLimit(env.RL_FETCH, `a:${token.id}`)) return fail('rate_limited', 429);
  const broad = cachedRejection(token.id, Date.now());
  const narrow = cachedRejection(`${token.id}:${k}`, Date.now());
  if (broad) return gateFailure(broad);
  if (narrow) return gateFailure(narrow);
  const stub = gateStub(env);
  const consumed = await gateCall(stub, '/consume', { auditId: token.id, kind: k, url: checked.url });
  if (!consumed.ok) {
    const key = consumed.error === 'budget_exhausted' ? `${token.id}:${k}` : token.id;
    cacheRejection(key, consumed.error, token.exp);
    return gateFailure(consumed.error);
  }
  const permit = async (hopUrl) => {
    let result = await gateCall(stub, '/consume', { auditId: token.id, kind: 'robots', url: hopUrl });
    if (!result.ok && result.error === 'too_fast') {
      await new Promise((resolve) => setTimeout(resolve, 220));
      result = await gateCall(stub, '/consume', { auditId: token.id, kind: 'robots', url: hopUrl });
    }
    if (!result.ok) cacheRejection(
      result.error === 'budget_exhausted' ? `${token.id}:robots` : token.id,
      result.error,
      token.exp,
    );
    return result;
  };
  const result = await proxyFetch(checked.url, k, consumed.host, { selfHosts: selfHosts(requestUrl, env), permit });
  if (k === 'robots') {
    let policy = robotsPolicyFor(result);
    let rules = [];
    let rulesCount = 0;
    if (policy === 'parse') {
      const robots = parseRobots(new TextDecoder().decode(result.bytes), { truncated: result.meta.truncated });
      const selected = rulesFor(robots, 'kinsuiseocheck').rules;
      rulesCount = selected.length;
      if (robots.overflow || selected.length > OUR_RULES_MAX) policy = 'unknown';
      else if (!selected.length) policy = 'allow_all';
      else { policy = 'rules'; rules = selected; }
    }
    const origins = new Set([new URL(checked.url).origin, new URL(result.meta.finalUrl).origin]);
    for (const hop of result.meta.chain) {
      origins.add(new URL(hop.url).origin);
    }
    const stored = await gateCall(stub, '/storeRobots', { auditId: token.id, origins: [...origins], policy, rules });
    if (!stored.ok) return gateFailure(stored.error);
    result.meta.ourPolicy = { policy, rulesCount };
  }
  let frame;
  try { frame = encodeFrame(result.meta, result.bytes); } catch (error) {
    if (error?.message === 'metadata_too_large') return fail('metadata_too_large', 502);
    throw error;
  }
  return new Response(frame, { status: 200, headers: { ...API_HEADERS, 'Content-Type': 'application/octet-stream' } });
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (url.pathname === '/api/config' && request.method === 'GET') {
    return json({ turnstileSiteKey: env.TURNSTILE_SITEKEY ?? '', contactUrl: env.CONTACT_URL ?? '', maxPages: 15, version: VERSION });
  }
  if (url.pathname !== '/api/start' && url.pathname !== '/api/fetch') return fail('not_found', 404);
  if (misconfigured(env, url.hostname)) return fail('service_misconfigured', 503);
  if (env.AUDIT_ENABLED !== 'true') return fail('service_paused', 503);
  return url.pathname === '/api/start' ? start(request, url, env) : fetchTarget(request, url, env);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); } catch { return fail('internal', 500); }
  },
};
