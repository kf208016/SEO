// Fake Worker environment: env bindings, AUDIT_GATE namespace backed by a real AuditGate + FakeStorage,
// a global fetch stub (Turnstile siteverify, DoH, target sites) and a controllable Date.now.
import { AuditGate } from '../../src/gate_do.js';
import { FakeStorage, makeCtx } from './fakestorage.mjs';

export const PROD_HOST = 'seo-geo-check.kinsui.workers.dev';
export const BASE = 'https://' + PROD_HOST;
export const CLIENT_IP = '1.2.3.4';
export const GOOD_SECRET = 'prod-audit-secret-0123456789abcdef0123456789';

export function toRequest(input, init) {
  if (input instanceof Request) return init ? new Request(input, init) : input;
  let url = input instanceof URL ? input.href : String(input);
  if (url.startsWith('/')) url = 'https://audit-gate.internal' + url;
  return new Request(url, init);
}

// env factory. `over` keys with value undefined remove the binding.
export function makeEnv(over = {}) {
  const storage = new FakeStorage();
  const ctx = makeCtx(storage);
  const doCalls = [];
  const idNames = [];
  const env = {
    ASSETS: {
      fetch: async (req) => {
        const r = toRequest(req);
        return new Response('ASSET:' + new URL(r.url).pathname, { status: 200, headers: { 'content-type': 'text/plain' } });
      },
    },
    TURNSTILE_SECRET: '0x4AAAAAAAprodTurnstileSecretValue000000',
    TURNSTILE_SITEKEY: '0x4AAAAAAAprodSiteKey00',
    AUDIT_SECRET: GOOD_SECRET,
    AUDIT_ENABLED: 'true',
    CONTACT_URL: 'https://line.me/R/ti/p/@kinsui-example',
    DAILY_AUDIT_CAP: '1000',
    SELF_HOSTS: 'seo-alt.kinsui-check.com',
  };
  const holder = { gate: null };
  env.AUDIT_GATE = {
    idFromName(name) {
      idNames.push(name);
      return { name, toString: () => 'do-id-' + name };
    },
    get(id) {
      return {
        id,
        fetch: async (input, init) => {
          const req = toRequest(input, init);
          let body = '';
          try {
            body = await req.clone().text();
          } catch {}
          doCalls.push({ path: new URL(req.url).pathname, body });
          return holder.gate.fetch(req);
        },
      };
    },
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  holder.gate = new AuditGate(ctx, env);
  return {
    env,
    storage,
    ctx,
    doCalls,
    idNames,
    get gate() {
      return holder.gate;
    },
    recreateGate() {
      holder.gate = new AuditGate(ctx, env);
      return holder.gate;
    },
  };
}

export const execCtx = { waitUntil() {}, passThroughOnException() {} };

function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
}

async function readForm(input, init) {
  try {
    const req = toRequest(input, init);
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('json')) return await req.json();
    const fd = await req.formData();
    const o = {};
    for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v : String(v);
    return o;
  } catch {
    try {
      const t = typeof init?.body === 'string' ? init.body : '';
      return Object.fromEntries(new URLSearchParams(t));
    } catch {
      return {};
    }
  }
}

// Installs a global fetch stub.
//  siteverify(form) -> JSON object returned by Turnstile
//  dns(name, type)  -> DoH JSON (default: a public A record, no AAAA)
//  targets: { [url]: spec | (url, init) => Response|spec }, spec = { status, body, headers }
export function installFetchStub({ siteverify, dns, targets = {} } = {}) {
  const orig = globalThis.fetch;
  const log = [];
  const verifyCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url);
    log.push({ url, init, input });
    if (u.hostname === 'challenges.cloudflare.com') {
      const form = await readForm(input, init);
      verifyCalls.push(form);
      const out = siteverify
        ? siteverify(form)
        : { success: true, action: 'audit_start', hostname: PROD_HOST, 'error-codes': [] };
      return jsonResponse(out);
    }
    if (u.hostname === 'cloudflare-dns.com') {
      const name = u.searchParams.get('name');
      const type = u.searchParams.get('type');
      const out = dns
        ? dns(name, type)
        : type === 'A'
          ? { Status: 0, Answer: [{ name, type: 1, TTL: 60, data: '93.184.216.34' }] }
          : { Status: 0 };
      return jsonResponse(out, 200, { 'content-type': 'application/dns-json' });
    }
    const key = Object.prototype.hasOwnProperty.call(targets, url) ? url : null;
    if (key === null) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    let spec = targets[key];
    if (typeof spec === 'function') spec = spec(url, init);
    if (spec instanceof Response) return spec;
    const body = spec.body === undefined ? null : spec.body;
    return new Response(body, { status: spec.status ?? 200, headers: spec.headers || {} });
  };
  return {
    log,
    verifyCalls,
    targetCalls: () => log.filter((l) => !['challenges.cloudflare.com', 'cloudflare-dns.com'].includes(new URL(l.url).hostname)),
    restore() {
      globalThis.fetch = orig;
    },
  };
}

// Date.now that follows real time plus a manual offset (so real waits, e.g. the 220 ms permit retry,
// still advance the clock).
export function mockClock(offsetMs = 0) {
  const realNow = Date.now;
  let offset = offsetMs;
  Date.now = () => realNow() + offset;
  return {
    advance(ms) {
      offset += ms;
    },
    restore() {
      Date.now = realNow;
    },
  };
}

// Fixed Date.now (does not follow real time).
export function fixedClock(ms) {
  const realNow = Date.now;
  let t = ms;
  Date.now = () => t;
  return {
    set(v) {
      t = v;
    },
    advance(d) {
      t += d;
    },
    restore() {
      Date.now = realNow;
    },
  };
}

export function apiRequest(path, { method = 'POST', body, origin = BASE, token, ip = CLIENT_IP, base = BASE, headers = {} } = {}) {
  const h = { ...headers };
  if (origin !== null) h.origin = origin;
  if (ip !== null) h['cf-connecting-ip'] = ip;
  if (token) h.authorization = 'Bearer ' + token;
  if (body !== undefined && !('content-type' in h)) h['content-type'] = 'application/json';
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(base + path, init);
}
