const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode64(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('bad_base64');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function keyFor(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function validPayload(payload) {
  return payload && /^[a-f0-9]{32}$/.test(payload.id) && Number.isFinite(payload.exp);
}

export async function signToken({ id, exp }, secret) {
  if (!validPayload({ id, exp })) throw new TypeError('invalid_payload');
  const payload = base64url(encoder.encode(JSON.stringify({ id, exp })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(payload)));
  return `${payload}.${base64url(signature)}`;
}

export async function verifyToken(token, secret, nowMs = Date.now()) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const signature = decode64(parts[1]);
    const valid = await crypto.subtle.verify('HMAC', await keyFor(secret), signature, encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(decode64(parts[0])));
    if (!validPayload(payload) || payload.exp <= nowMs || payload.exp - nowMs > 5 * 60 * 1000) return null;
    return { id: payload.id, exp: payload.exp };
  } catch {
    return null;
  }
}
