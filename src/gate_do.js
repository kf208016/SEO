import { GateCore, LIMITS } from './gate.js';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export class AuditGate {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  core() {
    const dailyCap = Number(this.env.DAILY_AUDIT_CAP) || 1000;
    return new GateCore({ storage: this.ctx.storage, limits: { ...LIMITS, dailyCap } });
  }

  async schedule() {
    if (await this.ctx.storage.getAlarm() == null) await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  }

  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    const route = new URL(request.url).pathname;
    const method = ({ '/admit': 'admit', '/open': 'open', '/consume': 'consume', '/storeRobots': 'storeRobots' })[route];
    if (!method) return json({ error: 'not_found' }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
    try {
      const result = await this.core()[method](body);
      await this.schedule();
      return json(result);
    } catch {
      return json({ error: 'internal' }, 500);
    }
  }

  async alarm() {
    await this.core().cleanup();
    const prefixes = ['a:', 'ip:', 'h:', 'd:'];
    for (const prefix of prefixes) {
      if ((await this.ctx.storage.list({ prefix, limit: 1 })).size) {
        await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
        return;
      }
    }
  }
}
