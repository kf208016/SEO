// SPEC-002 §4.1 / §1.3 / §10 N14 — VERSION 1.9.0, /api/config lineId, wrangler.jsonc LINE_ID, new SOURCES
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/worker.js';
import { VERSION } from '../public/core/version.js';
import { SOURCES } from '../public/core/sources.js';
import { makeEnv, apiRequest, execCtx, installFetchStub } from './helpers/worker_env.mjs';
import { NEW_SOURCES, LINE_ID, LINE_ID_RE } from './helpers/copy_v19.mjs';

const WRANGLER = new URL('../wrangler.jsonc', import.meta.url);

// JSONC -> JSON: drop // and /* */ comments outside strings, then trailing commas
function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

let stub = null;
afterEach(() => {
  if (stub) stub.restore();
  stub = null;
});

test('N14 VERSION === "1.9.0"', () => {
  assert.equal(VERSION, '1.9.0');
});

test('N14 GET /api/config returns lineId = env.LINE_ID (and the v1.8 fields)', async () => {
  stub = installFetchStub();
  const { env } = makeEnv({ LINE_ID: LINE_ID });
  const res = await worker.fetch(apiRequest('/api/config', { method: 'GET' }), env, execCtx);
  assert.equal(res.status, 200);
  const body = JSON.parse(await res.text());
  assert.equal(body.lineId, LINE_ID);
  assert.equal(body.turnstileSiteKey, env.TURNSTILE_SITEKEY);
  assert.equal(body.contactUrl, env.CONTACT_URL);
  assert.equal(body.maxPages, 15);
  assert.equal(body.version, '1.9.0');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('N14 GET /api/config without LINE_ID -> lineId ""; any string is passed through unvalidated (the report validates)', async () => {
  stub = installFetchStub();
  const a = makeEnv({ LINE_ID: undefined });
  const ra = await worker.fetch(apiRequest('/api/config', { method: 'GET' }), a.env, execCtx);
  assert.equal(JSON.parse(await ra.text()).lineId, '');
  const b = makeEnv({ LINE_ID: '@other_id-1.x' });
  const rb = await worker.fetch(apiRequest('/api/config', { method: 'GET' }), b.env, execCtx);
  assert.equal(JSON.parse(await rb.text()).lineId, '@other_id-1.x');
  // config works even when the service is paused (no configuration checks)
  const c = makeEnv({ LINE_ID: LINE_ID, AUDIT_ENABLED: 'false' });
  const rc = await worker.fetch(apiRequest('/api/config', { method: 'GET' }), c.env, execCtx);
  assert.equal(rc.status, 200);
  assert.equal(JSON.parse(await rc.text()).lineId, LINE_ID);
});

test('N14 wrangler.jsonc vars.LINE_ID is "@760zrres" and matches the validity pattern; other vars kept', async () => {
  const cfg = parseJsonc(await readFile(WRANGLER, 'utf8'));
  assert.equal(cfg.vars.LINE_ID, '@760zrres');
  assert.match(cfg.vars.LINE_ID, LINE_ID_RE);
  for (const k of ['TURNSTILE_SITEKEY', 'CONTACT_URL', 'AUDIT_ENABLED', 'DAILY_AUDIT_CAP', 'SELF_HOSTS']) assert.ok(k in cfg.vars, k);
  assert.equal(cfg.observability.enabled, false);
  assert.equal(cfg.vars.CONTACT_URL, 'https://lin.ee/8xXGMUU');
});

test('N14 SOURCES has the five new entries with exact title and url; the v1.8 entries are still there', () => {
  for (const [id, [title, url]] of Object.entries(NEW_SOURCES)) {
    assert.ok(SOURCES[id], 'source ' + id);
    assert.equal(SOURCES[id].title, title, id);
    assert.equal(SOURCES[id].url, url, id);
  }
  for (const id of ['google-robots', 'google-starter', 'google-helpful', 'google-sd-policies', 'bing-chat-controls']) assert.ok(SOURCES[id], id);
  for (const s of Object.values(SOURCES)) {
    assert.equal(typeof s.title, 'string');
    assert.match(s.url, /^https:\/\//);
  }
});

test('N14 lineId validity pattern from §4.1 (sanity of the test constant)', () => {
  for (const ok of ['@760zrres', '@a', '@' + 'a'.repeat(40), '@A_b.c-9']) assert.match(ok, LINE_ID_RE, ok);
  for (const bad of ['760zrres', '@', '@' + 'a'.repeat(41), '@760 zrres', 'javascript:x', '@760zrres<svg>', '@中文']) assert.doesNotMatch(bad, LINE_ID_RE, bad);
});
