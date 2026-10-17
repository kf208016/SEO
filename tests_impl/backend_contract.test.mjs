import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runAudit } from '../public/core/crawl.js';
import { decodeFrame } from '../public/core/frame.js';
import {
  OUR_RULES_MAX,
  explain,
  parseRobots,
  rulesFor,
} from '../public/core/robots.js';
import { isPublicIPv4, isPublicIPv6, resolvePublic } from '../src/dns.js';
import { AUDIT_TTL_MS, BUDGETS, GateCore } from '../src/gate.js';
import { AuditGate } from '../src/gate_do.js';
import { BODY_LIMITS, MAX_URL_BYTES, proxyFetch } from '../src/proxy.js';
import { signToken, verifyToken } from '../src/token.js';
import worker from '../src/worker.js';

const encoder = new TextEncoder();
const publicDns = async () => ({ ok: true, addresses: ['8.8.8.8'] });

class AtomicStorage {
  constructor(entries = []) {
    this.map = new Map(entries.map(([key, value]) => [key, structuredClone(value)]));
    this.alarm = null;
    this.failNextPut = false;
  }

  async get(key) {
    if (Array.isArray(key)) {
      return new Map(key.filter((item) => this.map.has(item)).map((item) => [item, structuredClone(this.map.get(item))]));
    }
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined;
  }

  async put(value, singleValue) {
    const writes = typeof value === 'string' ? { [value]: singleValue } : value;
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('injected_put_failure');
    }
    const next = new Map(this.map);
    for (const [key, item] of Object.entries(writes)) next.set(key, structuredClone(item));
    this.map = next;
  }

  async delete(keys) {
    const next = new Map(this.map);
    for (const key of Array.isArray(keys) ? keys : [keys]) next.delete(key);
    this.map = next;
  }

  async list({ prefix, limit } = {}) {
    const entries = [...this.map]
      .filter(([key]) => !prefix || key.startsWith(prefix))
      .slice(0, limit ?? Infinity)
      .map(([key, value]) => [key, structuredClone(value)]);
    return new Map(entries);
  }

  async getAlarm() { return this.alarm; }
  async setAlarm(value) { this.alarm = value; }
}

function mapSnapshot(storage) {
  return structuredClone([...storage.map.entries()]);
}

function ipv4ToNumber(ip) {
  return ip.split('.').reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
}

function numberToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function ipv6ToBigInt(ip) {
  const [leftSource, rightSource = null] = ip.split('::');
  const left = leftSource ? leftSource.split(':') : [];
  const right = rightSource ? rightSource.split(':') : [];
  const fill = rightSource === null ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right]
    .reduce((value, word) => (value << 16n) | BigInt(Number.parseInt(word || '0', 16)), 0n);
}

function bigIntToIpv6(value) {
  const words = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) words.push(((value >> shift) & 0xffffn).toString(16));
  return words.join(':');
}

function cidrBoundary(cidr) {
  const [base, rawBits] = cidr.split('/');
  const bits = Number(rawBits);
  if (base.includes(':')) {
    const start = ipv6ToBigInt(base);
    const end = start + ((1n << BigInt(128 - bits)) - 1n);
    return [bigIntToIpv6(start), bigIntToIpv6(end)];
  }
  const start = ipv4ToNumber(base);
  const end = start + (2 ** (32 - bits)) - 1;
  return [numberToIpv4(start), numberToIpv4(end)];
}

function dnsJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/dns-json' } });
}

function proxyResponse(body = '', init = {}) {
  return new Response(body, init);
}

async function withGlobalFetch(fetchImpl, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

function makeBinding(gateOrHandler, calls = []) {
  return {
    idFromName(name) {
      assert.equal(name, 'global');
      return 'global-id';
    },
    get(id) {
      assert.equal(id, 'global-id');
      return {
        async fetch(input, init) {
          const url = String(input);
          calls.push(new URL(url).pathname);
          if (typeof gateOrHandler === 'function') return gateOrHandler(url, init);
          return gateOrHandler.fetch(new Request(url, init));
        },
      };
    },
  };
}

function configuredEnv(overrides = {}) {
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    AUDIT_GATE: overrides.AUDIT_GATE,
    TURNSTILE_SITEKEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    AUDIT_SECRET: 's'.repeat(40),
    AUDIT_ENABLED: 'true',
    SELF_HOSTS: '',
    DAILY_AUDIT_CAP: '1000',
    ...overrides,
  };
}

function apiRequest(path, body, { origin = 'http://localhost', token, hostname = 'localhost' } = {}) {
  const headers = new Headers({ origin, 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`http://${hostname}${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function publicNetwork(targetHandler) {
  return async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/dns-query')) {
      const type = new URL(url).searchParams.get('type');
      return dnsJson(type === 'A'
        ? { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }
        : { Status: 0, Answer: [] });
    }
    return targetHandler(url, init);
  };
}

async function seedAudit(storage, id, host = 'a.com', overrides = {}) {
  const now = Date.now();
  await storage.put(`a:${id}`, {
    host,
    expiresAt: now + 60_000,
    used: { robots: 0, sitemap: 0, page: 0, probe: 0 },
    lastAt: null,
    ...overrides,
  });
  return now;
}

test('W03 所有 IPv4 與 IPv6 保守範圍的起點、終點都不公開', () => {
  const ipv4Cidrs = [
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
    '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
    '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16',
    '192.175.48.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
    '224.0.0.0/4', '240.0.0.0/4',
  ];
  const ipv6Cidrs = [
    '::/128', '::1/128', '::/96', '::ffff:0:0/96', '64:ff9b::/96',
    '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32',
    '2002::/16', '3fff::/20', '5f00::/16', 'fc00::/7', 'fe80::/10',
    'fec0::/10', 'ff00::/8',
  ];
  for (const cidr of ipv4Cidrs) {
    for (const address of cidrBoundary(cidr)) assert.equal(isPublicIPv4(address), false, `${cidr}: ${address}`);
  }
  for (const cidr of ipv6Cidrs) {
    for (const address of cidrBoundary(cidr)) assert.equal(isPublicIPv6(address), false, `${cidr}: ${address}`);
  }
  assert.equal(isPublicIPv4('8.8.8.8'), true);
  assert.equal(isPublicIPv6('2606:4700::1111'), true);
  assert.equal(isPublicIPv6('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIPv6('2002:c0a8:0101::1'), false);
});

test('W03 resolvePublic 完整區分公開、私有、NXDOMAIN、空答案與 DNS 錯誤', async () => {
  const calls = [];
  const publicResult = await resolvePublic('a.com', {
    fetchImpl: async (input, options) => {
      const url = new URL(String(input));
      calls.push({ type: url.searchParams.get('type'), options });
      return dnsJson(url.searchParams.get('type') === 'A'
        ? { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }
        : { Status: 0, Answer: [{ type: 28, data: '2606:4700::1111' }] });
    },
  });
  assert.deepEqual(publicResult, { ok: true, addresses: ['8.8.8.8', '2606:4700::1111'] });
  assert.deepEqual(calls.map((item) => item.type).sort(), ['A', 'AAAA']);
  assert.ok(calls.every((item) => item.options.headers.accept === 'application/dns-json'));

  const privateResult = await resolvePublic('a.com', {
    fetchImpl: async (input) => dnsJson(new URL(String(input)).searchParams.get('type') === 'A'
      ? { Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] }
      : { Status: 0, Answer: [{ type: 28, data: '2606:4700::1111' }] }),
  });
  assert.deepEqual(privateResult, { ok: false, reason: 'private_address' });

  assert.deepEqual(await resolvePublic('a.com', {
    fetchImpl: async () => dnsJson({ Status: 3, Answer: [] }),
  }), { ok: false, reason: 'nxdomain' });
  assert.deepEqual(await resolvePublic('a.com', {
    fetchImpl: async () => dnsJson({ Status: 0, Answer: [] }),
  }), { ok: false, reason: 'no_address' });
  assert.deepEqual(await resolvePublic('a.com', {
    fetchImpl: async () => new Response('', { status: 503 }),
  }), { ok: false, reason: 'dns_error' });
  assert.deepEqual(await resolvePublic('a.com', {
    fetchImpl: async () => { throw new Error('offline'); },
  }), { ok: false, reason: 'dns_error' });
});

test('W03 resolvePublic 在查詢前與查詢中中止時都優先回 aborted', async () => {
  const already = new AbortController();
  already.abort();
  let calls = 0;
  assert.deepEqual(await resolvePublic('a.com', {
    signal: already.signal,
    fetchImpl: async () => { calls += 1; return dnsJson({ Status: 0 }); },
  }), { ok: false, reason: 'aborted' });
  assert.equal(calls, 0);

  const during = new AbortController();
  assert.deepEqual(await resolvePublic('a.com', {
    signal: during.signal,
    fetchImpl: async () => {
      during.abort();
      throw during.signal.reason;
    },
  }), { ok: false, reason: 'aborted' });
});

test('W04 page 不跟轉址，robots 同站轉址逐跳記錄且逐跳取得許可', async () => {
  let pageCalls = 0;
  const page = await proxyFetch('https://a.com/old', 'page', 'a.com', {
    resolveImpl: publicDns,
    fetchImpl: async () => {
      pageCalls += 1;
      return proxyResponse('ignored', { status: 301, headers: { location: '/new' } });
    },
  });
  assert.equal(pageCalls, 1);
  assert.equal(page.meta.location, 'https://a.com/new');
  assert.equal(page.meta.skipped, 'redirect');
  assert.deepEqual([...page.bytes], []);

  let permits = 0;
  const robots = await proxyFetch('http://a.com/robots.txt', 'robots', 'a.com', {
    resolveImpl: publicDns,
    permit: async (url) => {
      permits += 1;
      assert.equal(url, 'https://a.com/robots.txt');
      return { ok: true };
    },
    fetchImpl: async (url) => url.startsWith('http:')
      ? proxyResponse('', { status: 301, headers: { location: 'https://a.com/robots.txt' } })
      : proxyResponse('User-agent: *\nAllow: /', { status: 200, headers: { 'content-type': 'text/plain' } }),
  });
  assert.equal(permits, 1);
  assert.deepEqual(robots.meta.chain, [
    { url: 'http://a.com/robots.txt', status: 301, location: 'https://a.com/robots.txt' },
  ]);
  assert.equal(new TextDecoder().decode(robots.bytes), 'User-agent: *\nAllow: /');
});

test('W04 robots 拒絕錯誤路徑、站外、循環與第六次轉址', async () => {
  const badPath = await proxyFetch('https://a.com/robots.txt', 'robots', 'a.com', {
    resolveImpl: publicDns,
    fetchImpl: async () => proxyResponse('', { status: 301, headers: { location: '/other.txt' } }),
  });
  assert.equal(badPath.meta.stop, 'bad_redirect');

  const offsite = await proxyFetch('https://a.com/robots.txt', 'robots', 'a.com', {
    resolveImpl: publicDns,
    fetchImpl: async () => proxyResponse('', { status: 301, headers: { location: 'https://b.com/robots.txt' } }),
  });
  assert.equal(offsite.meta.stop, 'offsite');

  const loop = await proxyFetch('https://a.com/robots.txt', 'robots', 'a.com', {
    resolveImpl: publicDns,
    permit: async () => ({ ok: true }),
    fetchImpl: async (url) => proxyResponse('', {
      status: 301,
      headers: { location: url.startsWith('https:') ? 'http://a.com/robots.txt' : 'https://a.com/robots.txt' },
    }),
  });
  assert.equal(loop.meta.stop, 'loop');
  assert.equal(loop.meta.chain.length, 1);

  let requests = 0;
  let permitCalls = 0;
  const maxHops = await proxyFetch('https://a.com/robots.txt', 'robots', 'a.com', {
    resolveImpl: publicDns,
    permit: async () => { permitCalls += 1; return { ok: true }; },
    fetchImpl: async () => {
      requests += 1;
      return proxyResponse('', { status: 301, headers: { location: `/robots.txt#${requests}` } });
    },
  });
  assert.equal(maxHops.meta.stop, 'max_hops');
  assert.equal(requests, 6);
  assert.equal(permitCalls, 5);
  assert.equal(maxHops.meta.chain.length, 5);
});

test('W04 permit 被拒時不送出該跳，且保留錯誤代碼', async () => {
  let requests = 0;
  let resolutions = 0;
  let permits = 0;
  const result = await proxyFetch('http://a.com/robots.txt', 'robots', 'a.com', {
    resolveImpl: async () => { resolutions += 1; return publicDns(); },
    fetchImpl: async () => {
      requests += 1;
      return proxyResponse('', { status: 301, headers: { location: 'https://a.com/robots.txt' } });
    },
    permit: async () => { permits += 1; return { ok: false, error: 'budget_exhausted' }; },
  });
  assert.equal(result.meta.stop, 'permit_denied');
  assert.equal(result.meta.error, 'budget_exhausted');
  assert.equal(requests, 1);
  assert.equal(resolutions, 1);
  assert.equal(permits, 1);
});

test('W04 過長 Location 不截短，改為 null 並停止', async () => {
  const longLocation = `https://a.com/${'x'.repeat(MAX_URL_BYTES)}`;
  assert.ok(encoder.encode(longLocation).byteLength > MAX_URL_BYTES);
  const page = await proxyFetch('https://a.com/', 'page', 'a.com', {
    resolveImpl: publicDns,
    fetchImpl: async () => proxyResponse('', { status: 301, headers: { location: longLocation } }),
  });
  assert.equal(page.meta.location, null);
  assert.equal(page.meta.stop, 'location_too_long');
  assert.equal(page.bytes, null);
});

test('W04 DNS 封鎖與中止分別映射 blocked_address 與 timeout', async () => {
  let fetchCalls = 0;
  const blocked = await proxyFetch('https://a.com/', 'page', 'a.com', {
    resolveImpl: async () => ({ ok: false, reason: 'private_address' }),
    fetchImpl: async () => { fetchCalls += 1; return proxyResponse(); },
  });
  assert.equal(blocked.meta.error, 'blocked_address');
  assert.equal(fetchCalls, 0);

  const timedOut = await proxyFetch('https://a.com/', 'page', 'a.com', {
    resolveImpl: async () => ({ ok: false, reason: 'aborted' }),
    fetchImpl: async () => { fetchCalls += 1; return proxyResponse(); },
  });
  assert.equal(timedOut.meta.error, 'timeout');
  assert.equal(fetchCalls, 0);
});

test('W04 probe、內容型別、主體邊界與串流錯誤皆 fail closed', async () => {
  const probe = await proxyFetch('https://a.com/probe', 'probe', 'a.com', {
    resolveImpl: publicDns,
    fetchImpl: async () => proxyResponse('must-not-be-returned'),
  });
  assert.equal(probe.meta.skipped, 'probe');
  assert.deepEqual([...probe.bytes], []);

  const binary = await proxyFetch('https://a.com/image', 'page', 'a.com', {
    resolveImpl: publicDns,
    fetchImpl: async () => proxyResponse('png', { headers: { 'content-type': 'image/png' } }),
  });
  assert.equal(binary.meta.skipped, 'non_text');

  for (const extra of [0, 1]) {
    const body = new Uint8Array(BODY_LIMITS.robots + extra);
    const result = await proxyFetch('https://a.com/robots.txt', 'robots', 'a.com', {
      resolveImpl: publicDns,
      fetchImpl: async () => proxyResponse(body, { headers: { 'content-type': 'text/plain' } }),
    });
    assert.equal(result.bytes.length, BODY_LIMITS.robots);
    assert.equal(result.meta.truncated, extra === 1);
  }

  const brokenBody = new ReadableStream({ start(controller) { controller.error(new Error('broken_stream')); } });
  const broken = await proxyFetch('https://a.com/', 'page', 'a.com', {
    resolveImpl: publicDns,
    fetchImpl: async () => proxyResponse(brokenBody, { status: 503, headers: { 'content-type': 'text/plain' } }),
  });
  assert.equal(broken.meta.status, 503);
  assert.equal(broken.meta.error, 'stream_error');
  assert.equal(broken.bytes, null);
});

test('W04 回應封鎖判斷、請求標頭與 512 字元標頭上限精確', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, options });
    return proxyResponse('', {
      status: url.includes('forbidden') ? 403 : 503,
      headers: {
        'content-type': 'text/plain',
        'x-robots-tag': 'n'.repeat(600),
        'cf-mitigated': url.includes('challenge') ? 'challenge' : 'none',
      },
    });
  };
  const forbidden = await proxyFetch('https://a.com/forbidden', 'page', 'a.com', { resolveImpl: publicDns, fetchImpl });
  const challenge = await proxyFetch('https://a.com/challenge', 'page', 'a.com', { resolveImpl: publicDns, fetchImpl });
  const unavailable = await proxyFetch('https://a.com/unavailable', 'page', 'a.com', { resolveImpl: publicDns, fetchImpl });
  assert.equal(forbidden.meta.accessBlocked, true);
  assert.equal(challenge.meta.accessBlocked, true);
  assert.equal(unavailable.meta.accessBlocked, false);
  assert.equal(forbidden.meta.headers['x-robots-tag'].length, 512);
  assert.equal(forbidden.meta.truncatedHeaders, true);
  for (const { options } of seen) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Language', 'User-Agent'].sort());
    assert.equal(options.headers['User-Agent'], 'Mozilla/5.0 (compatible; KinsuiSEOCheck/1.0; +https://goldwatersmartlink.com.tw/)');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
  }
});

test('W06 admit 記錄拒絕前嘗試，第七次同 IP 才 rate_limited', async () => {
  const storage = new AtomicStorage();
  const gate = new GateCore({ storage, now: () => 0 });
  for (let index = 0; index < 6; index += 1) assert.deepEqual(await gate.admit({ ip: '1.2.3.4', host: 'a.com' }), { ok: true });
  assert.deepEqual(await gate.admit({ ip: '1.2.3.4', host: 'a.com' }), { ok: false, error: 'rate_limited' });
  assert.equal(storage.map.get('ip:1.2.3.4').length, 6);
});

test('W06 每日上限以 UTC 日重置，失敗 admit 仍計 IP 次數', async () => {
  let now = Date.UTC(2026, 0, 1, 23, 59, 59);
  const storage = new AtomicStorage();
  const gate = new GateCore({ storage, now: () => now, limits: { dailyCap: 1 } });
  assert.equal((await gate.open({ auditId: '1'.repeat(32), host: 'a.com' })).ok, true);
  assert.deepEqual(await gate.admit({ ip: '5.6.7.8', host: 'b.com' }), { ok: false, error: 'daily_cap' });
  assert.deepEqual(storage.map.get('ip:5.6.7.8'), [now]);
  now = Date.UTC(2026, 0, 2, 0, 0, 0);
  assert.deepEqual(await gate.admit({ ip: '5.6.7.8', host: 'b.com' }), { ok: true });
  assert.equal((await gate.open({ auditId: '2'.repeat(32), host: 'b.com' })).ok, true);
});

test('W06 同網站第四個並行檢查 host_busy，過期與不存在可區分', async () => {
  let now = 0;
  const storage = new AtomicStorage();
  const gate = new GateCore({ storage, now: () => now });
  for (const id of ['1', '2', '3']) assert.equal((await gate.open({ auditId: id.repeat(32), host: 'a.com' })).ok, true);
  assert.deepEqual(await gate.open({ auditId: '4'.repeat(32), host: 'a.com' }), { ok: false, error: 'host_busy' });
  assert.deepEqual(await gate.consume({ auditId: '9'.repeat(32), kind: 'robots', url: 'https://a.com/robots.txt' }), { ok: false, error: 'unknown_audit' });
  now = AUDIT_TTL_MS;
  assert.deepEqual(await gate.consume({ auditId: '1'.repeat(32), kind: 'robots', url: 'https://a.com/robots.txt' }), { ok: false, error: 'expired' });
});

test('W06 consume 依序驗證 host、種類路徑、200ms 間隔與種類額度', async () => {
  let now = 0;
  const storage = new AtomicStorage();
  const id = 'a'.repeat(32);
  const gate = new GateCore({ storage, now: () => now });
  await gate.open({ auditId: id, host: 'a.com' });
  assert.equal((await gate.consume({ auditId: id, kind: 'robots', url: 'https://www.a.com/robots.txt' })).ok, true);
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'robots', url: 'https://b.com/robots.txt' }), { ok: false, error: 'host_mismatch' });
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'robots', url: 'https://a.com/not-robots' }), { ok: false, error: 'kind_path' });
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'sitemap', url: 'https://a.com/page' }), { ok: false, error: 'kind_path' });
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'nope', url: 'https://a.com/' }), { ok: false, error: 'bad_kind' });
  now = 199;
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'robots', url: 'https://a.com/robots.txt' }), { ok: false, error: 'too_fast' });
  now = 200;
  assert.equal((await gate.consume({ auditId: id, kind: 'robots', url: 'https://a.com/robots.txt' })).ok, true);
  for (let used = 2; used < BUDGETS.robots; used += 1) {
    now += 200;
    assert.equal((await gate.consume({ auditId: id, kind: 'robots', url: 'https://a.com/robots.txt' })).ok, true);
  }
  now += 200;
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'robots', url: 'https://a.com/robots.txt' }), { ok: false, error: 'budget_exhausted' });
});

test('W06 robots 政策按 origin 強制，規則、unknown 與同 storage 重建皆 fail closed', async () => {
  let now = 0;
  const storage = new AtomicStorage();
  const id = 'b'.repeat(32);
  const gate = new GateCore({ storage, now: () => now });
  await gate.open({ auditId: id, host: 'a.com' });
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'page', url: 'https://a.com/public' }), { ok: false, error: 'robots_required' });
  assert.equal((await gate.storeRobots({
    auditId: id,
    origins: ['https://a.com'],
    policy: 'rules',
    rules: [{ allow: false, path: '/private' }],
  })).ok, true);
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'page', url: 'https://a.com/private' }), { ok: false, error: 'robots_disallowed' });
  assert.equal((await new GateCore({ storage, now: () => now }).consume({ auditId: id, kind: 'page', url: 'https://a.com/public' })).ok, true);
  now += 200;
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'page', url: 'http://a.com/public' }), { ok: false, error: 'robots_required' });
  await gate.storeRobots({ auditId: id, origins: ['https://a.com'], policy: 'unknown', rules: [] });
  assert.deepEqual(await gate.consume({ auditId: id, kind: 'page', url: 'https://a.com/public' }), { ok: false, error: 'robots_disallowed' });
});

test('W06 storage.put 例外不留下 open 或 consume 的部分狀態', async () => {
  const storage = new AtomicStorage();
  const gate = new GateCore({ storage, now: () => 0 });
  storage.failNextPut = true;
  await assert.rejects(gate.open({ auditId: 'c'.repeat(32), host: 'a.com' }), /injected_put_failure/);
  assert.deepEqual(mapSnapshot(storage), []);

  await gate.open({ auditId: 'c'.repeat(32), host: 'a.com' });
  const before = mapSnapshot(storage);
  storage.failNextPut = true;
  await assert.rejects(gate.consume({ auditId: 'c'.repeat(32), kind: 'robots', url: 'https://a.com/robots.txt' }), /injected_put_failure/);
  assert.deepEqual(mapSnapshot(storage), before);
});

test('R29 2,001 字元、10,001 條與本工具群組 1,001 條的三個邊界精確', () => {
  const exactRule = parseRobots(`User-agent: *\nDisallow: /${'a'.repeat(1999)}`);
  assert.equal(exactRule.overflow, false);
  assert.equal(rulesFor(exactRule, 'kinsuiseocheck').rules.length, 1);
  const overlongRule = parseRobots(`User-agent: *\nDisallow: /${'a'.repeat(2000)}`);
  assert.equal(overlongRule.overflow, true);
  assert.equal(rulesFor(overlongRule, 'kinsuiseocheck').rules.length, 0);

  const tenThousand = parseRobots(`User-agent: *\n${Array.from({ length: 10_000 }, (_, index) => `Disallow: /r${index}`).join('\n')}`);
  assert.equal(tenThousand.overflow, false);
  assert.equal(rulesFor(tenThousand, 'kinsuiseocheck').rules.length, 10_000);
  const tenThousandOne = parseRobots(`User-agent: *\n${Array.from({ length: 10_001 }, (_, index) => `Disallow: /r${index}`).join('\n')}`);
  assert.equal(tenThousandOne.overflow, true);
  assert.equal(rulesFor(tenThousandOne, 'kinsuiseocheck').rules.length, 10_000);

  const ours = parseRobots(`User-agent: KinsuiSEOCheck\n${Array.from({ length: OUR_RULES_MAX + 1 }, (_, index) => `Disallow: /ours-${index}`).join('\n')}`);
  assert.equal(ours.overflow, false);
  assert.equal(rulesFor(ours, 'kinsuiseocheck').rules.length, OUR_RULES_MAX + 1);
});

test('R29 Worker、DO 與前端對本工具 1,001 條規則一致採 unknown 並禁止抓取', async () => {
  const storage = new AtomicStorage();
  const id = 'd'.repeat(32);
  await seedAudit(storage, id);
  const gate = new AuditGate({ storage }, configuredEnv());
  const env = configuredEnv({ AUDIT_GATE: makeBinding(gate) });
  const token = await signToken({ id, exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
  const robotsText = `User-agent: KinsuiSEOCheck\n${Array.from({ length: OUR_RULES_MAX + 1 }, (_, index) => `Disallow: /${index}`).join('\n')}`;

  const response = await withGlobalFetch(publicNetwork(async () => proxyResponse(robotsText, {
    headers: { 'content-type': 'text/plain' },
  })), () => worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/robots.txt', k: 'robots' }, { token }), env));
  assert.equal(response.status, 200);
  const framed = decodeFrame(await response.arrayBuffer());
  assert.deepEqual(framed.meta.ourPolicy, { policy: 'unknown', rulesCount: OUR_RULES_MAX + 1 });
  assert.deepEqual(storage.map.get(`r:${id}:https://a.com`), { policy: 'unknown', rules: [] });

  const audit = storage.map.get(`a:${id}`);
  const doResult = await new GateCore({ storage, now: () => audit.lastAt + 200 }).consume({
    auditId: id,
    kind: 'page',
    url: 'https://a.com/public',
  });
  assert.deepEqual(doResult, { ok: false, error: 'robots_disallowed' });

  let requests = 0;
  const snapshot = await runAudit('https://a.com/', {
    delayMs: 0,
    parseHtml: () => { throw new Error('page must not be parsed'); },
    fetchFn: async (url, kind) => {
      requests += 1;
      assert.equal(kind, 'robots');
      return {
        meta: {
          status: 200,
          finalUrl: url,
          location: null,
          chain: [],
          stop: null,
          error: null,
          truncated: false,
          accessBlocked: false,
          headers: { 'content-type': 'text/plain' },
          ourPolicy: { policy: 'unknown', rulesCount: OUR_RULES_MAX + 1 },
        },
        bytes: encoder.encode(robotsText),
      };
    },
  });
  assert.equal(requests, 1);
  assert.equal(snapshot.robots.ourPolicy.policy, 'unknown');
  assert.equal(snapshot.coverage.status, 'failed');
  assert.ok(snapshot.coverage.reasons.includes('robots_unknown'));
  assert.equal(snapshot.pages.length, 0);
});

test('W07 設定、開關、Origin、主體大小與網址輸入的路由防線完整', async () => {
  const body = { url: 'https://a.com/', turnstileToken: 'ok' };
  let response = await worker.fetch(apiRequest('/api/start', body), configuredEnv({ AUDIT_GATE: undefined }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'service_misconfigured' });

  response = await worker.fetch(apiRequest('/api/start', body), configuredEnv({ AUDIT_GATE: makeBinding(async () => Response.json({ ok: true })), AUDIT_SECRET: 'short' }));
  assert.equal(response.status, 503);
  response = await worker.fetch(apiRequest('/api/start', body, { origin: 'https://prod.example', hostname: 'prod.example' }), configuredEnv({ AUDIT_GATE: makeBinding(async () => Response.json({ ok: true })) }));
  assert.equal(response.status, 503);
  response = await worker.fetch(apiRequest('/api/start', body), configuredEnv({ AUDIT_GATE: makeBinding(async () => Response.json({ ok: true })), AUDIT_ENABLED: 'false' }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'service_paused' });

  const env = configuredEnv({ AUDIT_GATE: makeBinding(async () => Response.json({ ok: true })) });
  response = await worker.fetch(apiRequest('/api/start', body, { origin: 'https://wrong.example' }), env);
  assert.equal(response.status, 403);
  response = await worker.fetch(apiRequest('/api/start', 'x'.repeat(9000)), env);
  assert.equal(response.status, 413);
  response = await worker.fetch(apiRequest('/api/start', { url: 'javascript:alert(1)', turnstileToken: 'ok' }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_url');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.has('access-control-allow-origin'), false);
});

test('W07 start 映射 admit 限制並嚴格驗證 Turnstile success、action 與成功權杖', async () => {
  const body = { url: 'https://a.com/path?secret=1', turnstileToken: 'ok' };
  const limitedCalls = [];
  let env = configuredEnv({
    AUDIT_GATE: makeBinding(async () => Response.json({ ok: false, error: 'rate_limited' }), limitedCalls),
  });
  let response = await worker.fetch(apiRequest('/api/start', body), env);
  assert.equal(response.status, 429);
  assert.deepEqual(limitedCalls, ['/admit']);

  const verificationCases = [
    { success: false, action: 'audit_start' },
    { success: true, action: 'wrong_action' },
  ];
  for (const verification of verificationCases) {
    const calls = [];
    env = configuredEnv({
      AUDIT_GATE: makeBinding(async (input) => Response.json(new URL(input).pathname === '/admit' ? { ok: true } : { ok: false }), calls),
    });
    response = await withGlobalFetch(async () => Response.json(verification), () => worker.fetch(apiRequest('/api/start', body), env));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'turnstile_failed' });
    assert.deepEqual(calls, ['/admit']);
  }

  const successCalls = [];
  const expiresAt = Date.now() + 60_000;
  env = configuredEnv({
    AUDIT_GATE: makeBinding(async (input) => Response.json(new URL(input).pathname === '/admit'
      ? { ok: true }
      : { ok: true, audit: { auditId: 'unused', host: 'a.com', expiresAt } }), successCalls),
  });
  response = await withGlobalFetch(async () => Response.json({ success: true, action: 'audit_start' }), () => worker.fetch(apiRequest('/api/start', body), env));
  assert.equal(response.status, 200);
  const started = await response.json();
  assert.deepEqual(successCalls, ['/admit', '/open']);
  assert.equal(started.url, 'https://a.com/path');
  assert.equal(started.host, 'a.com');
  assert.deepEqual(started.budgets, BUDGETS);
  assert.ok(await verifyToken(started.token, env.AUDIT_SECRET, Date.now()));
});

test('W07 fetch 的無效權杖與偽造權杖不呼叫 DO', async () => {
  const calls = [];
  const env = configuredEnv({ AUDIT_GATE: makeBinding(async () => Response.json({ ok: true }), calls) });
  for (const token of [undefined, 'forged.token']) {
    const response = await worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/', k: 'page' }, { token }), env);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'bad_token' });
  }
  assert.deepEqual(calls, []);
});

test('W07 fetch 對錯誤 kind、別站與缺 robots 政策精確映射且不出站', async () => {
  const storage = new AtomicStorage();
  const id = 'e'.repeat(32);
  await seedAudit(storage, id);
  const calls = [];
  const gate = new AuditGate({ storage }, configuredEnv());
  const env = configuredEnv({ AUDIT_GATE: makeBinding(gate, calls) });
  const token = await signToken({ id, exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
  let networkCalls = 0;
  await withGlobalFetch(async () => { networkCalls += 1; return proxyResponse(); }, async () => {
    let response = await worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/', k: 'wrong' }, { token }), env);
    assert.equal(response.status, 400);
    response = await worker.fetch(apiRequest('/api/fetch', { u: 'https://b.com/', k: 'page' }, { token }), env);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'host_not_allowed' });
    response = await worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/', k: 'page' }, { token }), env);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'robots_required' });
  });
  assert.equal(networkCalls, 0);
  assert.deepEqual(calls, ['/consume', '/consume']);
});

test('W07 正常 robots 寫入政策，正常 page 回應可由 decodeFrame 拆解', async () => {
  const storage = new AtomicStorage();
  const robotsId = 'f'.repeat(32);
  await seedAudit(storage, robotsId);
  const calls = [];
  const gate = new AuditGate({ storage }, configuredEnv());
  const env = configuredEnv({ AUDIT_GATE: makeBinding(gate, calls) });
  const robotsToken = await signToken({ id: robotsId, exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
  let response = await withGlobalFetch(publicNetwork(async (url) => {
    assert.equal(url, 'https://a.com/robots.txt');
    return proxyResponse('User-agent: KinsuiSEOCheck\nDisallow: /private', { headers: { 'content-type': 'text/plain' } });
  }), () => worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/robots.txt', k: 'robots' }, { token: robotsToken }), env));
  assert.equal(response.status, 200);
  const robotsFrame = decodeFrame(await response.arrayBuffer());
  assert.deepEqual(robotsFrame.meta.ourPolicy, { policy: 'rules', rulesCount: 1 });
  assert.deepEqual(storage.map.get(`r:${robotsId}:https://a.com`), {
    policy: 'rules',
    rules: [{ allow: false, path: '/private' }],
  });

  const pageId = '0'.repeat(32);
  await seedAudit(storage, pageId);
  await storage.put(`r:${pageId}:https://a.com`, { policy: 'allow_all', rules: [] });
  const pageToken = await signToken({ id: pageId, exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
  response = await withGlobalFetch(publicNetwork(async () => proxyResponse('<title>頁面</title>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })), () => worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/', k: 'page' }, { token: pageToken }), env));
  assert.equal(response.status, 200);
  const pageFrame = decodeFrame(await response.arrayBuffer());
  assert.equal(pageFrame.meta.status, 200);
  assert.equal(pageFrame.meta.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(new TextDecoder().decode(pageFrame.bytes), '<title>頁面</title>');
});

test('W07 robots 從 HTTP 轉 HTTPS 時兩個 origin 共用政策且額度為兩次', async () => {
  const storage = new AtomicStorage();
  const id = '1'.repeat(32);
  await seedAudit(storage, id);
  const gate = new AuditGate({ storage }, configuredEnv());
  const env = configuredEnv({ AUDIT_GATE: makeBinding(gate) });
  const token = await signToken({ id, exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
  const response = await withGlobalFetch(publicNetwork(async (url) => url.startsWith('http:')
    ? proxyResponse('', { status: 301, headers: { location: 'https://a.com/robots.txt' } })
    : proxyResponse('User-agent: KinsuiSEOCheck\nAllow: /', { headers: { 'content-type': 'text/plain' } })),
  () => worker.fetch(apiRequest('/api/fetch', { u: 'http://a.com/robots.txt', k: 'robots' }, { token }), env));
  assert.equal(response.status, 200);
  const frame = decodeFrame(await response.arrayBuffer());
  assert.equal(frame.meta.chain.length, 1);
  assert.deepEqual(storage.map.get(`r:${id}:http://a.com`), { policy: 'rules', rules: [{ allow: true, path: '/' }] });
  assert.deepEqual(storage.map.get(`r:${id}:https://a.com`), { policy: 'rules', rules: [{ allow: true, path: '/' }] });
  assert.equal(storage.map.get(`a:${id}`).used.robots, 2);
});

test('W07 budget_exhausted 拒絕快取讓同權杖同種類第二次不再呼叫 DO', async () => {
  const id = '2'.repeat(32);
  const calls = [];
  const env = configuredEnv({
    AUDIT_GATE: makeBinding(async () => Response.json({ ok: false, error: 'budget_exhausted' }), calls),
  });
  const token = await signToken({ id, exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/', k: 'page' }, { token }), env);
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'budget_exhausted' });
  }
  assert.deepEqual(calls, ['/consume']);
});

test('W07 未知 API 路由固定回 404 not_found', async () => {
  const response = await worker.fetch(new Request('http://localhost/api/x'), configuredEnv());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});

test('A1 robots 規則物件在 parser、selector、explain 與 DO 都保留 { allow, path }', async () => {
  const parsed = parseRobots([
    'User-agent: KinsuiSEOCheck',
    'Disallow: /private',
    'Allow: /private/open',
  ].join('\n'));
  const expected = [
    { allow: false, path: '/private' },
    { allow: true, path: '/private/open' },
  ];
  assert.deepEqual(parsed.groups[0].rules, expected);
  assert.deepEqual(rulesFor(parsed, 'kinsuiseocheck').rules, expected);
  assert.deepEqual(explain(parsed, 'kinsuiseocheck', '/private/open').rule, expected[1]);

  const storage = new AtomicStorage();
  const gate = new GateCore({ storage, now: () => 0 });
  const auditId = '3'.repeat(32);
  await gate.open({ auditId, host: 'a.com' });
  assert.deepEqual(await gate.storeRobots({
    auditId,
    origins: ['https://a.com'],
    policy: 'rules',
    rules: expected,
  }), { ok: true });
  assert.deepEqual(storage.map.get(`r:${auditId}:https://a.com`).rules, expected);
});

test('A2 localhost 與 127.0.0.1 的 testing-key 回應免檢 action 與 hostname，正式網域不免檢', async () => {
  const body = { url: 'https://a.com/', turnstileToken: 'testing-token' };
  const verification = {
    success: true,
    hostname: 'example.com',
    metadata: { result_with_testing_key: true },
  };

  for (const hostname of ['localhost', '127.0.0.1']) {
    const calls = [];
    const expiresAt = Date.now() + 60_000;
    const env = configuredEnv({
      AUDIT_GATE: makeBinding(async (input) => Response.json(new URL(input).pathname === '/admit'
        ? { ok: true }
        : { ok: true, audit: { auditId: 'unused', host: 'a.com', expiresAt } }), calls),
    });
    const response = await withGlobalFetch(
      async () => Response.json(verification),
      () => worker.fetch(apiRequest('/api/start', body, { hostname, origin: `http://${hostname}` }), env),
    );
    assert.equal(response.status, 200, hostname);
    assert.deepEqual(calls, ['/admit', '/open']);
  }

  const calls = [];
  const env = configuredEnv({
    TURNSTILE_SITEKEY: 'production-site-key',
    TURNSTILE_SECRET: 'production-secret-key',
    AUDIT_GATE: makeBinding(async () => Response.json({ ok: true }), calls),
  });
  const response = await withGlobalFetch(
    async () => Response.json(verification),
    () => worker.fetch(apiRequest('/api/start', body, {
      hostname: 'prod.example',
      origin: 'http://prod.example',
    }), env),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'turnstile_failed' });
  assert.deepEqual(calls, ['/admit']);
});

test('A3 DEV_SKIP_DNS_PRECHECK 只在本機 request hostname 且值為 true 時生效', async () => {
  async function exercise({ hostname, flag, production = false, idChar }) {
    const id = idChar.repeat(32);
    const env = configuredEnv({
      DEV_SKIP_DNS_PRECHECK: flag,
      TURNSTILE_SITEKEY: production ? 'production-site-key' : '1x00000000000000000000AA',
      TURNSTILE_SECRET: production ? 'production-secret-key' : '1x0000000000000000000000000000000AA',
      AUDIT_GATE: makeBinding(async (input) => Response.json(
        new URL(input).pathname === '/consume' ? { ok: true, host: 'a.com' } : { ok: true },
      )),
    });
    const token = await signToken({ id, exp: Date.now() + 60_000 }, env.AUDIT_SECRET);
    let dnsCalls = 0;
    let targetCalls = 0;
    const response = await withGlobalFetch(async (input) => {
      const url = String(input);
      if (url.startsWith('https://cloudflare-dns.com/dns-query')) {
        dnsCalls += 1;
        const type = new URL(url).searchParams.get('type');
        return dnsJson(type === 'A'
          ? { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }
          : { Status: 0, Answer: [] });
      }
      targetCalls += 1;
      return proxyResponse('ok', { headers: { 'content-type': 'text/plain' } });
    }, () => worker.fetch(apiRequest('/api/fetch', { u: 'https://a.com/', k: 'page' }, {
      token,
      hostname,
      origin: `http://${hostname}`,
    }), env));
    assert.equal(response.status, 200);
    assert.equal(decodeFrame(await response.arrayBuffer()).meta.error, null);
    assert.equal(targetCalls, 1);
    return dnsCalls;
  }

  assert.equal(await exercise({ hostname: 'localhost', flag: 'true', idChar: '4' }), 0);
  assert.equal(await exercise({ hostname: '127.0.0.1', flag: 'true', idChar: '5' }), 0);
  assert.ok(await exercise({ hostname: 'localhost', flag: 'TRUE', idChar: '6' }) > 0);
  assert.ok(await exercise({ hostname: 'prod.example', flag: 'true', production: true, idChar: '7' }) > 0);
  const example = await readFile(new URL('../.dev.vars.example', import.meta.url), 'utf8');
  assert.match(example, /^DEV_SKIP_DNS_PRECHECK=false$/mu);
});

test('A7 robots chain 只包含實際跟隨的 3xx，不包含最後的 200', async () => {
  let permits = 0;
  const result = await proxyFetch('https://a.com/robots.txt', 'robots', 'a.com', {
    resolveImpl: publicDns,
    permit: async () => { permits += 1; return { ok: true }; },
    fetchImpl: async (url) => {
      if (url === 'https://a.com/robots.txt') {
        return proxyResponse('', { status: 301, headers: { location: 'http://a.com/robots.txt' } });
      }
      if (url === 'http://a.com/robots.txt') {
        return proxyResponse('', { status: 302, headers: { location: 'https://www.a.com/robots.txt' } });
      }
      return proxyResponse('User-agent: *\nAllow: /', { status: 200, headers: { 'content-type': 'text/plain' } });
    },
  });
  assert.equal(permits, 2);
  assert.deepEqual(result.meta.chain, [
    { url: 'https://a.com/robots.txt', status: 301, location: 'http://a.com/robots.txt' },
    { url: 'http://a.com/robots.txt', status: 302, location: 'https://www.a.com/robots.txt' },
  ]);
  assert.equal(result.meta.status, 200);
  assert.equal(result.meta.finalUrl, 'https://www.a.com/robots.txt');
});
