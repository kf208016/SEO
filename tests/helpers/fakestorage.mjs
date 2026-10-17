// Fake Durable Object storage (KV-style API) used by GateCore / AuditGate tests.
// Implements: get(key) / get([keys]) -> Map, put(key, value) / put({k: v}) (atomic),
// delete(key|[keys]), list({ prefix }) -> Map (sorted), getAlarm / setAlarm / deleteAlarm.
// Values are deep-cloned on the way in and out, like real DO storage (structured clone).

function clone(v) {
  return v === undefined ? undefined : structuredClone(v);
}

export class FakeStorage {
  constructor() {
    this.data = new Map();
    this.alarm = null;
    this.alarmHistory = [];
    this.failPut = false;
    this.putCalls = 0;
  }

  async get(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      const m = new Map();
      for (const k of keyOrKeys) if (this.data.has(k)) m.set(k, clone(this.data.get(k)));
      return m;
    }
    return clone(this.data.get(keyOrKeys));
  }

  async put(keyOrObj, value) {
    this.putCalls++;
    if (this.failPut) throw new Error('simulated storage put failure');
    if (typeof keyOrObj === 'string') {
      this.data.set(keyOrObj, clone(value));
      return;
    }
    // object form: all-or-nothing
    const entries = Object.entries(keyOrObj).map(([k, v]) => [k, clone(v)]);
    for (const [k, v] of entries) this.data.set(k, v);
  }

  async delete(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      let n = 0;
      for (const k of keyOrKeys) if (this.data.delete(k)) n++;
      return n;
    }
    return this.data.delete(keyOrKeys);
  }

  async list({ prefix = '', start, end, limit, reverse = false } = {}) {
    let keys = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (start !== undefined) keys = keys.filter((k) => k >= start);
    if (end !== undefined) keys = keys.filter((k) => k < end);
    if (reverse) keys.reverse();
    if (limit !== undefined) keys = keys.slice(0, limit);
    return new Map(keys.map((k) => [k, clone(this.data.get(k))]));
  }

  async deleteAll() {
    this.data.clear();
  }

  async getAlarm() {
    return this.alarm;
  }

  async setAlarm(t) {
    const ms = t instanceof Date ? t.getTime() : Number(t);
    this.alarm = ms;
    this.alarmHistory.push(ms);
  }

  async deleteAlarm() {
    this.alarm = null;
  }

  async sync() {}

  // ---- test utilities (not part of the DO API) ----
  snapshot() {
    return JSON.stringify([...this.data.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  }

  keys() {
    return [...this.data.keys()].sort();
  }

  peek(key) {
    return clone(this.data.get(key));
  }
}

export function makeCtx(storage = new FakeStorage()) {
  return {
    storage,
    id: { toString: () => 'global', name: 'global' },
    blockConcurrencyWhile: async (fn) => fn(),
    waitUntil() {},
  };
}
