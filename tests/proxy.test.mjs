// SPEC-001 §4.3 proxy.js — W04
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyFetch, BODY_LIMITS, MAX_URL_BYTES } from '../src/proxy.js';

const UA = 'Mozilla/5.0 (compatible; KinsuiSEOCheck/1.0; +https://goldwatersmartlink.com.tw/)';
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5';
const ACCEPT_LANG = 'zh-TW,zh;q=0.9,en;q=0.5';
const dec = new TextDecoder();

function reqInfo(input, init = {}) {
  if (input instanceof Request) {
    return { url: input.url, method: init.method || input.method, redirect: init.redirect || input.redirect, headers: new Headers(init.headers || input.headers), signal: init.signal || input.signal };
  }
  return { url: String(input), method: init.method, redirect: init.redirect, headers: new Headers(init.headers || {}), signal: init.signal };
}

// handler(url, info, n) -> Response
function recorder(handler) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const info = reqInfo(input, init);
    calls.push(info);
    return handler(info.url, info, calls.length);
  };
  return { fetchImpl, calls };
}

function resolver() {
  const calls = [];
  const resolveImpl = async (hostname) => {
    calls.push(hostname);
    return { ok: true, addresses: ['93.184.216.34'] };
  };
  return { resolveImpl, calls };
}

function redirect(location, status = 301) {
  return new Response('moved', { status, headers: { location, 'content-type': 'text/html' } });
}
function text(body, type = 'text/plain', status = 200, extra = {}) {
  return new Response(body, { status, headers: { 'content-type': type, ...extra } });
}

async function run(url, kind, handler, opts = {}) {
  const f = recorder(handler);
  const r = resolver();
  const out = await proxyFetch(url, kind, opts.siteHost ?? 'a.com', {
    fetchImpl: f.fetchImpl,
    resolveImpl: opts.resolveImpl ?? r.resolveImpl,
    deadlineMs: opts.deadlineMs ?? 3000,
    ...(opts.permit ? { permit: opts.permit } : {}),
    ...(opts.selfHosts ? { selfHosts: opts.selfHosts } : {}),
  });
  return { ...out, calls: f.calls, resolveCalls: r.calls };
}

test('W04 constants', () => {
  assert.deepEqual(BODY_LIMITS, { page: 2_000_000, robots: 512_000, sitemap: 2_000_000, probe: 0 });
  assert.equal(MAX_URL_BYTES, 2048);
});

test('W04 meta has every §4.3 field; ourPolicy null from proxyFetch', async () => {
  const { meta, bytes } = await run('https://a.com/', 'page', () => text('<html></html>', 'text/html'));
  for (const k of ['status', 'finalUrl', 'location', 'chain', 'stop', 'error', 'bodyLimit', 'skipped', 'truncated', 'accessBlocked', 'truncatedHeaders', 'headers', 'ourPolicy']) {
    assert.ok(k in meta, k);
  }
  for (const h of ['content-type', 'x-robots-tag', 'content-length', 'cf-mitigated']) assert.ok(h in meta.headers, h);
  assert.equal(meta.headers['x-robots-tag'], null);
  assert.equal(meta.headers['cf-mitigated'], null);
  assert.equal(meta.ourPolicy, null);
  assert.equal(meta.status, 200);
  assert.equal(meta.error, null);
  assert.equal(meta.stop, null);
  assert.equal(meta.skipped, null);
  assert.equal(meta.truncated, false);
  assert.equal(meta.accessBlocked, false);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(dec.decode(bytes), '<html></html>');
});

test('W04 page 301 is NOT followed; location absolute; skipped=redirect', async () => {
  const { meta, bytes, calls } = await run('https://a.com/old', 'page', () => redirect('/new?x=1'));
  assert.equal(calls.length, 1);
  assert.equal(meta.status, 301);
  assert.equal(meta.location, 'https://a.com/new?x=1');
  assert.equal(meta.skipped, 'redirect');
  assert.equal(meta.finalUrl, 'https://a.com/old');
  assert.equal(meta.stop, null);
  assert.ok(bytes === null || bytes.length === 0);
});

test('W04 page 301 to another site: still a single request, location kept absolute', async () => {
  const { meta, calls } = await run('https://a.com/old', 'page', () => redirect('https://evil.com/x', 302));
  assert.equal(calls.length, 1);
  assert.equal(meta.status, 302);
  assert.equal(meta.location, 'https://evil.com/x');
});

test('W04 3xx without Location -> location null', async () => {
  const { meta } = await run('https://a.com/old', 'page', () => new Response('x', { status: 302, headers: { 'content-type': 'text/html' } }));
  assert.equal(meta.location, null);
  assert.equal(meta.skipped, 'redirect');
});

test('W04 request: GET, redirect manual, only the three fixed headers (no Cookie/Authorization)', async () => {
  const { calls } = await run('https://a.com/', 'page', () => text('ok', 'text/html'));
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://a.com/');
  assert.equal((c.method || 'GET').toUpperCase(), 'GET');
  assert.equal(c.redirect, 'manual');
  assert.equal(c.headers.get('user-agent'), UA);
  assert.equal(c.headers.get('accept'), ACCEPT);
  assert.equal(c.headers.get('accept-language'), ACCEPT_LANG);
  assert.equal(c.headers.get('cookie'), null);
  assert.equal(c.headers.get('authorization'), null);
  assert.deepEqual([...c.headers.keys()].sort(), ['accept', 'accept-language', 'user-agent']);
  assert.ok(c.signal, 'deadline signal passed to fetch');
});

test('W04 robots: same-site 301 to /robots.txt is followed, chain recorded, permit asked for hop 2', async () => {
  const permits = [];
  const { meta, bytes, calls, resolveCalls } = await run(
    'https://www.a.com/robots.txt',
    'robots',
    (url) => (url === 'https://www.a.com/robots.txt' ? redirect('https://a.com/robots.txt') : text('User-agent: *\nDisallow: /x\n')),
    { permit: async (u) => (permits.push(u), { ok: true }) },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.url), ['https://www.a.com/robots.txt', 'https://a.com/robots.txt']);
  assert.equal(meta.status, 200);
  assert.equal(meta.finalUrl, 'https://a.com/robots.txt');
  assert.equal(meta.stop, null);
  assert.deepEqual(meta.chain[0], { url: 'https://www.a.com/robots.txt', status: 301, location: 'https://a.com/robots.txt' });
  // A7 (v1.5): chain holds only the followed 3xx hops, not the final 200
  assert.equal(meta.chain.length, 1);
  assert.equal(dec.decode(bytes), 'User-agent: *\nDisallow: /x\n');
  assert.deepEqual(permits, ['https://a.com/robots.txt']);
  // DNS pre-check is redone for every hop
  assert.deepEqual(resolveCalls, ['www.a.com', 'a.com']);
});

test('W04 robots: relative Location to /robots.txt across http->https is followed', async () => {
  const { meta, calls } = await run('http://a.com/robots.txt', 'robots', (url) =>
    url === 'http://a.com/robots.txt' ? redirect('https://a.com/robots.txt', 308) : text('User-agent: *\nAllow: /\n'),
  );
  assert.equal(calls.length, 2);
  assert.equal(meta.finalUrl, 'https://a.com/robots.txt');
  assert.equal(meta.chain[0].status, 308);
  assert.equal(meta.chain.length, 1);
});

test('W04 robots: redirect to /other.txt -> stop bad_redirect (not followed)', async () => {
  const { meta, bytes, calls } = await run('https://a.com/robots.txt', 'robots', () => redirect('/other.txt'));
  assert.equal(calls.length, 1);
  assert.equal(meta.stop, 'bad_redirect');
  assert.equal(bytes, null);
});

test('W04 robots: redirect to /robots.txt?x=1 (query) -> bad_redirect', async () => {
  const { meta, calls } = await run('https://a.com/robots.txt', 'robots', () => redirect('/robots.txt?x=1'));
  assert.equal(calls.length, 1);
  assert.equal(meta.stop, 'bad_redirect');
});

test('W04 robots: redirect to another site -> stop offsite', async () => {
  const { meta, calls } = await run('https://a.com/robots.txt', 'robots', () => redirect('https://evil.com/robots.txt'));
  assert.equal(calls.length, 1);
  assert.equal(meta.stop, 'offsite');
});

test('W04 robots: redirect loop -> stop loop', async () => {
  const { meta, calls } = await run('https://a.com/robots.txt', 'robots', (url) =>
    url === 'https://a.com/robots.txt' ? redirect('https://www.a.com/robots.txt') : redirect('https://a.com/robots.txt'),
  );
  assert.equal(meta.stop, 'loop');
  assert.equal(calls.length, 2);
});

test('W04 robots: 6th redirect -> stop max_hops', async () => {
  // AMBIGUOUS: only four distinct same-site "/robots.txt without query" URLs exist (http/https x www/bare),
  // so a 6-redirect chain without a loop needs URL variants; an empty query ("?") keeps search === ''
  // while giving a distinct href. Loop detection is assumed to compare full hrefs.
  const seq = [
    'https://a.com/robots.txt',
    'https://www.a.com/robots.txt',
    'http://a.com/robots.txt',
    'http://www.a.com/robots.txt',
    'https://a.com/robots.txt?',
    'https://www.a.com/robots.txt?',
    'http://a.com/robots.txt?',
  ];
  const permits = [];
  const { meta, calls } = await run(
    seq[0],
    'robots',
    (url, info, n) => redirect(seq[n] ?? 'https://a.com/robots.txt'),
    { permit: async (u) => (permits.push(u), { ok: true }) },
  );
  assert.equal(meta.stop, 'max_hops');
  assert.equal(calls.length, 6);
  assert.equal(permits.length, 5);
});

test('W04 robots: permit denied on hop 2 -> stop permit_denied, hop not requested, permit calls = hops - 1', async () => {
  const permits = [];
  const { meta, bytes, calls } = await run(
    'https://www.a.com/robots.txt',
    'robots',
    (url) => (url === 'https://www.a.com/robots.txt' ? redirect('https://a.com/robots.txt') : text('User-agent: *\n')),
    { permit: async (u) => (permits.push(u), { ok: false, error: 'budget_exhausted' }) },
  );
  assert.equal(meta.stop, 'permit_denied');
  assert.equal(meta.error, 'budget_exhausted');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls.map((c) => c.url), ['https://www.a.com/robots.txt']);
  assert.equal(permits.length, 1); // 2 hops - 1
  assert.equal(bytes, null);
});

test('W04 robots: 3-hop chain asks permit for hops 2 and 3 only', async () => {
  const permits = [];
  const { meta, calls } = await run(
    'https://www.a.com/robots.txt',
    'robots',
    (url) => {
      if (url === 'https://www.a.com/robots.txt') return redirect('https://a.com/robots.txt');
      if (url === 'https://a.com/robots.txt') return redirect('http://a.com/robots.txt', 302);
      return text('User-agent: *\nDisallow:\n');
    },
    { permit: async (u) => (permits.push(u), { ok: true }) },
  );
  assert.equal(meta.status, 200);
  assert.equal(meta.finalUrl, 'http://a.com/robots.txt');
  assert.equal(calls.length, 3);
  assert.deepEqual(permits, ['https://a.com/robots.txt', 'http://a.com/robots.txt']);
  assert.equal(meta.chain[0].url, 'https://www.a.com/robots.txt');
  assert.equal(meta.chain[1].url, 'https://a.com/robots.txt');
  assert.equal(meta.chain.length, 2);
});

test('A7 robots without redirects -> chain is empty (the final non-3xx response is never in chain)', async () => {
  const { meta } = await run('https://a.com/robots.txt', 'robots', () => text('User-agent: *\nDisallow:\n'));
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.chain, []);
});

test('W04 Location longer than 2,048 bytes -> location null, stop location_too_long (page and robots)', async () => {
  const longPath = '/' + 'x'.repeat(2100);
  const p = await run('https://a.com/old', 'page', () => redirect(longPath));
  assert.equal(p.meta.location, null);
  assert.equal(p.meta.stop, 'location_too_long');
  const r = await run('https://a.com/robots.txt', 'robots', () => redirect(longPath));
  assert.equal(r.meta.location, null);
  assert.equal(r.meta.stop, 'location_too_long');
  assert.equal(r.calls.length, 1);
});

test('W04 Location of exactly 2,048 bytes is kept intact', async () => {
  const loc = 'https://a.com/' + 'x'.repeat(2048 - 'https://a.com/'.length);
  const p = await run('https://a.com/old', 'page', () => redirect(loc));
  assert.equal(p.meta.location, loc);
  assert.equal(p.meta.stop, null);
});

test('W04 DNS private -> blocked_address; other DNS failure -> dns_error; no fetch', async () => {
  const a = await run('https://a.com/', 'page', () => text('x'), { resolveImpl: async () => ({ ok: false, reason: 'private_address' }) });
  assert.equal(a.meta.error, 'blocked_address');
  assert.equal(a.bytes, null);
  assert.equal(a.meta.status, 0);
  assert.equal(a.calls.length, 0);
  for (const reason of ['nxdomain', 'no_address', 'dns_error']) {
    const b = await run('https://a.com/', 'page', () => text('x'), { resolveImpl: async () => ({ ok: false, reason }) });
    assert.equal(b.meta.error, 'dns_error', reason);
    assert.equal(b.calls.length, 0);
  }
});

test('W04 DNS stage timeout -> error timeout', async () => {
  const resolveImpl = (hostname, opts = {}) =>
    new Promise((resolve) => {
      const sig = opts.signal;
      const done = () => resolve({ ok: false, reason: 'aborted' });
      if (sig) {
        if (sig.aborted) return done();
        sig.addEventListener('abort', done);
      }
      setTimeout(() => resolve({ ok: false, reason: 'dns_error' }), 3000); // safety: signal not passed
    });
  const t0 = Date.now();
  const r = await run('https://a.com/', 'page', () => text('x'), { resolveImpl, deadlineMs: 50 });
  assert.equal(r.meta.error, 'timeout');
  assert.equal(r.bytes, null);
  assert.ok(Date.now() - t0 < 2500);
});

test('W04 host not allowed (other site / self host) -> host_not_allowed without DNS or fetch', async () => {
  const a = await run('https://b.com/', 'page', () => text('x'));
  assert.equal(a.meta.error, 'host_not_allowed');
  assert.equal(a.calls.length, 0);
  assert.equal(a.resolveCalls.length, 0);
  const b = await run('https://a.com/', 'page', () => text('x'), { selfHosts: ['a.com'] });
  assert.equal(b.meta.error, 'host_not_allowed');
  assert.equal(b.calls.length, 0);
});

test('W04 probe has no body (skipped=probe)', async () => {
  const { meta, bytes } = await run('https://a.com/seo-check-404-deadbeef', 'probe', () => text('<html>hi</html>', 'text/html'));
  assert.equal(meta.status, 200);
  assert.equal(meta.skipped, 'probe');
  assert.ok(bytes === null || bytes.length === 0);
});

test('W04 image/png -> skipped non_text', async () => {
  const { meta, bytes } = await run('https://a.com/a.png', 'page', () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.equal(meta.skipped, 'non_text');
  assert.ok(bytes === null || bytes.length === 0);
});

test('W04 text-like content types and missing content-type are read', async () => {
  for (const ct of ['text/html; charset=utf-8', 'application/xhtml+xml', 'application/xml', 'application/rss+xml', 'application/atom+xml', 'text/plain']) {
    const { meta, bytes } = await run('https://a.com/sitemap.xml', 'sitemap', () => text('<x/>', ct));
    assert.equal(meta.skipped, null, ct);
    assert.equal(dec.decode(bytes), '<x/>', ct);
  }
  const { meta, bytes } = await run('https://a.com/', 'page', () => new Response(new TextEncoder().encode('hello'), { status: 200 }));
  assert.equal(meta.headers['content-type'], null);
  assert.equal(meta.skipped, null);
  assert.equal(dec.decode(bytes), 'hello');
});

test('W04 body over the limit -> truncated, length = limit', async () => {
  const big = new Uint8Array(BODY_LIMITS.robots + 1000).fill(65);
  const { meta, bytes } = await run('https://a.com/robots.txt', 'robots', () => new Response(big, { status: 200, headers: { 'content-type': 'text/plain' } }));
  assert.equal(meta.truncated, true);
  assert.equal(bytes.length, BODY_LIMITS.robots);
  const one = new Uint8Array(BODY_LIMITS.robots + 1).fill(65);
  const r2 = await run('https://a.com/robots.txt', 'robots', () => new Response(one, { status: 200, headers: { 'content-type': 'text/plain' } }));
  assert.equal(r2.meta.truncated, true);
  assert.equal(r2.bytes.length, BODY_LIMITS.robots);
});

test('W04 body exactly at the limit -> not truncated', async () => {
  const exact = new Uint8Array(BODY_LIMITS.robots).fill(66);
  const { meta, bytes } = await run('https://a.com/robots.txt', 'robots', () => new Response(exact, { status: 200, headers: { 'content-type': 'text/plain' } }));
  assert.equal(meta.truncated, false);
  assert.equal(bytes.length, BODY_LIMITS.robots);
});

test('W04 page limit 2,000,000 bytes', async () => {
  const big = new Uint8Array(BODY_LIMITS.page + 1).fill(67);
  const { meta, bytes } = await run('https://a.com/', 'page', () => new Response(big, { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal(meta.truncated, true);
  assert.equal(bytes.length, 2_000_000);
});

test('W04 timeout before the response -> error timeout', async () => {
  const t0 = Date.now();
  const r = await run(
    'https://a.com/',
    'page',
    (url, info) =>
      new Promise((_, reject) => {
        if (info.signal) info.signal.addEventListener('abort', () => reject(info.signal.reason ?? new DOMException('aborted', 'AbortError')));
        setTimeout(() => reject(new TypeError('test safety: signal never fired')), 3000);
      }),
    { deadlineMs: 50 },
  );
  assert.equal(r.meta.error, 'timeout');
  assert.equal(r.bytes, null);
  assert.ok(Date.now() - t0 < 2500);
});

test('W04 timeout while reading the body -> error timeout, status kept', async () => {
  const r = await run(
    'https://a.com/',
    'page',
    (url, info) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>partial'));
          const fail = (e) => {
            try {
              controller.error(e);
            } catch {}
          };
          if (info.signal) info.signal.addEventListener('abort', () => fail(info.signal.reason ?? new DOMException('aborted', 'AbortError')));
          setTimeout(() => fail(new Error('test safety: signal never fired')), 3000);
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } });
    },
    { deadlineMs: 80 },
  );
  assert.equal(r.meta.error, 'timeout');
  assert.equal(r.meta.status, 200);
  assert.equal(r.bytes, null);
});

test('W04 network error -> error network, status 0, bytes null', async () => {
  const r = await run('https://a.com/', 'page', () => {
    throw new TypeError('fetch failed');
  });
  assert.equal(r.meta.error, 'network');
  assert.equal(r.meta.status, 0);
  assert.equal(r.bytes, null);
});

test('W04 stream read error -> stream_error, status kept', async () => {
  const r = await run('https://a.com/', 'page', () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('abc'));
        setTimeout(() => c.error(new Error('boom')), 5);
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } });
  });
  assert.equal(r.meta.error, 'stream_error');
  assert.equal(r.meta.status, 200);
  assert.equal(r.bytes, null);
});

test('W04 accessBlocked: 403 and 401 yes, cf-mitigated: challenge yes, plain 503 no', async () => {
  const a = await run('https://a.com/', 'page', () => text('denied', 'text/html', 403));
  assert.equal(a.meta.accessBlocked, true);
  assert.equal(a.meta.status, 403);
  const b = await run('https://a.com/', 'page', () => text('auth', 'text/html', 401));
  assert.equal(b.meta.accessBlocked, true);
  const c = await run('https://a.com/', 'page', () => text('challenge', 'text/html', 503, { 'cf-mitigated': 'challenge' }));
  assert.equal(c.meta.accessBlocked, true);
  assert.equal(c.meta.headers['cf-mitigated'], 'challenge');
  const d = await run('https://a.com/', 'page', () => text('busy', 'text/html', 503));
  assert.equal(d.meta.accessBlocked, false);
  assert.equal(d.meta.status, 503);
  const e = await run('https://a.com/', 'page', () => text('ok', 'text/html', 200));
  assert.equal(e.meta.accessBlocked, false);
});

test('W04 over-long x-robots-tag is cut to 512 chars and truncatedHeaders=true', async () => {
  const long = 'noindex, ' + 'x'.repeat(600);
  const r = await run('https://a.com/', 'page', () => text('ok', 'text/html', 200, { 'x-robots-tag': long }));
  assert.equal(r.meta.truncatedHeaders, true);
  assert.equal(r.meta.headers['x-robots-tag'].length, 512);
  assert.equal(r.meta.headers['x-robots-tag'], long.slice(0, 512));
  const exact = 'n'.repeat(512);
  const r2 = await run('https://a.com/', 'page', () => text('ok', 'text/html', 200, { 'x-robots-tag': exact }));
  assert.equal(r2.meta.truncatedHeaders, false);
  assert.equal(r2.meta.headers['x-robots-tag'], exact);
});
