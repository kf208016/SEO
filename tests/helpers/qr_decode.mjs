// Independent QR code reader for the blind tests (ISO/IEC 18004, byte mode, versions 1–20, EC level M).
// It does not correct errors: it reads the format information (both copies must be valid and equal),
// removes the mask, extracts the codewords in placement order, de-interleaves the blocks, recomputes the
// Reed–Solomon parity of every block, and parses the byte-mode payload including terminator and padding.
// Conventions: modules[row][col] (row = y, col = x), true = dark.

// version -> [total codewords, EC codewords per block, [[blocks, data codewords per block], ...]]
export const EC_M = {
  1: [26, 10, [[1, 16]]],
  2: [44, 16, [[1, 28]]],
  3: [70, 26, [[1, 44]]],
  4: [100, 18, [[2, 32]]],
  5: [134, 24, [[2, 43]]],
  6: [172, 16, [[4, 27]]],
  7: [196, 18, [[4, 31]]],
  8: [242, 22, [[2, 38], [2, 39]]],
  9: [292, 22, [[3, 36], [2, 37]]],
  10: [346, 26, [[4, 43], [1, 44]]],
  11: [404, 30, [[1, 50], [4, 51]]],
  12: [466, 22, [[6, 36], [2, 37]]],
  13: [532, 22, [[8, 37], [1, 38]]],
  14: [581, 24, [[4, 40], [5, 41]]],
  15: [655, 24, [[5, 41], [5, 42]]],
  16: [733, 28, [[7, 45], [3, 46]]],
  17: [815, 28, [[10, 46], [1, 47]]],
  18: [901, 26, [[9, 43], [4, 44]]],
  19: [991, 26, [[3, 44], [11, 45]]],
  20: [1085, 26, [[3, 41], [13, 42]]],
};

export function dataCodewords(version) {
  return EC_M[version][2].reduce((n, [count, len]) => n + count * len, 0);
}

// byte-mode capacity: data codewords minus mode (4 bits) + count (8 / 16 bits), floored to bytes
export function byteCapacity(version) {
  return Math.floor((dataCodewords(version) * 8 - 4 - (version <= 9 ? 8 : 16)) / 8);
}

export function alignmentPositions(version) {
  if (version === 1) return [];
  const size = 17 + 4 * version;
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// boolean[row][col]: true where a function pattern (finder, separator, timing, alignment, format, version, dark module) lives
export function functionModules(version) {
  const size = 17 + 4 * version;
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y) => {
    if (x >= 0 && x < size && y >= 0 && y < size) f[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i);
    set(i, 6);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy);
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = alignmentPositions(version);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy);
    }
  }
  for (let i = 0; i <= 8; i++) {
    set(8, i);
    set(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8);
    set(8, size - 1 - i);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b);
      set(b, a);
    }
  }
  return f;
}

const ECL_NAME = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

export function formatBits(eclBits, mask) {
  const data = (eclBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const FORMAT_TABLE = new Map();
for (const ecl of [0, 1, 2, 3]) for (let mask = 0; mask < 8; mask++) FORMAT_TABLE.set(formatBits(ecl, mask), { eclBits: ecl, ecl: ECL_NAME[ecl], mask });

// Reads both copies of the 15-bit format information; both must be valid and identical.
export function readFormat(m) {
  const size = m.length;
  const b = (y, x) => (m[y][x] ? 1 : 0);
  let a = 0;
  let c = 0;
  for (let i = 0; i <= 5; i++) a |= b(i, 8) << i;
  a |= b(7, 8) << 6;
  a |= b(8, 8) << 7;
  a |= b(8, 7) << 8;
  for (let i = 9; i < 15; i++) a |= b(8, 14 - i) << i;
  for (let i = 0; i < 8; i++) c |= b(8, size - 1 - i) << i;
  for (let i = 8; i < 15; i++) c |= b(size - 15 + i, 8) << i;
  const fa = FORMAT_TABLE.get(a);
  const fc = FORMAT_TABLE.get(c);
  if (!fa) throw new Error('format information (copy 1) is not a valid BCH code word: ' + a.toString(2));
  if (!fc) throw new Error('format information (copy 2) is not a valid BCH code word: ' + c.toString(2));
  if (a !== c) throw new Error('the two format information copies differ');
  return fa;
}

export function maskFn(mask) {
  switch (mask) {
    case 0:
      return (x, y) => (x + y) % 2 === 0;
    case 1:
      return (x, y) => y % 2 === 0;
    case 2:
      return (x) => x % 3 === 0;
    case 3:
      return (x, y) => (x + y) % 3 === 0;
    case 4:
      return (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error('mask ' + mask);
  }
}

// Data/EC bits in placement order (two-column zig-zag, skipping function modules), already unmasked.
export function readRawBits(m, f, mask) {
  const size = m.length;
  const mk = maskFn(mask);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!f[y][x]) bits.push((m[y][x] ? 1 : 0) ^ (mk(x, y) ? 1 : 0));
      }
    }
  }
  return bits;
}

export function deinterleave(codewords, version) {
  const [, ecLen, groups] = EC_M[version];
  const dlens = groups.flatMap(([count, len]) => Array(count).fill(len));
  const blocks = dlens.map(() => ({ data: [], ec: [] }));
  const maxD = Math.max(...dlens);
  let k = 0;
  for (let i = 0; i < maxD; i++) for (let b = 0; b < blocks.length; b++) if (i < dlens[b]) blocks[b].data.push(codewords[k++]);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < blocks.length; b++) blocks[b].ec.push(codewords[k++]);
  if (k !== codewords.length) throw new Error(`codeword count ${codewords.length} does not match the block structure (${k})`);
  return blocks;
}

// GF(256) with primitive polynomial 0x11D
export function gfMul(a, b) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z & 0xff;
}

export function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor);
    });
  }
  return result;
}

// Byte-mode payload: mode 0100, count (8 bits v1–9 / 16 bits v10+), bytes, terminator, bit padding, 0xEC/0x11 pad bytes.
export function parsePayload(dataBytes, version) {
  const bits = [];
  for (const b of dataBytes) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  let p = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bits[p++];
    return v;
  };
  const mode = read(4);
  if (mode !== 4) throw new Error('mode indicator is not byte mode (0100): ' + mode.toString(2).padStart(4, '0'));
  const countBits = version <= 9 ? 8 : 16;
  const count = read(countBits);
  if (p + count * 8 > bits.length) throw new Error(`character count ${count} exceeds the data capacity`);
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = read(8);
  const cap = bits.length;
  const t = Math.min(4, cap - p);
  for (let i = 0; i < t; i++) if (bits[p + i] !== 0) throw new Error('terminator bits are not zero');
  p += t;
  while (p % 8 !== 0 && p < cap) {
    if (bits[p] !== 0) throw new Error('bit padding to the byte boundary is not zero');
    p++;
  }
  let k = 0;
  while (p + 8 <= cap) {
    const v = read(8); // read() advances p by 8
    const expected = k % 2 === 0 ? 0xec : 0x11;
    if (v !== expected) throw new Error(`pad codeword ${k} is 0x${v.toString(16)} (expected 0x${expected.toString(16)})`);
    k++;
  }
  return { count, bytes, text: new TextDecoder().decode(bytes), padCodewords: k };
}

// Full read. `matrix` = { version, size, modules }. Throws on any structural inconsistency.
export function decodeQr(matrix) {
  const { version, size, modules } = matrix;
  if (!EC_M[version]) throw new Error('unsupported version ' + version);
  if (size !== 17 + 4 * version) throw new Error(`size ${size} does not match version ${version}`);
  if (modules.length !== size || modules.some((row) => row.length !== size)) throw new Error('modules is not a size×size array');
  const f = functionModules(version);
  const fmt = readFormat(modules);
  const bits = readRawBits(modules, f, fmt.mask);
  const [total, ecLen] = EC_M[version];
  if (Math.floor(bits.length / 8) !== total) throw new Error(`${bits.length} data-area bits hold ${Math.floor(bits.length / 8)} codewords, expected ${total}`);
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length && codewords.length < total; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }
  const blocks = deinterleave(codewords, version);
  const divisor = rsDivisor(ecLen);
  blocks.forEach((blk, i) => {
    const rem = rsRemainder(blk.data, divisor);
    if (rem.some((v, j) => v !== blk.ec[j])) throw new Error(`Reed–Solomon parity of block ${i} does not match`);
  });
  const dataBytes = blocks.flatMap((b) => b.data);
  const payload = parsePayload(dataBytes, version);
  return { version, size, ecl: fmt.ecl, mask: fmt.mask, codewords, blocks, dataBytes, ...payload };
}

// Parses the `d` attribute produced by qrSvg (subpaths of M x y h a v b h -a z, absolute H/V tolerated)
// into filled rectangles, then maps them back onto a module grid of the given size / scale / margin.
export function rectsFromPath(d) {
  // tokens: command letters and numbers (compact forms like "M4 4h4v4h-4z" are accepted)
  const tokens = String(d).match(/[MmHhVvZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi);
  if (!tokens || tokens.join('').replace(/\s/g, '') !== String(d).replace(/[\s,]/g, '')) throw new Error('path contains characters other than M/m/H/h/V/v/Z/z, digits, ".", "-", spaces');
  const rects = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let cur = null;
  let cmd = null;
  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error('bad number in path at token ' + (i - 1));
    return v;
  };
  const touch = () => {
    if (!cur) throw new Error('h/v before M');
    cur.minX = Math.min(cur.minX, x);
    cur.maxX = Math.max(cur.maxX, x);
    cur.minY = Math.min(cur.minY, y);
    cur.maxY = Math.max(cur.maxY, y);
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MmHhVvZz]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'z' || cmd === 'Z') {
        if (!cur) throw new Error('z before M');
        x = cur.minX;
        y = cur.minY;
        cur = null;
        cmd = null;
      }
      continue;
    }
    // a number: apply the current command (implicit repetition allowed)
    if (cmd === 'M' || cmd === 'm') {
      const nx = num();
      const ny = num();
      if (cmd === 'm') {
        x += nx;
        y += ny;
      } else {
        x = nx;
        y = ny;
      }
      cur = { minX: x, minY: y, maxX: x, maxY: y };
      rects.push(cur);
      cmd = cmd === 'm' ? 'l' : 'L'; // SVG: further pairs after M are implicit lineto — not expected here
      if (i < tokens.length && !/^[MmHhVvZz]$/.test(tokens[i])) throw new Error('implicit lineto after M is not part of the expected shape');
    } else if (cmd === 'h' || cmd === 'H' || cmd === 'v' || cmd === 'V') {
      const v = num();
      if (cmd === 'h') x += v;
      else if (cmd === 'H') x = v;
      else if (cmd === 'v') y += v;
      else y = v;
      touch();
    } else {
      throw new Error('number without a command at token ' + i);
    }
  }
  return rects;
}

export function gridFromPath(d, size, scale, margin) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const r of rectsFromPath(d)) {
    const c0 = r.minX / scale - margin;
    const c1 = r.maxX / scale - margin;
    const r0 = r.minY / scale - margin;
    const r1 = r.maxY / scale - margin;
    for (const v of [c0, c1, r0, r1]) if (!Number.isInteger(v)) throw new Error('rectangle edge not on the module grid: ' + JSON.stringify(r));
    if (c1 <= c0 || r1 <= r0) throw new Error('degenerate rectangle ' + JSON.stringify(r));
    for (let row = r0; row < r1; row++) {
      for (let col = c0; col < c1; col++) {
        if (row < 0 || col < 0 || row >= size || col >= size) throw new Error('rectangle outside the matrix ' + JSON.stringify(r));
        if (grid[row][col]) throw new Error(`module (${row},${col}) painted twice`);
        grid[row][col] = true;
      }
    }
  }
  return grid;
}
