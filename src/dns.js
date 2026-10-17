const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function ipv4Number(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
}

const V4_RANGES = V4_BLOCKS.map(([ip, bits]) => {
  const base = ipv4Number(ip);
  const size = 2 ** (32 - bits);
  return [base, base + size - 1];
});

export function isPublicIPv4(ip) {
  const value = ipv4Number(ip);
  return value != null && !V4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function ipv6Number(ip) {
  let source = String(ip).toLowerCase();
  if (source.includes('.') || source.includes('%')) return null;
  if ((source.match(/::/g) ?? []).length > 1) return null;
  const halves = source.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length >= 8) return null;
  const fill = halves.length === 2 ? new Array(8 - left.length - right.length).fill('0') : [];
  const words = [...left, ...fill, ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.reduce((value, word) => (value << 16n) | BigInt(Number.parseInt(word, 16)), 0n);
}

const V6_BLOCKS = [
  ['::', 128], ['::1', 128], ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96],
  ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
].map(([ip, bits]) => [ipv6Number(ip), bits]);

export function isPublicIPv6(ip) {
  const value = ipv6Number(ip);
  if (value == null) return false;
  return !V6_BLOCKS.some(([base, bits]) => {
    const shift = BigInt(128 - bits);
    return (value >> shift) === (base >> shift);
  });
}

export async function resolvePublic(hostname, { fetchImpl = fetch, signal } = {}) {
  // 這項 DoH 預查只能降低 SSRF 風險，不能完全防止 DNS rebinding／
  // resolver TOCTOU；公開部署前仍必須完成 SPEC-001 §10.2 的 runtime 驗證。
  if (signal?.aborted) return { ok: false, reason: 'aborted' };
  const query = async (type) => {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
    const response = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, signal });
    if (!response.ok) throw new Error('dns_status');
    return response.json();
  };
  try {
    const [a, aaaa] = await Promise.all([query('A'), query('AAAA')]);
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    const addresses = [];
    for (const answer of [...(a.Answer ?? []), ...(aaaa.Answer ?? [])]) {
      if (answer?.type === 1 || answer?.type === 28) addresses.push(String(answer.data));
    }
    if (addresses.some((ip) => ip.includes(':') ? !isPublicIPv6(ip) : !isPublicIPv4(ip))) {
      return { ok: false, reason: 'private_address' };
    }
    if (Number(a.Status) === 3 && Number(aaaa.Status) === 3) return { ok: false, reason: 'nxdomain' };
    if (!addresses.length) return { ok: false, reason: 'no_address' };
    return { ok: true, addresses };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') return { ok: false, reason: 'aborted' };
    return { ok: false, reason: 'dns_error' };
  }
}
