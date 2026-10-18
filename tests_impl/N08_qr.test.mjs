import test from 'node:test';
import assert from 'node:assert/strict';

import { html } from '../public/core/html.js';
import { QR_BYTE_CAPACITY_M, qrMatrix, qrSvg } from '../public/core/qr.js';

const ALIGNMENT_POSITIONS = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
  [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58],
  [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

const FORMAT_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

const REFERENCE_BYTE_CAPACITIES = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382],
};

const REFERENCE_EC_LAYOUT = {
  L: {
    ec: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
    blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  },
  M: {
    ec: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
    blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  },
  Q: {
    ec: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
    blocks: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  },
  H: {
    ec: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
    blocks: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
  },
};

// Explicit independent block fixtures for the vectors decoded below.
const BLOCK_SPECS = {
  '1-L': { dataLengths: [19], ecLength: 7 },
  '1-M': { dataLengths: [16], ecLength: 10 },
  '1-Q': { dataLengths: [13], ecLength: 13 },
  '1-H': { dataLengths: [9], ecLength: 17 },
  '2-M': { dataLengths: [28], ecLength: 16 },
  '10-M': { dataLengths: [43, 43, 43, 43, 44], ecLength: 26 },
  '20-M': {
    dataLengths: [41, 41, 41, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42],
    ecLength: 26,
  },
};

function formatWord(level, mask) {
  const data = (FORMAT_LEVEL_BITS[level] << 3) | mask;
  let remainder = data << 10;
  for (let top = 14; top >= 10; top -= 1) {
    if (((remainder >>> top) & 1) !== 0) remainder ^= 0x537 << (top - 10);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function versionWord(version) {
  let remainder = version << 12;
  for (let top = 17; top >= 12; top -= 1) {
    if (((remainder >>> top) & 1) !== 0) remainder ^= 0x1F25 << (top - 12);
  }
  return (version << 12) | remainder;
}

function functionMap(version) {
  const size = version * 4 + 17;
  const result = Array.from({ length: size }, () => Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && x < size && y >= 0 && y < size) result[y][x] = true;
  };

  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [centerX, centerY] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) mark(centerX + dx, centerY + dy);
    }
  }
  const positions = ALIGNMENT_POSITIONS[version];
  for (let row = 0; row < positions.length; row += 1) {
    for (let column = 0; column < positions.length; column += 1) {
      if ((row === 0 && column === 0)
        || (row === 0 && column === positions.length - 1)
        || (row === positions.length - 1 && column === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) mark(positions[column] + dx, positions[row] + dy);
      }
    }
  }

  for (let i = 0; i <= 5; i += 1) mark(8, i);
  mark(8, 7);
  mark(8, 8);
  mark(7, 8);
  for (let i = 9; i < 15; i += 1) mark(14 - i, 8);
  for (let i = 0; i < 8; i += 1) mark(size - 1 - i, 8);
  for (let i = 8; i < 15; i += 1) mark(8, size - 15 + i);
  mark(8, size - 8);

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return result;
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: throw new Error('bad mask');
  }
}

function readFormat(modules) {
  const size = modules.length;
  const primary = [];
  for (let i = 0; i <= 5; i += 1) primary[i] = modules[i][8];
  primary[6] = modules[7][8];
  primary[7] = modules[8][8];
  primary[8] = modules[8][7];
  for (let i = 9; i < 15; i += 1) primary[i] = modules[8][14 - i];

  const secondary = [];
  for (let i = 0; i < 8; i += 1) secondary[i] = modules[8][size - 1 - i];
  for (let i = 8; i < 15; i += 1) secondary[i] = modules[size - 15 + i][8];
  const toInteger = (bits) => bits.reduce((value, dark, index) => value | (Number(dark) << index), 0);
  const first = toInteger(primary);
  assert.equal(toInteger(secondary), first, 'both format-information copies must agree');

  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let mask = 0; mask < 8; mask += 1) {
      if (formatWord(level, mask) === first) return { level, mask, word: first };
    }
  }
  assert.fail(`invalid format information: ${first.toString(16)}`);
}

function assertVersionInformation(qr) {
  if (qr.version < 7) return;
  let topRight = 0;
  let bottomLeft = 0;
  for (let i = 0; i < 18; i += 1) {
    const a = qr.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    topRight |= Number(qr.modules[b][a]) << i;
    bottomLeft |= Number(qr.modules[a][b]) << i;
  }
  assert.equal(topRight, versionWord(qr.version));
  assert.equal(bottomLeft, topRight);
}

function extractCodewords(qr, mask, reserved) {
  const bits = [];
  for (let right = qr.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < qr.size; vertical += 1) {
      const y = ((right + 1) & 2) === 0 ? qr.size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (reserved[y][x]) continue;
        bits.push(qr.modules[y][x] !== maskBit(mask, x, y));
      }
    }
  }
  const result = [];
  for (let offset = 0; offset + 7 < bits.length; offset += 8) {
    let value = 0;
    for (let i = 0; i < 8; i += 1) value = (value << 1) | Number(bits[offset + i]);
    result.push(value);
  }
  return { result, remainderBits: bits.length % 8 };
}

function deinterleave(codewords, spec) {
  const data = spec.dataLengths.map((length) => Array(length));
  const ec = spec.dataLengths.map(() => Array(spec.ecLength));
  let cursor = 0;
  const longest = Math.max(...spec.dataLengths);
  for (let column = 0; column < longest; column += 1) {
    for (let block = 0; block < data.length; block += 1) {
      if (column < data[block].length) data[block][column] = codewords[cursor++];
    }
  }
  for (let column = 0; column < spec.ecLength; column += 1) {
    for (let block = 0; block < ec.length; block += 1) ec[block][column] = codewords[cursor++];
  }
  assert.equal(cursor, codewords.length, 'RS layout consumes every codeword');
  return { data, ec };
}

function referenceBlockSpec(version, level, totalCodewords) {
  const blockCount = REFERENCE_EC_LAYOUT[level].blocks[version - 1];
  const ecLength = REFERENCE_EC_LAYOUT[level].ec[version - 1];
  const shortTotalLength = Math.floor(totalCodewords / blockCount);
  const longBlockCount = totalCodewords % blockCount;
  return {
    ecLength,
    dataLengths: [
      ...Array(blockCount - longBlockCount).fill(shortTotalLength - ecLength),
      ...Array(longBlockCount).fill(shortTotalLength + 1 - ecLength),
    ],
  };
}

const GF_EXP = Array(510);
const GF_LOG = Array(256).fill(-1);
{
  let value = 1;
  for (let exponent = 0; exponent < 255; exponent += 1) {
    GF_EXP[exponent] = value;
    GF_LOG[value] = exponent;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11D;
  }
  for (let exponent = 255; exponent < GF_EXP.length; exponent += 1) {
    GF_EXP[exponent] = GF_EXP[exponent - 255];
  }
}

function gfMultiply(left, right) {
  return left === 0 || right === 0 ? 0 : GF_EXP[GF_LOG[left] + GF_LOG[right]];
}

function assertReedSolomonBlocks(blocks, ecLength) {
  for (let blockIndex = 0; blockIndex < blocks.data.length; blockIndex += 1) {
    const polynomial = [...blocks.data[blockIndex], ...blocks.ec[blockIndex]];
    for (let root = 0; root < ecLength; root += 1) {
      let value = 0;
      for (const coefficient of polynomial) value = gfMultiply(value, GF_EXP[root]) ^ coefficient;
      assert.equal(value, 0, `block ${blockIndex} must vanish at RS root alpha^${root}`);
    }
  }
}

function parseBytePayload(dataBlocks, version) {
  const bytes = dataBlocks.flat();
  let offset = 0;
  const read = (length) => {
    let value = 0;
    for (let i = 0; i < length; i += 1) {
      value = (value << 1) | ((bytes[offset >>> 3] >>> (7 - (offset & 7))) & 1);
      offset += 1;
    }
    return value;
  };
  assert.equal(read(4), 0b0100, 'payload must use byte mode');
  const length = read(version <= 9 ? 8 : 16);
  const payload = Uint8Array.from({ length }, () => read(8));
  return { payload, text: new TextDecoder('utf-8', { fatal: true }).decode(payload) };
}

function decodeAndVerify(qr, expectedText, expectedLevel = 'M') {
  const format = readFormat(qr.modules);
  assert.equal(format.level, expectedLevel);
  assertVersionInformation(qr);
  const reserved = functionMap(qr.version);
  const extracted = extractCodewords(qr, format.mask, reserved);
  const spec = BLOCK_SPECS[`${qr.version}-${format.level}`];
  assert.ok(spec, `missing independent block fixture for ${qr.version}-${format.level}`);
  const expectedCodewords = spec.dataLengths.reduce((sum, length) => sum + length, 0)
    + spec.dataLengths.length * spec.ecLength;
  assert.equal(extracted.result.length, expectedCodewords);
  const blocks = deinterleave(extracted.result, spec);
  assertReedSolomonBlocks(blocks, spec.ecLength);
  const decoded = parseBytePayload(blocks.data, qr.version);
  assert.equal(decoded.text, expectedText);
  assert.deepEqual([...decoded.payload], [...new TextEncoder().encode(expectedText)]);
  return { format, extracted, blocks };
}

function writeFormat(modules, level, mask) {
  const size = modules.length;
  const value = formatWord(level, mask);
  const get = (index) => ((value >>> index) & 1) !== 0;
  for (let i = 0; i <= 5; i += 1) modules[i][8] = get(i);
  modules[7][8] = get(6);
  modules[8][8] = get(7);
  modules[8][7] = get(8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = get(i);
  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = get(i);
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i][8] = get(i);
  modules[size - 8][8] = true;
}

function finderLikePenalty(line) {
  const size = line.length;
  const runs = [];
  let color = false;
  let length = size;
  for (const cell of line) {
    if (cell === color) length += 1;
    else {
      runs.push({ color, length });
      color = cell;
      length = 1;
    }
  }
  if (color) {
    runs.push({ color, length });
    runs.push({ color: false, length: size });
  } else {
    runs.push({ color, length: length + size });
  }

  let result = 0;
  for (let start = 0; start + 6 < runs.length; start += 1) {
    const group = runs.slice(start, start + 7);
    if (group.some((run, index) => run.color !== (index % 2 === 1))) continue;
    const unit = group[1].length;
    if (unit === 0 || group[2].length !== unit || group[3].length !== unit * 3
      || group[4].length !== unit || group[5].length !== unit) continue;
    if (group[0].length >= unit * 4 && group[6].length >= unit) result += 40;
    if (group[6].length >= unit * 4 && group[0].length >= unit) result += 40;
  }
  return result;
}

function independentPenalty(modules) {
  const size = modules.length;
  let result = 0;
  const scoreLine = (line) => {
    let score = finderLikePenalty(line);
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
    return score;
  };
  for (const row of modules) result += scoreLine(row);
  for (let x = 0; x < size; x += 1) result += scoreLine(modules.map((row) => row[x]));
  for (let y = 0; y + 1 < size; y += 1) {
    for (let x = 0; x + 1 < size; x += 1) {
      const value = modules[y][x];
      if (modules[y][x + 1] === value && modules[y + 1][x] === value
        && modules[y + 1][x + 1] === value) result += 3;
    }
  }
  const dark = modules.flat().filter(Boolean).length;
  result += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return result;
}

function assertLowestPenaltyMask(qr) {
  const selected = readFormat(qr.modules);
  const reserved = functionMap(qr.version);
  const unmasked = qr.modules.map((row) => row.slice());
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (!reserved[y][x] && maskBit(selected.mask, x, y)) unmasked[y][x] = !unmasked[y][x];
    }
  }
  const scores = [];
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = unmasked.map((row) => row.slice());
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (!reserved[y][x] && maskBit(mask, x, y)) candidate[y][x] = !candidate[y][x];
      }
    }
    writeFormat(candidate, selected.level, mask);
    scores.push(independentPenalty(candidate));
  }
  const minimum = Math.min(...scores);
  assert.equal(scores[selected.mask], minimum);
  assert.equal(selected.mask, scores.indexOf(minimum), 'mask ties must choose the lowest number');
}

function assertFinder(modules, left, top) {
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const distance = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(modules[top + y][left + x], distance !== 2, `finder cell ${left + x},${top + y}`);
    }
  }
}

test('N08 QR matrix has ISO function patterns, boolean cells, and deterministic output', () => {
  const first = qrMatrix('A');
  const second = qrMatrix('A');
  assert.equal(first.version, 1);
  assert.equal(first.size, 21);
  assert.equal(first.modules.length, first.size);
  assert.ok(first.modules.every((row) => row.length === first.size
    && row.every((cell) => typeof cell === 'boolean')));
  assertFinder(first.modules, 0, 0);
  assertFinder(first.modules, first.size - 7, 0);
  assertFinder(first.modules, 0, first.size - 7);
  assert.deepEqual(first, second);

  const decoded = decodeAndVerify(first, 'A');
  assert.deepEqual(decoded.blocks.data[0].slice(0, 5), [0x40, 0x14, 0x10, 0xEC, 0x11]);
  assertLowestPenaltyMask(first);
});

test('N08 QR chooses versions by UTF-8 byte capacity and rejects overflow', () => {
  assert.deepEqual(QR_BYTE_CAPACITY_M, [
    14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
    251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  ]);
  assert.equal(qrMatrix('x'.repeat(14)).version, 1);
  assert.equal(qrMatrix('x'.repeat(15)).version, 2);
  assert.equal(qrMatrix('你'.repeat(4)).version, 1); // 12 UTF-8 bytes.
  const chinese = qrMatrix('你'.repeat(5)); // 15 UTF-8 bytes.
  assert.equal(chinese.version, 2);
  decodeAndVerify(chinese, '你'.repeat(5));

  const version10 = qrMatrix('x'.repeat(213));
  assert.equal(version10.version, 10);
  decodeAndVerify(version10, 'x'.repeat(213));

  const version20 = qrMatrix('x'.repeat(666));
  assert.equal(version20.version, 20);
  assert.equal(version20.size, 97);
  decodeAndVerify(version20, 'x'.repeat(666));
  assert.throws(() => qrMatrix('x'.repeat(667)), (error) => error?.message === 'qr_too_long');
});

test('N08 QR accepts all four EC levels and encodes valid RS blocks', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    const qr = qrMatrix('A', { ecLevel: level });
    assert.equal(qr.version, 1);
    decodeAndVerify(qr, 'A', level);
  }
  assert.throws(() => qrMatrix('A', { ecLevel: 'X' }), /qr_invalid_ec_level/);
});

test('N08 versions 1-20 match independent capacity and RS-layout tables at every EC level', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let version = 1; version <= 20; version += 1) {
      const text = 'x'.repeat(REFERENCE_BYTE_CAPACITIES[level][version - 1]);
      const qr = qrMatrix(text, { ecLevel: level });
      assert.equal(qr.version, version, `${level} byte capacity at version ${version}`);
      const format = readFormat(qr.modules);
      assert.equal(format.level, level);
      assertVersionInformation(qr);
      const extracted = extractCodewords(qr, format.mask, functionMap(version));
      const spec = referenceBlockSpec(version, level, extracted.result.length);
      const blocks = deinterleave(extracted.result, spec);
      assertReedSolomonBlocks(blocks, spec.ecLength);
      assert.equal(parseBytePayload(blocks.data, version).text, text);
    }
  }
});

test('N08 qrSvg returns shared SafeHtml with one safe path and exact geometry', () => {
  const matrix = qrMatrix('A');
  const svgValue = qrSvg(matrix);
  const svg = String(svgValue);
  assert.ok(svg.startsWith('<svg'));
  assert.equal((svg.match(/<path\b/g) ?? []).length, 1);
  assert.match(svg, /fill="#000"/);
  assert.match(svg, /viewBox="0 0 116 116" width="116" height="116"/);
  assert.doesNotMatch(svg, /\sstyle\s*=/i);
  assert.doesNotMatch(svg, /<script\b/i);
  assert.doesNotMatch(svg, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:/i);
  const pathData = svg.match(/<path d="([^"]*)" fill="#000"\/>/)?.[1];
  assert.ok(pathData);
  assert.match(pathData, /^[MmHhVvZz0-9 .-]+$/);
  assert.equal(String(html`<div>${svgValue}</div>`), `<div>${svg}</div>`, 'qrSvg must use html.js SafeHtml');
});
