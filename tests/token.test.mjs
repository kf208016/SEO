// SPEC-001 §4.4 token.js — W05
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../src/token.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const ID = '0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000_000;
const EXP = NOW + 4 * 60 * 1000;

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');

test('W05 signed token verifies and returns { id, exp }', async () => {
  const token = await signToken({ id: ID, exp: EXP }, SECRET);
  assert.equal(typeof token, 'string');
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(token.length <= 512);
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(payload.id, ID);
  assert.equal(payload.exp, EXP);
  const v = await verifyToken(token, SECRET, NOW);
  assert.ok(v);
  assert.equal(v.id, ID);
  assert.equal(v.exp, EXP);
});

test('W05 modified payload -> null', async () => {
  const token = await signToken({ id: ID, exp: EXP }, SECRET);
  const [, sig] = token.split('.');
  const forgedPayload = b64u(JSON.stringify({ id: 'f'.repeat(32), exp: EXP }));
  assert.equal(await verifyToken(`${forgedPayload}.${sig}`, SECRET, NOW), null);
  const longer = b64u(JSON.stringify({ id: ID, exp: EXP + 1000 }));
  assert.equal(await verifyToken(`${longer}.${sig}`, SECRET, NOW), null);
});

test('W05 modified signature -> null', async () => {
  const token = await signToken({ id: ID, exp: EXP }, SECRET);
  const [p, sig] = token.split('.');
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.equal(await verifyToken(`${p}.${flipped}`, SECRET, NOW), null);
  assert.equal(await verifyToken(`${p}.`, SECRET, NOW), null);
  // wrong secret
  assert.equal(await verifyToken(token, SECRET + 'x', NOW), null);
});

test('W05 expired (exp <= now) -> null', async () => {
  const token = await signToken({ id: ID, exp: EXP }, SECRET);
  assert.equal(await verifyToken(token, SECRET, EXP), null);
  assert.equal(await verifyToken(token, SECRET, EXP + 1), null);
  assert.ok(await verifyToken(token, SECRET, EXP - 1));
});

test('W05 exp more than 5 minutes ahead -> null (exactly 5 minutes ok)', async () => {
  const token = await signToken({ id: ID, exp: EXP }, SECRET);
  assert.equal(await verifyToken(token, SECRET, EXP - 5 * 60 * 1000 - 1), null);
  assert.ok(await verifyToken(token, SECRET, EXP - 5 * 60 * 1000));
});

test('W05 malformed tokens -> null', async () => {
  const token = await signToken({ id: ID, exp: EXP }, SECRET);
  const bad = [
    '',
    'abc',
    'a.b.c',
    '.',
    token + '.x',
    token.replace('.', ''),
    '!!!.@@@',
    b64u('not json') + '.' + token.split('.')[1],
    token + 'A'.repeat(600), // > 512 chars
    null,
    undefined,
    12345,
  ];
  for (const t of bad) assert.equal(await verifyToken(t, SECRET, NOW), null, String(t).slice(0, 40));
});

test('W05 correctly signed token whose id is not 32 lower-case hex -> rejected', async () => {
  // AMBIGUOUS: §4.4 states the id format next to the null-conditions; signToken may also refuse it.
  for (const id of ['ABCDEF0123456789ABCDEF0123456789', 'abc', '0123456789abcdef0123456789abcdeg']) {
    let token = null;
    try {
      token = await signToken({ id, exp: EXP }, SECRET);
    } catch {
      continue; // refusing to sign is fine
    }
    assert.equal(await verifyToken(token, SECRET, NOW), null, id);
  }
});
