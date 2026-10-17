// SPEC-001 §4.5 gate.js / gate_do.js — W06, W09
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GateCore, BUDGETS, LIMITS, AUDIT_TTL_MS, MIN_INTERVAL_MS } from '../src/gate.js';
import { AuditGate } from '../src/gate_do.js';
import { parseRobots, rulesFor, OUR_RULES_MAX } from '../public/core/robots.js';
import { FakeStorage, makeCtx } from './helpers/fakestorage.mjs';

const hex = (n) => n.toString(16).padStart(32, '0');
const A1 = hex(1);
const A2 = hex(2);

function setup(limits) {
  const storage = new FakeStorage();
  const clock = { t: 0 };
  const opts = { storage, now: () => clock.t };
  if (limits) opts.limits = limits;
  const core = new GateCore(opts);
  return { storage, clock, core, opts };
}

async function openAudit(core, { id = A1, host = 'a.com', ip = '1.1.1.1' } = {}) {
  const a = await core.admit({ ip, host });
  assert.equal(a.ok, true, 'admit');
  const o = await core.open({ auditId: id, host });
  assert.equal(o.ok, true, 'open');
  return o;
}

const allowAll = (id, origin = 'https://a.com') => ({ auditId: id, origins: [origin], policy: 'allow_all', rules: [] });

test('W06 constants', () => {
  assert.deepEqual(BUDGETS, { robots: 8, sitemap: 4, page: 30, probe: 2 });
  assert.equal(AUDIT_TTL_MS, 5 * 60 * 1000);
  assert.equal(MIN_INTERVAL_MS, 200);
  assert.deepEqual(LIMITS, { ipAdmits: 6, ipWindowMs: 10 * 60 * 1000, hostConcurrent: 3, hostPerHour: 20, hourMs: 60 * 60 * 1000, dailyCap: 1000 });
});

test('W06 admit -> open -> consume succeeds (first consume is not too_fast at t=0)', async () => {
  const { core, storage } = setup();
  assert.equal((await core.admit({ ip: '1.1.1.1', host: 'a.com' })).ok, true);
  const o = await core.open({ auditId: A1, host: 'a.com' });
  assert.equal(o.ok, true);
  assert.equal(o.audit.auditId, A1);
  assert.equal(o.audit.host, 'a.com');
  assert.equal(o.audit.expiresAt, AUDIT_TTL_MS);
  const rec = storage.peek('a:' + A1);
  assert.equal(rec.host, 'a.com');
  assert.equal(rec.expiresAt, AUDIT_TTL_MS);
  assert.deepEqual(rec.used, { robots: 0, sitemap: 0, page: 0, probe: 0 });
  assert.equal(rec.lastAt, null);
  assert.equal(storage.peek('d:1970-01-01'), 1);
  const h = storage.peek('h:a.com');
  assert.equal(h.open.length, 1);
  assert.equal(h.open[0].id, A1);
  assert.equal(h.hour.length, 1);
  assert.equal(storage.peek('ip:1.1.1.1').length, 1);

  const c = await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' });
  assert.equal(c.ok, true);
  assert.equal(c.host, 'a.com');
  const rec2 = storage.peek('a:' + A1);
  assert.equal(rec2.used.robots, 1);
  assert.equal(rec2.lastAt, 0);
});

test('W06 same IP: 7th admit within 10 minutes -> rate_limited; window is t > now - window', async () => {
  const { core, clock } = setup();
  for (let i = 0; i < 6; i++) assert.equal((await core.admit({ ip: '9.9.9.9', host: 'a.com' })).ok, true, `admit ${i + 1}`);
  const r = await core.admit({ ip: '9.9.9.9', host: 'a.com' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'rate_limited');
  // another IP is unaffected
  assert.equal((await core.admit({ ip: '9.9.9.8', host: 'a.com' })).ok, true);
  clock.t = LIMITS.ipWindowMs - 1;
  assert.equal((await core.admit({ ip: '9.9.9.9', host: 'a.com' })).error, 'rate_limited');
  clock.t = LIMITS.ipWindowMs; // 0 > now - window is false -> old entries expired
  assert.equal((await core.admit({ ip: '9.9.9.9', host: 'a.com' })).ok, true);
});

test('W06 admit records the IP before other checks (refused admits still count)', async () => {
  const { core } = setup();
  for (let i = 0; i < 3; i++) await openAudit(core, { id: hex(100 + i), ip: `5.5.5.${i}` });
  for (let i = 0; i < 6; i++) {
    const r = await core.admit({ ip: '7.7.7.7', host: 'a.com' });
    assert.equal(r.error, 'host_busy', `admit ${i + 1}`);
  }
  assert.equal((await core.admit({ ip: '7.7.7.7', host: 'b.com' })).error, 'rate_limited');
});

test('W06 daily cap -> daily_cap (admit and open); resets on the next UTC day', async () => {
  const { core, clock } = setup({ ...LIMITS, dailyCap: 2 });
  await openAudit(core, { id: A1, host: 'a.com', ip: '1.1.1.1' });
  await openAudit(core, { id: A2, host: 'b.com', ip: '1.1.1.2' });
  assert.equal((await core.admit({ ip: '1.1.1.3', host: 'c.com' })).error, 'daily_cap');
  assert.equal((await core.open({ auditId: hex(3), host: 'c.com' })).error, 'daily_cap');
  clock.t = 24 * 60 * 60 * 1000; // 1970-01-02T00:00:00Z
  assert.equal((await core.admit({ ip: '1.1.1.4', host: 'c.com' })).ok, true);
  assert.equal((await core.open({ auditId: hex(4), host: 'c.com' })).ok, true);
});

test('W06 4th concurrent audit for the same site -> host_busy; free again after expiry', async () => {
  const { core, clock } = setup();
  for (let i = 0; i < 3; i++) await openAudit(core, { id: hex(10 + i), ip: `2.2.2.${i}` });
  assert.equal((await core.admit({ ip: '2.2.2.9', host: 'a.com' })).error, 'host_busy');
  assert.equal((await core.open({ auditId: hex(19), host: 'a.com' })).error, 'host_busy');
  // other sites are not affected
  assert.equal((await core.admit({ ip: '2.2.2.8', host: 'b.com' })).ok, true);
  clock.t = AUDIT_TTL_MS + 1;
  assert.equal((await core.admit({ ip: '2.2.2.7', host: 'a.com' })).ok, true);
  assert.equal((await core.open({ auditId: hex(20), host: 'a.com' })).ok, true);
});

test('W06 per-site hourly limit -> host_busy', async () => {
  const { core, clock } = setup({ ...LIMITS, hostPerHour: 2, hostConcurrent: 10 });
  await openAudit(core, { id: hex(30), ip: '3.3.3.1' });
  await openAudit(core, { id: hex(31), ip: '3.3.3.2' });
  assert.equal((await core.admit({ ip: '3.3.3.3', host: 'a.com' })).error, 'host_busy');
  clock.t = LIMITS.hourMs;
  assert.equal((await core.admit({ ip: '3.3.3.4', host: 'a.com' })).ok, true);
});

test('W06 expired audit -> expired; unknown audit -> unknown_audit', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  clock.t = AUDIT_TTL_MS + 1;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).error, 'expired');
  assert.equal((await core.consume({ auditId: hex(999), kind: 'robots', url: 'https://a.com/robots.txt' })).error, 'unknown_audit');
});

test('W06 kind not in BUDGETS -> bad_kind', async () => {
  const { core } = setup();
  await openAudit(core);
  assert.equal((await core.consume({ auditId: A1, kind: 'video', url: 'https://a.com/robots.txt' })).error, 'bad_kind');
});

test('W06 www.a.com passes the a.com audit; b.com -> host_mismatch', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://www.a.com/robots.txt' })).ok, true);
  clock.t += 1000;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://b.com/robots.txt' })).error, 'host_mismatch');
  clock.t += 1000;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://sub.a.com/robots.txt' })).error, 'host_mismatch');
});

test('W06 within 200 ms -> too_fast; exactly 200 ms ok', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).ok, true);
  clock.t = 199;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).error, 'too_fast');
  clock.t = 200;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).ok, true);
});

test('W06 kind budget used up -> budget_exhausted (checked before too_fast)', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  for (let i = 0; i < BUDGETS.robots; i++) {
    clock.t = i * 200;
    assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).ok, true, `robots ${i + 1}`);
  }
  // same instant as the 8th: budget check comes first
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).error, 'budget_exhausted');
  clock.t += 1000;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).error, 'budget_exhausted');
  // other kinds still have budget
  await core.storeRobots(allowAll(A1));
  assert.equal((await core.consume({ auditId: A1, kind: 'probe', url: 'https://a.com/x' })).ok, true);
});

test('W06 robots path must be exactly /robots.txt without query -> kind_path', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  for (const u of ['https://a.com/robots.txt?x=1', 'https://a.com/robot.txt', 'https://a.com/x/robots.txt', 'https://a.com/']) {
    clock.t += 1000;
    assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: u })).error, 'kind_path', u);
  }
});

test('W06 sitemap path /page -> kind_path; .xml or "sitemap" accepted', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  await core.storeRobots(allowAll(A1));
  assert.equal((await core.consume({ auditId: A1, kind: 'sitemap', url: 'https://a.com/page' })).error, 'kind_path');
  for (const u of ['https://a.com/sitemap.xml', 'https://a.com/feeds/SiteMap', 'https://a.com/a.XML', 'https://a.com/post-sitemap.php']) {
    clock.t += 1000;
    assert.equal((await core.consume({ auditId: A1, kind: 'sitemap', url: u })).ok, true, u);
  }
});

test('W06 consume page without storeRobots -> robots_required', async () => {
  const { core } = setup();
  await openAudit(core);
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/' })).error, 'robots_required');
  assert.equal((await core.consume({ auditId: A1, kind: 'probe', url: 'https://a.com/' })).error, 'robots_required');
  assert.equal((await core.consume({ auditId: A1, kind: 'sitemap', url: 'https://a.com/sitemap.xml' })).error, 'robots_required');
});

test('W06 storeRobots rules blocking /private: /private -> robots_disallowed, /public ok', async () => {
  const { core, clock, storage } = setup();
  await openAudit(core);
  const rules = rulesFor(parseRobots('User-agent: *\nDisallow: /private\n'), 'kinsuiseocheck').rules;
  assert.equal((await core.storeRobots({ auditId: A1, origins: ['https://a.com'], policy: 'rules', rules })).ok, true);
  assert.equal(storage.peek('r:' + A1 + ':https://a.com').policy, 'rules');
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/private' })).error, 'robots_disallowed');
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/private/x?y=1' })).error, 'robots_disallowed');
  clock.t += 1000;
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/public' })).ok, true);
});

test('W06 policy unknown / disallow_all -> robots_disallowed; allow_all -> ok', async () => {
  for (const [policy, expectOk] of [['unknown', false], ['disallow_all', false], ['allow_all', true]]) {
    const { core } = setup();
    await openAudit(core);
    await core.storeRobots({ auditId: A1, origins: ['https://a.com'], policy, rules: [] });
    const r = await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/x' });
    if (expectOk) assert.equal(r.ok, true, policy);
    else assert.equal(r.error, 'robots_disallowed', policy);
  }
});

test('W06/R29 storeRobots with more than OUR_RULES_MAX rules stores policy unknown (DO refuses)', async () => {
  const { core, storage } = setup();
  await openAudit(core);
  const txt = ['User-agent: KinsuiSEOCheck', ...Array.from({ length: OUR_RULES_MAX + 1 }, (_, i) => `Disallow: /r${i}`)].join('\n');
  const rules = rulesFor(parseRobots(txt), 'kinsuiseocheck').rules;
  assert.equal(rules.length, 1001);
  await core.storeRobots({ auditId: A1, origins: ['https://a.com'], policy: 'rules', rules });
  assert.equal(storage.peek('r:' + A1 + ':https://a.com').policy, 'unknown');
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/allowed-path' })).error, 'robots_disallowed');
});

test('W06 storeRobots on unknown or expired audit -> ok false', async () => {
  const { core, clock } = setup();
  assert.equal((await core.storeRobots(allowAll(hex(77)))).ok, false);
  await openAudit(core);
  clock.t = AUDIT_TTL_MS + 1;
  assert.equal((await core.storeRobots(allowAll(A1))).ok, false);
});

test('W06 storeRobots writes one r: record per origin', async () => {
  const { core, storage } = setup();
  await openAudit(core);
  await core.storeRobots({ auditId: A1, origins: ['http://a.com', 'https://a.com', 'https://www.a.com'], policy: 'allow_all', rules: [] });
  for (const o of ['http://a.com', 'https://a.com', 'https://www.a.com']) assert.equal(storage.peek(`r:${A1}:${o}`).policy, 'allow_all', o);
});

test('W06 a new GateCore on the same storage can still consume (DO eviction)', async () => {
  const { core, storage, clock, opts } = setup();
  await openAudit(core);
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).ok, true);
  await core.storeRobots(allowAll(A1));
  const core2 = new GateCore({ storage, now: opts.now });
  clock.t = 500;
  const r = await core2.consume({ auditId: A1, kind: 'page', url: 'https://a.com/' });
  assert.equal(r.ok, true);
  clock.t = 550;
  assert.equal((await new GateCore({ storage, now: opts.now }).consume({ auditId: A1, kind: 'page', url: 'https://a.com/' })).error, 'too_fast');
  assert.equal(storage.peek('a:' + A1).used.page, 1);
});

test('W06 storage.put throwing leaves storage exactly as before (admit/open/consume/storeRobots)', async () => {
  const { core, storage, clock } = setup();
  await openAudit(core);
  await core.storeRobots(allowAll(A1));
  clock.t = 1000;
  const ops = [
    () => core.admit({ ip: '8.8.4.4', host: 'b.com' }),
    () => core.open({ auditId: A2, host: 'b.com' }),
    () => core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/' }),
    () => core.storeRobots({ auditId: A1, origins: ['http://a.com'], policy: 'allow_all', rules: [] }),
  ];
  for (const [i, op] of ops.entries()) {
    const before = storage.snapshot();
    storage.failPut = true;
    try {
      await op();
    } catch {}
    storage.failPut = false;
    assert.equal(storage.snapshot(), before, `op ${i}`);
  }
});

test('W06 cleanup removes expired audits, their r: records, old window entries and old d: keys', async () => {
  const { core, storage, clock } = setup();
  await openAudit(core);
  await core.storeRobots(allowAll(A1));
  const DAY = 24 * 60 * 60 * 1000;
  clock.t = 3 * DAY + 1000;
  await openAudit(core, { id: A2, host: 'b.com', ip: '4.4.4.4' });
  await core.cleanup();
  assert.equal(storage.peek('a:' + A1), undefined);
  assert.equal(storage.peek('r:' + A1 + ':https://a.com'), undefined);
  assert.equal(storage.peek('d:1970-01-01'), undefined);
  const ip = storage.peek('ip:1.1.1.1');
  assert.ok(ip === undefined || (Array.isArray(ip) && ip.length === 0));
  const h = storage.peek('h:a.com');
  assert.ok(h === undefined || (h.open.length === 0 && h.hour.length === 0));
  // live data stays
  assert.ok(storage.peek('a:' + A2));
  assert.equal(storage.peek('d:1970-01-04'), 1);
  assert.equal(storage.peek('ip:4.4.4.4').length, 1);
});

test('W09 storeRobots allow_all only for http://a.com: https://a.com/x -> robots_required', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  await core.storeRobots({ auditId: A1, origins: ['http://a.com'], policy: 'allow_all', rules: [] });
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/x' })).error, 'robots_required');
  clock.t += 1000;
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'http://a.com/x' })).ok, true);
});

// ------------------------------------------------------------------ AuditGate (DO wrapper)
async function doPost(gate, path, body) {
  const res = await gate.fetch(
    new Request('https://audit-gate.internal' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
  return res.json();
}

function withFixedNow(t0, fn) {
  const real = Date.now;
  const clock = { t: t0 };
  Date.now = () => clock.t;
  return Promise.resolve(fn(clock)).finally(() => {
    Date.now = real;
  });
}

test('W09 alarm: admit only (no open) schedules an alarm; cleanup then drops the old ip: record', async () => {
  const T0 = Date.UTC(2026, 9, 17, 3, 0, 0);
  await withFixedNow(T0, async (clock) => {
    const storage = new FakeStorage();
    const gate = new AuditGate(makeCtx(storage), { DAILY_AUDIT_CAP: '1000' });
    const r = await doPost(gate, '/admit', { ip: '6.6.6.6', host: 'a.com' });
    assert.equal(r.ok, true);
    assert.ok(storage.peek('ip:6.6.6.6'));
    const alarm = await storage.getAlarm();
    assert.notEqual(alarm, null, 'alarm must be scheduled after admit');
    assert.ok(Math.abs(alarm - (T0 + 60 * 60 * 1000)) <= 1000, `alarm at now + 1h (got ${alarm - T0} ms)`);
    // fire the alarm one hour later
    clock.t = T0 + 60 * 60 * 1000;
    storage.alarm = null; // the runtime clears the alarm before calling alarm()
    await gate.alarm();
    const ip = storage.peek('ip:6.6.6.6');
    // AMBIGUOUS: "清掉時間窗外的 ip: 項目" — key removed or left empty
    assert.ok(ip === undefined || (Array.isArray(ip) && ip.length === 0));
  });
});

test('W09 alarm is rescheduled while a:/ip:/h:/d: keys remain', async () => {
  const T0 = Date.UTC(2026, 9, 17, 3, 0, 0);
  await withFixedNow(T0, async (clock) => {
    const storage = new FakeStorage();
    const gate = new AuditGate(makeCtx(storage), { DAILY_AUDIT_CAP: '1000' });
    assert.equal((await doPost(gate, '/admit', { ip: '6.6.6.7', host: 'a.com' })).ok, true);
    assert.equal((await doPost(gate, '/open', { auditId: A1, host: 'a.com' })).ok, true);
    clock.t = T0 + 60 * 60 * 1000;
    storage.alarm = null;
    await gate.alarm();
    // today's d: key is younger than 2 days, so it is kept -> another alarm must be set
    assert.ok(storage.keys().some((k) => k.startsWith('d:')));
    assert.notEqual(await storage.getAlarm(), null);
  });
});

test('W06/W09 AuditGate routes map to GateCore (admit/open/consume/storeRobots) and set an alarm', async () => {
  const T0 = Date.UTC(2026, 9, 17, 4, 0, 0);
  await withFixedNow(T0, async (clock) => {
    const storage = new FakeStorage();
    const gate = new AuditGate(makeCtx(storage), { DAILY_AUDIT_CAP: '1000' });
    assert.equal((await doPost(gate, '/admit', { ip: '6.6.6.8', host: 'a.com' })).ok, true);
    const o = await doPost(gate, '/open', { auditId: A1, host: 'a.com' });
    assert.equal(o.ok, true);
    assert.equal(o.audit.expiresAt, T0 + AUDIT_TTL_MS);
    const c = await doPost(gate, '/consume', { auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' });
    assert.equal(c.ok, true);
    assert.equal(c.host, 'a.com');
    assert.equal((await doPost(gate, '/storeRobots', allowAll(A1))).ok, true);
    clock.t += 1000;
    assert.equal((await doPost(gate, '/consume', { auditId: A1, kind: 'page', url: 'https://a.com/' })).ok, true);
    assert.equal((await doPost(gate, '/consume', { auditId: hex(5), kind: 'page', url: 'https://a.com/' })).error, 'unknown_audit');
    assert.notEqual(await storage.getAlarm(), null);
  });
});

test('W06 AuditGate dailyCap comes from env.DAILY_AUDIT_CAP', async () => {
  await withFixedNow(Date.UTC(2026, 9, 17, 5, 0, 0), async () => {
    const storage = new FakeStorage();
    const gate = new AuditGate(makeCtx(storage), { DAILY_AUDIT_CAP: '1' });
    assert.equal((await doPost(gate, '/admit', { ip: '6.6.1.1', host: 'a.com' })).ok, true);
    assert.equal((await doPost(gate, '/open', { auditId: A1, host: 'a.com' })).ok, true);
    assert.equal((await doPost(gate, '/admit', { ip: '6.6.1.2', host: 'b.com' })).error, 'daily_cap');
  });
});

// ------------------------------------------------------------------ v1.5 A1 / mutation gap GT02
test('A1 storeRobots accepts { allow, path } rule objects and consume applies them (longest match, allow wins)', async () => {
  const { core, clock, storage } = setup();
  await openAudit(core);
  const rules = [
    { allow: false, path: '/private' },
    { allow: true, path: '/private/ok' },
  ];
  assert.equal((await core.storeRobots({ auditId: A1, origins: ['https://a.com'], policy: 'rules', rules })).ok, true);
  assert.deepEqual(storage.peek(`r:${A1}:https://a.com`), { policy: 'rules', rules });
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/private/x' })).error, 'robots_disallowed');
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/private/ok/1' })).ok, true);
  clock.t += 1000;
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/public' })).ok, true);
});

test('GT02 robots stored only for https://a.com: consume http://a.com/x -> robots_required (reverse of W09)', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  await core.storeRobots({ auditId: A1, origins: ['https://a.com'], policy: 'allow_all', rules: [] });
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'http://a.com/x' })).error, 'robots_required');
  assert.equal((await core.consume({ auditId: A1, kind: 'probe', url: 'http://a.com/' })).error, 'robots_required');
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'http://www.a.com/x' })).error, 'robots_required');
  clock.t += 1000;
  assert.equal((await core.consume({ auditId: A1, kind: 'page', url: 'https://a.com/x' })).ok, true);
});

test('GT02 (DO route) robots stored only for https://a.com: /consume http://a.com/x -> robots_required', async () => {
  await withFixedNow(Date.UTC(2026, 9, 17, 6, 0, 0), async () => {
    const storage = new FakeStorage();
    const gate = new AuditGate(makeCtx(storage), { DAILY_AUDIT_CAP: '1000' });
    assert.equal((await doPost(gate, '/admit', { ip: '6.6.2.1', host: 'a.com' })).ok, true);
    assert.equal((await doPost(gate, '/open', { auditId: A1, host: 'a.com' })).ok, true);
    assert.equal((await doPost(gate, '/storeRobots', { auditId: A1, origins: ['https://a.com'], policy: 'allow_all', rules: [] })).ok, true);
    assert.equal((await doPost(gate, '/consume', { auditId: A1, kind: 'page', url: 'http://a.com/x' })).error, 'robots_required');
  });
});

test('W06 expired boundary: expiresAt <= now is expired (v1.5 states it)', async () => {
  const { core, clock } = setup();
  await openAudit(core);
  clock.t = AUDIT_TTL_MS - 1;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).ok, true);
  clock.t = AUDIT_TTL_MS;
  assert.equal((await core.consume({ auditId: A1, kind: 'robots', url: 'https://a.com/robots.txt' })).error, 'expired');
});
