// SPEC-001 §4.6 worker.js — W07 (routes), W08 (frame), R29 (Worker + DO consistency)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import * as workerModule from '../src/worker.js';
import { verifyToken, signToken } from '../src/token.js';
import { BUDGETS } from '../src/gate.js';
import { encodeFrame, decodeFrame } from '../public/core/frame.js';
import { VERSION } from '../public/core/version.js';
import { makeEnv, installFetchStub, mockClock, apiRequest, execCtx, BASE, PROD_HOST, CLIENT_IP } from './helpers/worker_env.mjs';

const dec = new TextDecoder();
const HOME_HTML = '<!doctype html><html lang="zh-Hant-TW"><head><title>A 公司</title></head><body><h1>A</h1></body></html>';

let stub = null;
let clock = null;
beforeEach(() => {
  clock = mockClock(0);
});
afterEach(() => {
  if (stub) stub.restore();
  stub = null;
  clock.restore();
});

function defaultTargets(extra = {}) {
  return {
    'https://a.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private\n', headers: { 'content-type': 'text/plain' } },
    'https://a.com/': { status: 200, body: HOME_HTML, headers: { 'content-type': 'text/html; charset=utf-8' } },
    'https://a.com/x1': { status: 200, body: 'p', headers: { 'content-type': 'text/html' } },
    'https://a.com/x2': { status: 200, body: 'p', headers: { 'content-type': 'text/html' } },
    'https://a.com/x3': { status: 200, body: 'p', headers: { 'content-type': 'text/html' } },
    'https://a.com/x4': { status: 200, body: 'p', headers: { 'content-type': 'text/html' } },
    'http://a.com/robots.txt': { status: 301, body: null, headers: { location: 'https://a.com/robots.txt' } },
    ...extra,
  };
}

async function call(env, req) {
  return worker.fetch(req, env, execCtx);
}

async function json(res) {
  return JSON.parse(await res.text());
}

async function start(env, { url = 'https://a.com/', ip = CLIENT_IP, turnstileToken = 'turnstile-ok' } = {}) {
  return call(env, apiRequest('/api/start', { body: { url, turnstileToken }, ip }));
}

async function startOk(env, opts) {
  const res = await start(env, opts);
  assert.equal(res.status, 200, 'start should succeed');
  const body = await json(res);
  const v = await verifyToken(body.token, env.AUDIT_SECRET, Date.now());
  return { ...body, id: v.id };
}

async function apiFetch(env, token, u, k) {
  clock.advance(1000); // respect MIN_INTERVAL_MS between consumes
  return call(env, apiRequest('/api/fetch', { body: { u, k }, token }));
}

async function frame(res) {
  return decodeFrame(await res.arrayBuffer());
}

// ------------------------------------------------------------------ W08
async function toArrayBuffer(x) {
  const v = await x;
  if (v instanceof ArrayBuffer) return v;
  if (ArrayBuffer.isView(v)) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  if (v instanceof Response) return v.arrayBuffer();
  throw new Error('encodeFrame returned an unsupported type');
}

test('W08 encodeFrame/decodeFrame round trip (Chinese meta, non-empty body)', async () => {
  const meta = { status: 200, finalUrl: 'https://a.com/產品', headers: { 'content-type': 'text/html' }, note: '中文說明' };
  const bytes = new TextEncoder().encode('<html>主體</html>');
  const buf = await toArrayBuffer(encodeFrame(meta, bytes));
  const view = new DataView(buf);
  const n = view.getUint32(0, false);
  assert.deepEqual(JSON.parse(dec.decode(new Uint8Array(buf, 4, n))), meta);
  assert.equal(buf.byteLength, 4 + n + bytes.length);
  const out = await decodeFrame(buf);
  assert.deepEqual(out.meta, meta);
  assert.deepEqual(new Uint8Array(out.bytes), bytes);
});

test('W08 round trip with a 0-byte body', async () => {
  const meta = { status: 301, location: 'https://a.com/新', skipped: 'redirect' };
  const buf = await toArrayBuffer(encodeFrame(meta, new Uint8Array(0)));
  const out = await decodeFrame(buf);
  assert.deepEqual(out.meta, meta);
  assert.equal(out.bytes.length, 0);
});

test('W08 length field larger than the data -> decodeFrame throws', async () => {
  const metaBytes = new TextEncoder().encode(JSON.stringify({ a: 1 }));
  const buf = new ArrayBuffer(4 + metaBytes.length);
  new DataView(buf).setUint32(0, metaBytes.length + 10, false);
  new Uint8Array(buf, 4).set(metaBytes);
  await assert.rejects(async () => decodeFrame(buf));
});

// ------------------------------------------------------------------ W07 configuration
test('W07 exports AuditGate and a default { fetch }', () => {
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof workerModule.AuditGate, 'function');
});

test('W07 missing AUDIT_GATE -> 503 service_misconfigured', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env } = makeEnv({ AUDIT_GATE: undefined });
  const res = await start(env);
  assert.equal(res.status, 503);
  assert.equal((await json(res)).error, 'service_misconfigured');
});

test('W07 AUDIT_SECRET shorter than 32 chars -> 503 (start and fetch); 32 chars is enough', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const short = makeEnv({ AUDIT_SECRET: 'x'.repeat(31) });
  const r1 = await start(short.env);
  assert.equal(r1.status, 503);
  assert.equal((await json(r1)).error, 'service_misconfigured');
  const r2 = await call(short.env, apiRequest('/api/fetch', { body: { u: 'https://a.com/robots.txt', k: 'robots' }, token: 'x.y' }));
  assert.equal(r2.status, 503);
  assert.equal(short.doCalls.length, 0);
  const ok = makeEnv({ AUDIT_SECRET: 'y'.repeat(32) });
  assert.equal((await start(ok.env)).status, 200);
});

test('W07 missing TURNSTILE_SECRET or TURNSTILE_SITEKEY -> 503 service_misconfigured', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  for (const k of ['TURNSTILE_SECRET', 'TURNSTILE_SITEKEY']) {
    const { env } = makeEnv({ [k]: undefined });
    const res = await start(env);
    assert.equal(res.status, 503, k);
    assert.equal((await json(res)).error, 'service_misconfigured', k);
  }
});

test('W07 production hostname with Turnstile test keys -> 503 service_misconfigured', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  for (const over of [
    { TURNSTILE_SITEKEY: '1x00000000000000000000AA' },
    { TURNSTILE_SITEKEY: '3x00000000000000000000FF' },
    { TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' },
    { TURNSTILE_SECRET: '2x0000000000000000000000000000000AA' },
  ]) {
    const { env, doCalls } = makeEnv(over);
    const res = await start(env);
    assert.equal(res.status, 503, JSON.stringify(over));
    assert.equal((await json(res)).error, 'service_misconfigured');
    assert.equal(doCalls.length, 0);
  }
});

test('W07 test keys are accepted on localhost (hostname check of siteverify skipped)', async () => {
  stub = installFetchStub({ targets: defaultTargets(), siteverify: () => ({ success: true, action: 'audit_start', hostname: 'example.com' }) });
  const { env } = makeEnv({ TURNSTILE_SITEKEY: '1x00000000000000000000AA', TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' });
  const base = 'http://localhost:8787';
  const res = await call(env, apiRequest('/api/start', { base, origin: base, body: { url: 'https://a.com/', turnstileToken: 't' } }));
  assert.equal(res.status, 200);
});

test('W07 AUDIT_ENABLED "false" -> 503 service_paused', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env } = makeEnv({ AUDIT_ENABLED: 'false' });
  const res = await start(env);
  assert.equal(res.status, 503);
  assert.equal((await json(res)).error, 'service_paused');
  const { env: env2 } = makeEnv({ AUDIT_ENABLED: undefined });
  assert.equal((await json(await start(env2))).error, 'service_paused');
});

test('W07 GET /api/config works without configuration checks', async () => {
  const { env } = makeEnv({ AUDIT_ENABLED: 'false' });
  const res = await call(env, apiRequest('/api/config', { method: 'GET' }));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.turnstileSiteKey, env.TURNSTILE_SITEKEY);
  assert.equal(body.contactUrl, env.CONTACT_URL);
  assert.equal(body.maxPages, 15);
  assert.equal(body.version, VERSION);
  assert.equal(VERSION, '1.5.0');
});

// ------------------------------------------------------------------ W07 POST common checks
test('W07 Origin missing or different -> 403 bad_origin', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, doCalls } = makeEnv();
  for (const origin of [null, 'https://evil.com', 'http://' + PROD_HOST]) {
    const res = await call(env, apiRequest('/api/start', { origin, body: { url: 'https://a.com/', turnstileToken: 't' } }));
    assert.equal(res.status, 403, String(origin));
    assert.equal((await json(res)).error, 'bad_origin');
  }
  assert.equal(doCalls.length, 0);
});

test('W07 body of 9,000 bytes -> 413 too_large', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env } = makeEnv();
  const body = JSON.stringify({ url: 'https://a.com/' + 'a'.repeat(8960), turnstileToken: 't' });
  assert.ok(body.length >= 9000);
  const res = await call(env, apiRequest('/api/start', { body }));
  assert.equal(res.status, 413);
  assert.equal((await json(res)).error, 'too_large');
});

test('W07 bad JSON / wrong field types -> 400 bad_request', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env } = makeEnv();
  const r1 = await call(env, apiRequest('/api/start', { body: '{not json' }));
  assert.equal(r1.status, 400);
  assert.equal((await json(r1)).error, 'bad_request');
  const r2 = await call(env, apiRequest('/api/start', { body: { url: 123, turnstileToken: 't' } }));
  assert.equal(r2.status, 400);
  assert.equal((await json(r2)).error, 'bad_request');
  const r3 = await call(env, apiRequest('/api/start', { body: { url: 'https://a.com/', turnstileToken: 'x'.repeat(2049) } }));
  assert.equal(r3.status, 400);
});

// ------------------------------------------------------------------ W07 /api/start
test('W07 invalid target URL -> 400 invalid_url with reason, before any DO call', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, doCalls } = makeEnv();
  const r1 = await start(env, { url: 'http://localhost/' });
  assert.equal(r1.status, 400);
  const b1 = await json(r1);
  assert.equal(b1.error, 'invalid_url');
  assert.equal(b1.reason, 'blocked_host');
  const r2 = await start(env, { url: BASE + '/' });
  assert.equal((await json(r2)).reason, 'self_host');
  const r3 = await start(env, { url: 'https://seo-alt.kinsui-check.com/' });
  assert.equal((await json(r3)).reason, 'self_host');
  assert.equal(doCalls.length, 0);
  assert.equal(stub.verifyCalls.length, 0);
});

test('W07 admit rate-limited -> 429 rate_limited (failed Turnstile attempts count)', async () => {
  stub = installFetchStub({ targets: defaultTargets(), siteverify: () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });
  const { env } = makeEnv();
  for (let i = 0; i < 6; i++) {
    const res = await start(env);
    assert.equal(res.status, 403, `attempt ${i + 1}`);
    assert.equal((await json(res)).error, 'turnstile_failed');
  }
  const res = await start(env);
  assert.equal(res.status, 429);
  assert.equal((await json(res)).error, 'rate_limited');
});

test('W07 4th concurrent audit for the same site -> 429 host_busy; daily cap -> 503 daily_cap', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env } = makeEnv();
  for (let i = 0; i < 3; i++) assert.equal((await start(env, { ip: `9.0.0.${i}` })).status, 200);
  const busy = await start(env, { ip: '9.0.0.9' });
  assert.equal(busy.status, 429);
  assert.equal((await json(busy)).error, 'host_busy');
  const capped = makeEnv({ DAILY_AUDIT_CAP: '1' });
  assert.equal((await start(capped.env, { ip: '9.1.0.1' })).status, 200);
  const r = await start(capped.env, { url: 'https://b.com/', ip: '9.1.0.2' });
  assert.equal(r.status, 503);
  assert.equal((await json(r)).error, 'daily_cap');
});

test('W07 siteverify success false / wrong action / wrong hostname -> 403 turnstile_failed', async () => {
  for (const sv of [
    { success: false },
    { success: true, action: 'other_action', hostname: PROD_HOST },
    { success: true, action: 'audit_start', hostname: 'evil.example.org' },
    { success: 'true', action: 'audit_start', hostname: PROD_HOST },
  ]) {
    stub = installFetchStub({ targets: defaultTargets(), siteverify: () => sv });
    const { env } = makeEnv();
    const res = await start(env);
    assert.equal(res.status, 403, JSON.stringify(sv));
    assert.equal((await json(res)).error, 'turnstile_failed');
    stub.restore();
    stub = null;
  }
});

test('W07 successful start -> 200, token verifies, DO audit created, siteverify form fields', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, storage, idNames } = makeEnv();
  const res = await start(env, { url: 'https://www.a.com/blog?utm=1', turnstileToken: 'tt-123' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const body = await json(res);
  assert.equal(body.host, 'a.com');
  assert.equal(body.url, 'https://www.a.com/blog');
  assert.equal(body.maxPages, 15);
  assert.deepEqual(body.budgets, BUDGETS);
  assert.equal(typeof body.expiresAt, 'number');
  const v = await verifyToken(body.token, env.AUDIT_SECRET, Date.now());
  assert.ok(v, 'token must verify');
  assert.match(v.id, /^[0-9a-f]{32}$/);
  assert.equal(v.exp, body.expiresAt);
  const rec = storage.peek('a:' + v.id);
  assert.ok(rec, 'DO audit record exists');
  assert.equal(rec.host, 'a.com');
  assert.equal(rec.expiresAt, body.expiresAt);
  assert.ok(idNames.every((n) => n === 'global') && idNames.length > 0);
  assert.equal(stub.verifyCalls.length, 1);
  assert.equal(stub.verifyCalls[0].secret, env.TURNSTILE_SECRET);
  assert.equal(stub.verifyCalls[0].response, 'tt-123');
  assert.equal(stub.verifyCalls[0].remoteip, CLIENT_IP);
});

test('W07 RL_START binding refusing -> 429 rate_limited without calling the DO', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const keys = [];
  const { env, doCalls } = makeEnv({ RL_START: { limit: async ({ key }) => (keys.push(key), { success: false }) } });
  const res = await start(env);
  assert.equal(res.status, 429);
  assert.equal((await json(res)).error, 'rate_limited');
  assert.deepEqual(keys, ['ip:' + CLIENT_IP]);
  assert.equal(doCalls.length, 0);
});

// ------------------------------------------------------------------ W07 /api/fetch
test('W07 /api/fetch without token or with forged token -> 401 bad_token and NO DO call', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, doCalls } = makeEnv();
  const r0 = await call(env, apiRequest('/api/fetch', { body: { u: 'https://a.com/robots.txt', k: 'robots' } }));
  assert.equal(r0.status, 401);
  assert.equal((await json(r0)).error, 'bad_token');
  const forged = await signToken({ id: 'a'.repeat(32), exp: Date.now() + 60_000 }, 'another-secret-0123456789abcdef0123456789');
  const r1 = await call(env, apiRequest('/api/fetch', { body: { u: 'https://a.com/robots.txt', k: 'robots' }, token: forged }));
  assert.equal(r1.status, 401);
  assert.equal((await json(r1)).error, 'bad_token');
  const r2 = await call(env, apiRequest('/api/fetch', { body: { u: 'https://a.com/robots.txt', k: 'robots' }, token: 'garbage' }));
  assert.equal(r2.status, 401);
  assert.equal(doCalls.length, 0);
});

test('W07 /api/fetch: wrong kind -> 400 bad_kind; bad u -> 400 (no DO call)', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, doCalls } = makeEnv();
  const s = await startOk(env);
  const before = doCalls.length;
  const r1 = await apiFetch(env, s.token, 'https://a.com/', 'video');
  assert.equal(r1.status, 400);
  assert.equal((await json(r1)).error, 'bad_kind');
  const r2 = await apiFetch(env, s.token, 'https://a.com/' + 'a'.repeat(2100), 'page');
  assert.equal(r2.status, 400);
  assert.equal((await json(r2)).error, 'bad_request');
  const r3 = await apiFetch(env, s.token, 'javascript:alert(1)', 'page');
  assert.equal(r3.status, 400);
  assert.equal((await json(r3)).error, 'invalid_url');
  assert.equal(doCalls.length, before);
});

test('W07 /api/fetch for another site -> 403 host_not_allowed', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env } = makeEnv();
  const s = await startOk(env);
  const res = await apiFetch(env, s.token, 'https://b.com/robots.txt', 'robots');
  assert.equal(res.status, 403);
  assert.equal((await json(res)).error, 'host_not_allowed');
});

test('W07 page before robots -> 403 robots_required', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env } = makeEnv();
  const s = await startOk(env);
  const res = await apiFetch(env, s.token, 'https://a.com/', 'page');
  assert.equal(res.status, 403);
  assert.equal((await json(res)).error, 'robots_required');
  assert.equal(stub.targetCalls().length, 0, 'target must not be fetched');
});

test('W07 robots request stores rules in the DO and meta.ourPolicy matches; page then framed', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, storage } = makeEnv();
  const s = await startOk(env);
  const res = await apiFetch(env, s.token, 'https://a.com/robots.txt', 'robots');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { meta, bytes } = await frame(res);
  assert.equal(meta.status, 200);
  assert.equal(dec.decode(bytes), 'User-agent: *\nDisallow: /private\n');
  assert.deepEqual(meta.ourPolicy, { policy: 'rules', rulesCount: 1 });
  const stored = storage.peek(`r:${s.id}:https://a.com`);
  assert.ok(stored, 'DO r: record for https://a.com');
  assert.equal(stored.policy, meta.ourPolicy.policy);
  assert.equal(stored.rules.length, meta.ourPolicy.rulesCount);
  // A1 (v1.5): DO rules are { allow, path } objects
  assert.deepEqual(stored.rules, [{ allow: false, path: '/private' }]);
  assert.deepEqual(meta.chain, []);
  assert.equal(storage.peek('a:' + s.id).used.robots, 1);

  const denied = await apiFetch(env, s.token, 'https://a.com/private', 'page');
  assert.equal(denied.status, 403);
  assert.equal((await json(denied)).error, 'robots_disallowed');

  const page = await apiFetch(env, s.token, 'https://a.com/', 'page');
  assert.equal(page.status, 200);
  const pf = await frame(page);
  assert.equal(pf.meta.status, 200);
  assert.equal(pf.meta.finalUrl, 'https://a.com/');
  assert.equal(pf.meta.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(dec.decode(pf.bytes), HOME_HTML);
  // the target request carried no visitor headers
  const t = stub.targetCalls().find((c) => c.url === 'https://a.com/');
  const h = new Headers(t.init.headers || (t.input instanceof Request ? t.input.headers : undefined));
  assert.equal(h.get('cookie'), null);
  assert.equal(h.get('authorization'), null);
  assert.equal(h.get('cf-connecting-ip'), null);
  assert.equal(h.get('origin'), null);
});

test('W07 robots 301 http://a.com -> https://a.com: both origins stored with the same policy, robots used 2', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, storage } = makeEnv();
  const s = await startOk(env);
  const res = await apiFetch(env, s.token, 'http://a.com/robots.txt', 'robots');
  assert.equal(res.status, 200);
  const { meta } = await frame(res);
  assert.equal(meta.status, 200);
  assert.equal(meta.finalUrl, 'https://a.com/robots.txt');
  assert.equal(meta.chain[0].url, 'http://a.com/robots.txt');
  assert.equal(meta.chain.length, 1, 'A7: only the followed 3xx hop');
  const http = storage.peek(`r:${s.id}:http://a.com`);
  const https = storage.peek(`r:${s.id}:https://a.com`);
  assert.ok(http && https);
  assert.equal(http.policy, 'rules');
  assert.deepEqual(http, https);
  assert.equal(storage.peek('a:' + s.id).used.robots, 2);
  assert.equal(meta.ourPolicy.policy, 'rules');
});

test('W07 robots 404 -> ourPolicy allow_all stored', async () => {
  stub = installFetchStub({ targets: defaultTargets({ 'https://a.com/robots.txt': { status: 404, body: 'nf', headers: { 'content-type': 'text/html' } } }) });
  const { env, storage } = makeEnv();
  const s = await startOk(env);
  const { meta } = await frame(await apiFetch(env, s.token, 'https://a.com/robots.txt', 'robots'));
  assert.equal(meta.ourPolicy.policy, 'allow_all');
  assert.equal(storage.peek(`r:${s.id}:https://a.com`).policy, 'allow_all');
});

test('W07 budget_exhausted is cached per token+kind: next same-kind request answered without the DO', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, doCalls } = makeEnv();
  const s = await startOk(env);
  assert.equal((await apiFetch(env, s.token, 'https://a.com/robots.txt', 'robots')).status, 200);
  assert.equal((await apiFetch(env, s.token, 'https://a.com/x1', 'probe')).status, 200);
  assert.equal((await apiFetch(env, s.token, 'https://a.com/x2', 'probe')).status, 200);
  const r3 = await apiFetch(env, s.token, 'https://a.com/x3', 'probe');
  assert.equal(r3.status, 429);
  assert.equal((await json(r3)).error, 'budget_exhausted');
  const n = doCalls.length;
  const r4 = await apiFetch(env, s.token, 'https://a.com/x4', 'probe');
  assert.equal(r4.status, 429);
  assert.equal((await json(r4)).error, 'budget_exhausted');
  assert.equal(doCalls.length, n, 'DO must not be called again');
  // other kinds are not cached
  const p = await apiFetch(env, s.token, 'https://a.com/', 'page');
  assert.equal(p.status, 200);
  assert.ok(doCalls.length > n);
});

test('W07 unknown_audit is cached per token: second request answered 401 without the DO', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const { env, doCalls } = makeEnv();
  const token = await signToken({ id: 'b'.repeat(32), exp: Date.now() + 120_000 }, env.AUDIT_SECRET);
  const r1 = await apiFetch(env, token, 'https://a.com/robots.txt', 'robots');
  assert.equal(r1.status, 401);
  const n = doCalls.length;
  assert.ok(n >= 1);
  const r2 = await apiFetch(env, token, 'https://a.com/robots.txt', 'robots');
  assert.equal(r2.status, 401);
  assert.equal(doCalls.length, n);
});

test('W07 RL_FETCH binding refusing -> 429 rate_limited keyed by audit id', async () => {
  stub = installFetchStub({ targets: defaultTargets() });
  const keys = [];
  const { env } = makeEnv({ RL_FETCH: { limit: async ({ key }) => (keys.push(key), { success: false }) } });
  const s = await startOk(env);
  const res = await apiFetch(env, s.token, 'https://a.com/robots.txt', 'robots');
  assert.equal(res.status, 429);
  assert.equal((await json(res)).error, 'rate_limited');
  assert.deepEqual(keys, ['a:' + s.id]);
});

test('W07 other /api/* -> 404 not_found; other paths -> ASSETS', async () => {
  const { env } = makeEnv();
  const r = await call(env, apiRequest('/api/x', { method: 'GET' }));
  assert.equal(r.status, 404);
  assert.equal((await json(r)).error, 'not_found');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const a = await call(env, apiRequest('/index.html', { method: 'GET' }));
  assert.equal(await a.text(), 'ASSET:/index.html');
});

// ------------------------------------------------------------------ R29 Worker + DO
test('R29 our group with 1,001 rules: Worker ourPolicy unknown, DO stores unknown and refuses pages', async () => {
  const robots = ['User-agent: KinsuiSEOCheck', ...Array.from({ length: 1001 }, (_, i) => `Disallow: /r${i}`)].join('\n');
  stub = installFetchStub({ targets: defaultTargets({ 'https://a.com/robots.txt': { status: 200, body: robots, headers: { 'content-type': 'text/plain' } } }) });
  const { env, storage } = makeEnv();
  const s = await startOk(env);
  const { meta } = await frame(await apiFetch(env, s.token, 'https://a.com/robots.txt', 'robots'));
  assert.equal(meta.ourPolicy.policy, 'unknown');
  assert.equal(storage.peek(`r:${s.id}:https://a.com`).policy, 'unknown');
  const res = await apiFetch(env, s.token, 'https://a.com/', 'page');
  assert.equal(res.status, 403);
  assert.equal((await json(res)).error, 'robots_disallowed');
});

// ------------------------------------------------------------------ v1.5 A2: Turnstile testing keys on localhost
const LOCAL_BASES = ['http://localhost:8787', 'http://127.0.0.1:8787'];
const TEST_KEYS = { TURNSTILE_SITEKEY: '1x00000000000000000000AA', TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' };
// what the official testing keys return: no action, hostname example.com
const TESTKEY_SV = { success: true, hostname: 'example.com', 'error-codes': [], metadata: { result_with_testing_key: true } };

async function startAt(env, base) {
  return call(env, apiRequest('/api/start', { base, origin: base, body: { url: 'https://a.com/', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' } }));
}
async function startOkAt(env, base) {
  const res = await startAt(env, base);
  assert.equal(res.status, 200, 'start should succeed on ' + base);
  const body = await json(res);
  const v = await verifyToken(body.token, env.AUDIT_SECRET, Date.now());
  return { ...body, id: v.id };
}
async function fetchAt(env, base, token, u, k) {
  clock.advance(1000);
  return call(env, apiRequest('/api/fetch', { base, origin: base, body: { u, k }, token }));
}

test('A2 localhost / 127.0.0.1: testing-key siteverify response (no action, hostname example.com) passes', async () => {
  for (const base of LOCAL_BASES) {
    stub = installFetchStub({ targets: defaultTargets(), siteverify: () => TESTKEY_SV });
    const { env } = makeEnv(TEST_KEYS);
    const res = await startAt(env, base);
    assert.equal(res.status, 200, base);
    stub.restore();
    stub = null;
  }
});

test('A2 the same testing-key response on a production hostname fails (real-looking keys)', async () => {
  stub = installFetchStub({ targets: defaultTargets(), siteverify: () => TESTKEY_SV });
  const { env } = makeEnv();
  const res = await start(env);
  assert.equal(res.status, 403);
  assert.equal((await json(res)).error, 'turnstile_failed');
});

test('A2 on localhost without result_with_testing_key the action is still required; success false still fails', async () => {
  for (const sv of [
    { success: true, hostname: 'localhost' },
    { success: true, hostname: 'example.com', metadata: { result_with_testing_key: false } },
    { success: true, action: 'other_action', hostname: 'localhost', metadata: {} },
    { success: false, hostname: 'example.com', metadata: { result_with_testing_key: true } },
  ]) {
    stub = installFetchStub({ targets: defaultTargets(), siteverify: () => sv });
    const { env } = makeEnv(TEST_KEYS);
    const res = await startAt(env, 'http://localhost:8787');
    assert.equal(res.status, 403, JSON.stringify(sv));
    assert.equal((await json(res)).error, 'turnstile_failed');
    stub.restore();
    stub = null;
  }
});

// ------------------------------------------------------------------ v1.5 A3: DEV_SKIP_DNS_PRECHECK only on localhost
const PRIVATE_DNS = (name, type) => (type === 'A' ? { Status: 0, Answer: [{ name, type: 1, TTL: 60, data: '10.0.0.1' }] } : { Status: 0 });
const dohCalls = () => stub.log.filter((l) => new URL(l.url).hostname === 'cloudflare-dns.com').length;

test('A3 DEV_SKIP_DNS_PRECHECK=true on localhost skips the DoH pre-check', async () => {
  for (const base of LOCAL_BASES) {
    stub = installFetchStub({ targets: defaultTargets(), siteverify: () => TESTKEY_SV, dns: PRIVATE_DNS });
    const { env } = makeEnv({ ...TEST_KEYS, DEV_SKIP_DNS_PRECHECK: 'true' });
    const s = await startOkAt(env, base);
    const res = await fetchAt(env, base, s.token, 'https://a.com/robots.txt', 'robots');
    assert.equal(res.status, 200, base);
    const { meta } = await frame(res);
    assert.equal(meta.error, null, base);
    assert.equal(meta.status, 200, base);
    assert.equal(dohCalls(), 0, base + ': no DoH query');
    assert.ok(stub.targetCalls().some((c) => c.url === 'https://a.com/robots.txt'), base);
    stub.restore();
    stub = null;
  }
});

test('A3 DEV_SKIP_DNS_PRECHECK=true is ignored on a non-localhost hostname (DoH used, private address blocked)', async () => {
  stub = installFetchStub({ targets: defaultTargets(), dns: PRIVATE_DNS });
  const { env } = makeEnv({ DEV_SKIP_DNS_PRECHECK: 'true' });
  const s = await startOk(env);
  const res = await apiFetch(env, s.token, 'https://a.com/robots.txt', 'robots');
  assert.equal(res.status, 200);
  const { meta } = await frame(res);
  assert.equal(meta.error, 'blocked_address');
  assert.ok(dohCalls() > 0, 'DoH must be queried');
  assert.ok(!stub.targetCalls().some((c) => c.url === 'https://a.com/robots.txt'), 'target must not be fetched');
});

test('A3 localhost without DEV_SKIP_DNS_PRECHECK still pre-checks DNS', async () => {
  stub = installFetchStub({ targets: defaultTargets(), siteverify: () => TESTKEY_SV, dns: PRIVATE_DNS });
  const { env } = makeEnv({ ...TEST_KEYS, DEV_SKIP_DNS_PRECHECK: 'false' });
  const base = 'http://localhost:8787';
  const s = await startOkAt(env, base);
  const { meta } = await frame(await fetchAt(env, base, s.token, 'https://a.com/robots.txt', 'robots'));
  assert.equal(meta.error, 'blocked_address');
  assert.ok(dohCalls() > 0);
});

// ------------------------------------------------------------------ mutation gap WK06
test('WK06 robots 2-hop internal redirect http://www.a.com -> http://a.com -> https://a.com: policy stored for all three origins', async () => {
  stub = installFetchStub({
    targets: defaultTargets({ 'http://www.a.com/robots.txt': { status: 301, body: null, headers: { location: 'http://a.com/robots.txt' } } }),
  });
  const { env, storage } = makeEnv();
  const s = await startOk(env);
  const res = await apiFetch(env, s.token, 'http://www.a.com/robots.txt', 'robots');
  assert.equal(res.status, 200);
  const { meta } = await frame(res);
  assert.equal(meta.status, 200);
  assert.equal(meta.finalUrl, 'https://a.com/robots.txt');
  assert.deepEqual(meta.chain.map((c) => c.url), ['http://www.a.com/robots.txt', 'http://a.com/robots.txt']);
  for (const origin of ['http://www.a.com', 'http://a.com', 'https://a.com']) {
    const rec = storage.peek(`r:${s.id}:${origin}`);
    assert.ok(rec, 'stored for ' + origin);
    assert.equal(rec.policy, 'rules', origin);
    assert.deepEqual(rec.rules, [{ allow: false, path: '/private' }], origin);
  }
  assert.equal(storage.peek('a:' + s.id).used.robots, 3);
});
