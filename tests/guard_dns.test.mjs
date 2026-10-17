// SPEC-001 §4.1 guard.js (W01, W02) and §4.2 dns.js (W03)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTarget, hostAllowed } from '../src/guard.js';
import { isPublicIPv4, isPublicIPv6, resolvePublic } from '../src/dns.js';
import { proxyFetch } from '../src/proxy.js';

// ------------------------------------------------------------------ W01
test('W01 checkTarget blocks private / special targets with the right reason', () => {
  const cases = [
    ['http://127.0.0.1/', 'ip_literal'],
    ['http://2130706433/', 'ip_literal'],
    ['http://0x7f000001/', 'ip_literal'],
    ['http://[::1]/', 'ip_literal'],
    ['http://localhost/', 'blocked_host'],
    ['http://localhost./', 'blocked_host'],
    ['http://printer.local/', 'blocked_host'],
    ['http://printer.local./', 'blocked_host'],
    ['http://intranet/', 'blocked_host'],
    ['https://a.com:8080/', 'port'],
    ['https://u:p@a.com/', 'credentials'],
    ['javascript:alert(1)', 'scheme'],
    ['ftp://a.com/', 'scheme'],
  ];
  for (const [input, reason] of cases) {
    const r = checkTarget(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.reason, reason, input);
  }
});

test('W01 checkTarget: selfHosts -> self_host (also via www.)', () => {
  const opts = { selfHosts: ['seo.kinsui-check.com'] };
  assert.deepEqual(
    { ok: checkTarget('https://seo.kinsui-check.com/', opts).ok, reason: checkTarget('https://seo.kinsui-check.com/', opts).reason },
    { ok: false, reason: 'self_host' },
  );
  assert.equal(checkTarget('https://www.seo.kinsui-check.com/x', opts).reason, 'self_host');
  assert.equal(checkTarget('https://SEO.Kinsui-Check.com/', opts).reason, 'self_host');
});

test('W01 checkTarget: 2,049 bytes -> too_long; 2,048 bytes passes; UTF-8 bytes counted', () => {
  const base = 'https://a.com/';
  const u2049 = base + 'a'.repeat(2049 - base.length);
  assert.equal(new TextEncoder().encode(u2049).length, 2049);
  assert.equal(checkTarget(u2049).reason, 'too_long');
  const u2048 = base + 'a'.repeat(2048 - base.length);
  assert.equal(checkTarget(u2048).ok, true);
  const multi = base + '產'.repeat(700); // 714 chars, 2,114 bytes
  assert.equal(checkTarget(multi).reason, 'too_long');
});

test('W01 checkTarget: non-string -> invalid', () => {
  for (const v of [null, undefined, 42, {}, ['https://a.com/']]) assert.equal(checkTarget(v).reason, 'invalid');
});

test('W01 checkTarget: other blocked suffixes and explicit schemes', () => {
  for (const h of ['a.internal', 'a.lan', 'a.home', 'x.home.arpa', 'a.intranet', 'a.corp', 'abc.onion', 'a.test', 'a.invalid', 'a.example', '1.in-addr.arpa', 'app.localhost']) {
    assert.equal(checkTarget(`https://${h}/`).reason, 'blocked_host', h);
  }
  for (const s of ['data:text/html,x', 'file:///etc/passwd', 'mailto:a@b.com', 'vbscript:x', 'blob:https://a.com/x', 'about:blank', 'ws://a.com/', 'wss://a.com/', 'JavaScript:alert(1)']) {
    assert.equal(checkTarget(s).reason, 'scheme', s);
  }
});

test('W01 checkTarget passes example.com and https://www.example.com/path?q=1', () => {
  const a = checkTarget('example.com');
  assert.equal(a.ok, true);
  assert.equal(a.url, 'https://example.com/');
  assert.equal(a.host, 'example.com');
  const b = checkTarget('https://www.example.com/path?q=1');
  assert.equal(b.ok, true);
  assert.equal(b.url, 'https://www.example.com/path?q=1');
  assert.equal(b.host, 'example.com');
  const c = checkTarget('  https://Example.COM./x#frag  ');
  assert.equal(c.ok, true);
  assert.equal(c.url, 'https://example.com/x');
  assert.equal(c.host, 'example.com');
});

// ------------------------------------------------------------------ W02
test('W02 hostAllowed', () => {
  assert.equal(hostAllowed('a.com', 'https://a.com/x'), true);
  assert.equal(hostAllowed('a.com', 'http://www.a.com/'), true);
  assert.equal(hostAllowed('a.com', 'https://sub.a.com/'), false);
  assert.equal(hostAllowed('a.com', 'https://evil-a.com/'), false);
  assert.equal(hostAllowed('a.com', 'https://a.com.evil.com/'), false);
  assert.equal(hostAllowed('a.com', 'https://a.com:8443/'), false);
  assert.equal(hostAllowed('a.com', 'https://a.com/', { selfHosts: ['a.com'] }), false);
});

// ------------------------------------------------------------------ W03 helpers
function v4ToInt(ip) {
  return ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
}
function intToV4(n) {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
}
function v4Range(cidr) {
  const [ip, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(v4ToInt(ip) / size) * size;
  return [intToV4(start), intToV4(start + size - 1)];
}

function v6ToBig(ip) {
  let [head, tail] = ip.includes('::') ? ip.split('::') : [ip, null];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : Array(8 - h.length - t.length).fill('0');
  const groups = [...h, ...fill, ...t];
  return groups.reduce((a, g) => (a << 16n) | BigInt(parseInt(g || '0', 16)), 0n);
}
// RFC 5952 canonical text form (lower-case, longest zero run compressed)
function bigToV6(n) {
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(Number((n >> BigInt(i * 16)) & 0xffffn));
  let bestS = -1;
  let bestL = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestL && j - i >= 2) {
      bestS = i;
      bestL = j - i;
    }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (bestS < 0) return hex.join(':');
  return hex.slice(0, bestS).join(':') + '::' + hex.slice(bestS + bestL).join(':');
}
function v6Range(cidr) {
  const [ip, bits] = cidr.split('/');
  const hostBits = 128n - BigInt(bits);
  const mask = (1n << hostBits) - 1n;
  const start = v6ToBig(ip) & ~mask & ((1n << 128n) - 1n);
  return [bigToV6(start), bigToV6(start | mask)];
}

const V4_RANGES = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16', '192.175.48.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];
const V6_RANGES = ['::/128', '::1/128', '::/96', '::ffff:0:0/96', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20', '5f00::/16', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8'];

test('W03 helper sanity (test-internal range arithmetic)', () => {
  assert.deepEqual(v4Range('100.64.0.0/10'), ['100.64.0.0', '100.127.255.255']);
  assert.deepEqual(v6Range('fc00::/7'), ['fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']);
  assert.deepEqual(v6Range('::1/128'), ['::1', '::1']);
  assert.deepEqual(v6Range('2001::/23'), ['2001::', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff']);
});

test('W03 isPublicIPv4: start and end of every listed range are not public', () => {
  for (const cidr of V4_RANGES) {
    const [s, e] = v4Range(cidr);
    assert.equal(isPublicIPv4(s), false, `${cidr} start ${s}`);
    assert.equal(isPublicIPv4(e), false, `${cidr} end ${e}`);
  }
});

test('W03 isPublicIPv4: addresses outside the ranges are public', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '11.0.0.1', '100.128.0.1', '172.32.0.1', '192.169.0.1']) {
    assert.equal(isPublicIPv4(ip), true, ip);
  }
});

test('W03 isPublicIPv6: start and end of every listed range are not public', () => {
  for (const cidr of V6_RANGES) {
    const [s, e] = v6Range(cidr);
    assert.equal(isPublicIPv6(s), false, `${cidr} start ${s}`);
    assert.equal(isPublicIPv6(e), false, `${cidr} end ${e}`);
  }
});

test('W03 isPublicIPv6: public examples and embedded-IPv4 forms', () => {
  assert.equal(isPublicIPv6('2606:4700::1111'), true);
  assert.equal(isPublicIPv6('2001:4860:4860::8888'), true);
  assert.equal(isPublicIPv6('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIPv6('2002:c0a8:0101::1'), false);
  assert.equal(isPublicIPv6('::ffff:8.8.8.8'), false);
});

// ------------------------------------------------------------------ W03 resolvePublic with fake DoH
function doh(answers) {
  // answers: { A: {Status, Answer} | 'throw' | 'http500' | 'badjson', AAAA: ... }
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers));
    const signal = init.signal || (typeof input === 'string' ? undefined : input.signal);
    calls.push({ url, accept: headers.get('accept'), signal });
    if (signal && signal.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError'); // like real fetch
    const type = new URL(url).searchParams.get('type');
    const a = answers[type];
    if (a === 'throw') throw new TypeError('network down');
    if (a === 'http500') return new Response('err', { status: 500 });
    if (a === 'badjson') return new Response('{not json', { status: 200, headers: { 'content-type': 'application/dns-json' } });
    if (a === 'hang') {
      return new Promise((_, rej) => {
        if (signal) signal.addEventListener('abort', () => rej(signal.reason ?? new DOMException('aborted', 'AbortError')));
        setTimeout(() => rej(new TypeError('test safety timeout')), 3000);
      });
    }
    return new Response(JSON.stringify(a ?? { Status: 0 }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
  };
  return { fetchImpl, calls };
}

test('W03 resolvePublic: queries A and AAAA via cloudflare-dns.com with dns-json accept', async () => {
  const f = doh({ A: { Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }, AAAA: { Status: 0, Answer: [{ type: 28, data: '2606:2800:220:1::1' }] } });
  const r = await resolvePublic('a.com', { fetchImpl: f.fetchImpl });
  assert.equal(r.ok, true);
  assert.ok(r.addresses.includes('93.184.216.34'));
  assert.ok(r.addresses.includes('2606:2800:220:1::1'));
  const types = f.calls.map((c) => {
    const u = new URL(c.url);
    assert.equal(u.origin + u.pathname, 'https://cloudflare-dns.com/dns-query');
    assert.equal(u.searchParams.get('name'), 'a.com');
    assert.equal(c.accept, 'application/dns-json');
    return u.searchParams.get('type');
  });
  assert.deepEqual(types.sort(), ['A', 'AAAA']);
});

test('W03 resolvePublic: any private address -> private_address', async () => {
  const f1 = doh({ A: { Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] }, AAAA: { Status: 0 } });
  assert.equal((await resolvePublic('a.com', { fetchImpl: f1.fetchImpl })).reason, 'private_address');
  const f2 = doh({ A: { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }, AAAA: { Status: 0, Answer: [{ type: 28, data: '::1' }] } });
  assert.equal((await resolvePublic('a.com', { fetchImpl: f2.fetchImpl })).reason, 'private_address');
});

test('W03 resolvePublic: only type 1/28 data is collected (CNAME ignored)', async () => {
  const f = doh({
    A: { Status: 0, Answer: [{ type: 5, data: 'cdn.a.com.' }, { type: 1, data: '93.184.216.34' }] },
    AAAA: { Status: 0, Answer: [{ type: 5, data: 'cdn.a.com.' }] },
  });
  const r = await resolvePublic('a.com', { fetchImpl: f.fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(r.addresses, ['93.184.216.34']);
});

test('W03 resolvePublic: both Status 3 -> nxdomain; no address -> no_address', async () => {
  const nx = doh({ A: { Status: 3 }, AAAA: { Status: 3 } });
  assert.equal((await resolvePublic('nope.a.com', { fetchImpl: nx.fetchImpl })).reason, 'nxdomain');
  const empty = doh({ A: { Status: 0 }, AAAA: { Status: 0 } });
  assert.equal((await resolvePublic('a.com', { fetchImpl: empty.fetchImpl })).reason, 'no_address');
  const onlyCname = doh({ A: { Status: 0, Answer: [{ type: 5, data: 'x.' }] }, AAAA: { Status: 0 } });
  assert.equal((await resolvePublic('a.com', { fetchImpl: onlyCname.fetchImpl })).reason, 'no_address');
});

test('W03 resolvePublic: network failure / non-200 / bad JSON -> dns_error', async () => {
  for (const bad of ['throw', 'http500', 'badjson']) {
    const f = doh({ A: bad, AAAA: { Status: 0 } });
    const r = await resolvePublic('a.com', { fetchImpl: f.fetchImpl });
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, 'dns_error', bad);
  }
});

test('W03 resolvePublic: signal already aborted -> aborted', async () => {
  const f = doh({ A: { Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] }, AAAA: { Status: 3 } });
  const r = await resolvePublic('a.com', { fetchImpl: f.fetchImpl, signal: AbortSignal.abort() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'aborted');
});

test('W03 resolvePublic: aborted during the query -> aborted (signal is passed to fetch)', async () => {
  const f = doh({ A: 'hang', AAAA: 'hang' });
  const ac = new AbortController();
  setTimeout(() => ac.abort(new DOMException('timed out', 'TimeoutError')), 30);
  const r = await resolvePublic('a.com', { fetchImpl: f.fetchImpl, signal: ac.signal });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'aborted');
  assert.ok(f.calls.length >= 1);
  assert.ok(f.calls.every((c) => c.signal), 'signal must be passed to the DoH fetch');
});

test('W03 proxyFetch maps resolvePublic "aborted" to error "timeout"', async () => {
  let fetched = 0;
  const { meta, bytes } = await proxyFetch('https://a.com/', 'page', 'a.com', {
    fetchImpl: async () => {
      fetched++;
      return new Response('x');
    },
    resolveImpl: async () => ({ ok: false, reason: 'aborted' }),
  });
  assert.equal(meta.error, 'timeout');
  assert.equal(bytes, null);
  assert.equal(fetched, 0);
});

// ------------------------------------------------------------------ mutation gaps GD07, DN05
test('GD07 checkTarget: password without username -> credentials', () => {
  const r = checkTarget('https://:p@a.com/');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'credentials');
  assert.equal(checkTarget('https://u@a.com/').reason, 'credentials');
});

test('DN05 resolvePublic: A Status 3 but AAAA Status 0 with a public address -> ok (not nxdomain)', async () => {
  const f = doh({ A: { Status: 3 }, AAAA: { Status: 0, Answer: [{ type: 28, data: '2606:4700::1111' }] } });
  const r = await resolvePublic('a.com', { fetchImpl: f.fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(r.addresses, ['2606:4700::1111']);
  // only one side NXDOMAIN and no address at all -> no_address, still not nxdomain
  const g = doh({ A: { Status: 3 }, AAAA: { Status: 0 } });
  assert.equal((await resolvePublic('a.com', { fetchImpl: g.fetchImpl })).reason, 'no_address');
  const h = doh({ A: { Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }, AAAA: { Status: 3 } });
  assert.equal((await resolvePublic('a.com', { fetchImpl: h.fetchImpl })).ok, true);
});
