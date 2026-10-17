import { stripWww, pathAndQuery } from '../public/core/url.js';
import { isAllowedByRules, OUR_RULES_MAX } from '../public/core/robots.js';

export const BUDGETS = { robots: 8, sitemap: 4, page: 30, probe: 2 };
export const AUDIT_TTL_MS = 5 * 60 * 1000;
export const MIN_INTERVAL_MS = 200;
export const LIMITS = { ipAdmits: 6, ipWindowMs: 10 * 60 * 1000, hostConcurrent: 3, hostPerHour: 20, hourMs: 60 * 60 * 1000, dailyCap: 1000 };

function utcDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}

async function getMany(storage, keys) {
  const result = await storage.get(keys);
  if (result instanceof Map) return result;
  const map = new Map();
  for (const key of keys) if (result?.[key] !== undefined) map.set(key, result[key]);
  return map;
}

export class GateCore {
  constructor({ storage, now = () => Date.now(), limits = LIMITS }) {
    this.storage = storage;
    this.now = now;
    this.limits = { ...LIMITS, ...limits };
  }

  async admit({ ip, host }) {
    const now = this.now();
    const ipKey = `ip:${ip}`;
    const hostKey = `h:${stripWww(String(host).toLowerCase())}`;
    const dayKey = `d:${utcDay(now)}`;
    const values = await getMany(this.storage, [ipKey, hostKey, dayKey]);
    const attempts = (values.get(ipKey) ?? []).filter((time) => time > now - this.limits.ipWindowMs);
    if (attempts.length >= this.limits.ipAdmits) return { ok: false, error: 'rate_limited' };
    attempts.push(now);
    const daily = Number(values.get(dayKey) ?? 0);
    const state = values.get(hostKey) ?? { open: [], hour: [] };
    const open = (state.open ?? []).filter((entry) => entry.exp > now);
    const hour = (state.hour ?? []).filter((time) => time > now - this.limits.hourMs);
    let failure = null;
    if (daily >= this.limits.dailyCap) failure = 'daily_cap';
    else if (open.length >= this.limits.hostConcurrent || hour.length >= this.limits.hostPerHour) failure = 'host_busy';
    await this.storage.put({ [ipKey]: attempts });
    return failure ? { ok: false, error: failure } : { ok: true };
  }

  async open({ auditId, host }) {
    const now = this.now();
    const normalizedHost = stripWww(String(host).toLowerCase());
    const hostKey = `h:${normalizedHost}`;
    const dayKey = `d:${utcDay(now)}`;
    const auditKey = `a:${auditId}`;
    const values = await getMany(this.storage, [hostKey, dayKey]);
    const daily = Number(values.get(dayKey) ?? 0);
    if (daily >= this.limits.dailyCap) return { ok: false, error: 'daily_cap' };
    const state = values.get(hostKey) ?? { open: [], hour: [] };
    const open = (state.open ?? []).filter((entry) => entry.exp > now);
    const hour = (state.hour ?? []).filter((time) => time > now - this.limits.hourMs);
    if (open.length >= this.limits.hostConcurrent || hour.length >= this.limits.hostPerHour) return { ok: false, error: 'host_busy' };
    const expiresAt = now + AUDIT_TTL_MS;
    const audit = { host: normalizedHost, expiresAt, used: { robots: 0, sitemap: 0, page: 0, probe: 0 }, lastAt: null };
    await this.storage.put({
      [auditKey]: audit,
      [dayKey]: daily + 1,
      [hostKey]: { open: [...open, { id: auditId, exp: expiresAt }], hour: [...hour, now] },
    });
    return { ok: true, audit: { auditId, host: normalizedHost, expiresAt } };
  }

  async consume({ auditId, kind, url }) {
    const now = this.now();
    const auditKey = `a:${auditId}`;
    const audit = await this.storage.get(auditKey);
    if (!audit) return { ok: false, error: 'unknown_audit' };
    if (audit.expiresAt <= now) return { ok: false, error: 'expired' };
    if (typeof kind !== 'string' || !Object.hasOwn(BUDGETS, kind)) return { ok: false, error: 'bad_kind' };
    let parsed;
    try { parsed = new URL(url); } catch { return { ok: false, error: 'host_mismatch' }; }
    if (stripWww(parsed.hostname) !== audit.host) return { ok: false, error: 'host_mismatch' };
    if (kind === 'robots' && (parsed.pathname !== '/robots.txt' || parsed.search)) return { ok: false, error: 'kind_path' };
    if (kind === 'sitemap' && !parsed.pathname.toLowerCase().endsWith('.xml') && !parsed.pathname.toLowerCase().includes('sitemap')) return { ok: false, error: 'kind_path' };
    if ((audit.used?.[kind] ?? 0) >= BUDGETS[kind]) return { ok: false, error: 'budget_exhausted' };
    if (audit.lastAt !== null && now - audit.lastAt < MIN_INTERVAL_MS) return { ok: false, error: 'too_fast' };
    if (kind !== 'robots') {
      const robots = await this.storage.get(`r:${auditId}:${parsed.origin}`);
      if (!robots) return { ok: false, error: 'robots_required' };
      if (robots.policy !== 'allow_all') {
        if (robots.policy !== 'rules' || !isAllowedByRules(robots.rules, pathAndQuery(parsed))) return { ok: false, error: 'robots_disallowed' };
      }
    }
    const updated = {
      ...audit,
      used: { ...audit.used, [kind]: (audit.used?.[kind] ?? 0) + 1 },
      lastAt: now,
    };
    await this.storage.put({ [auditKey]: updated });
    return { ok: true, host: audit.host };
  }

  async storeRobots({ auditId, origins, policy, rules }) {
    const now = this.now();
    const audit = await this.storage.get(`a:${auditId}`);
    if (!audit) return { ok: false, error: 'unknown_audit' };
    if (audit.expiresAt <= now) return { ok: false, error: 'expired' };
    const storedRules = Array.isArray(rules) ? rules : [];
    const storedPolicy = storedRules.length > OUR_RULES_MAX ? 'unknown' : policy;
    const writes = {};
    try {
      for (const value of new Set(origins ?? [])) {
        const origin = new URL(value).origin;
        writes[`r:${auditId}:${origin}`] = { policy: storedPolicy, rules: storedPolicy === 'rules' ? storedRules : [] };
      }
    } catch {
      return { ok: false, error: 'bad_origin' };
    }
    await this.storage.put(writes);
    return { ok: true };
  }

  async cleanup() {
    const now = this.now();
    const deletions = [];
    const writes = {};
    const audits = await this.storage.list({ prefix: 'a:' });
    for (const [key, audit] of audits) {
      if (audit.expiresAt > now) continue;
      deletions.push(key);
      const id = key.slice(2);
      for (const robotsKey of (await this.storage.list({ prefix: `r:${id}:` })).keys()) deletions.push(robotsKey);
    }
    for (const [key, attempts] of await this.storage.list({ prefix: 'ip:' })) {
      const kept = (attempts ?? []).filter((time) => time > now - this.limits.ipWindowMs);
      if (kept.length) writes[key] = kept; else deletions.push(key);
    }
    for (const [key, state] of await this.storage.list({ prefix: 'h:' })) {
      const kept = {
        open: (state.open ?? []).filter((entry) => entry.exp > now),
        hour: (state.hour ?? []).filter((time) => time > now - this.limits.hourMs),
      };
      if (kept.open.length || kept.hour.length) writes[key] = kept; else deletions.push(key);
    }
    const oldest = utcDay(now - 2 * 24 * 60 * 60 * 1000);
    for (const key of (await this.storage.list({ prefix: 'd:' })).keys()) if (key.slice(2) < oldest) deletions.push(key);
    if (Object.keys(writes).length) await this.storage.put(writes);
    if (deletions.length) await this.storage.delete([...new Set(deletions)]);
  }
}
