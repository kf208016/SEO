import { html } from './html.js';

export const QR_BYTE_CAPACITY_M = Object.freeze([
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
  251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
]);

const MIN_VERSION = 1;
const MAX_VERSION = 20;

// Indexed by version. These two ISO/IEC 18004 tables are sufficient to derive
// every short/long Reed-Solomon block split without storing the expanded table.
const EC_CODEWORDS_PER_BLOCK = Object.freeze({
  L: Object.freeze([0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28]),
  M: Object.freeze([0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]),
  Q: Object.freeze([0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30]),
  H: Object.freeze([0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28]),
});

const NUM_ERROR_CORRECTION_BLOCKS = Object.freeze({
  L: Object.freeze([0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8]),
  M: Object.freeze([0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]),
  Q: Object.freeze([0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20]),
  H: Object.freeze([0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25]),
});

const FORMAT_LEVEL_BITS = Object.freeze({ L: 1, M: 0, Q: 3, H: 2 });

const ALIGNMENT_PATTERN_POSITIONS = Object.freeze([
  Object.freeze([]),
  Object.freeze([]),
  Object.freeze([6, 18]),
  Object.freeze([6, 22]),
  Object.freeze([6, 26]),
  Object.freeze([6, 30]),
  Object.freeze([6, 34]),
  Object.freeze([6, 22, 38]),
  Object.freeze([6, 24, 42]),
  Object.freeze([6, 26, 46]),
  Object.freeze([6, 28, 50]),
  Object.freeze([6, 30, 54]),
  Object.freeze([6, 32, 58]),
  Object.freeze([6, 34, 62]),
  Object.freeze([6, 26, 46, 66]),
  Object.freeze([6, 26, 48, 70]),
  Object.freeze([6, 26, 50, 74]),
  Object.freeze([6, 30, 54, 78]),
  Object.freeze([6, 30, 56, 82]),
  Object.freeze([6, 30, 58, 86]),
  Object.freeze([6, 34, 62, 90]),
]);

function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function rawCodewords(version) {
  return Math.floor(rawDataModules(version) / 8);
}

function dataCodewords(version, ecLevel) {
  return rawCodewords(version)
    - EC_CODEWORDS_PER_BLOCK[ecLevel][version] * NUM_ERROR_CORRECTION_BLOCKS[ecLevel][version];
}

function byteCapacity(version, ecLevel) {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(version, ecLevel) * 8 - 4 - countBits) / 8);
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push(((value >>> i) & 1) !== 0);
}

function makeDataCodewords(bytes, version, ecLevel) {
  const capacityBits = dataCodewords(version, ecLevel) * 8;
  const bits = [];
  appendBits(bits, 0b0100, 4); // Byte mode.
  appendBits(bits, bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) appendBits(bits, byte, 8);

  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(false);

  const result = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | Number(bits[offset + bit]);
    result.push(value);
  }
  for (let pad = 0; result.length < capacityBits / 8; pad += 1) {
    result.push(pad % 2 === 0 ? 0xEC : 0x11);
  }
  return result;
}

function gfMultiply(left, right) {
  let result = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11D);
    result ^= ((right >>> bit) & 1) * left;
  }
  return result;
}

function reedSolomonDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

function addErrorCorrectionAndInterleave(data, version, ecLevel) {
  const blockCount = NUM_ERROR_CORRECTION_BLOCKS[ecLevel][version];
  const ecLength = EC_CODEWORDS_PER_BLOCK[ecLevel][version];
  const totalCodewords = rawCodewords(version);
  const shortBlockCount = blockCount - (totalCodewords % blockCount);
  const shortBlockLength = Math.floor(totalCodewords / blockCount);
  const shortDataLength = shortBlockLength - ecLength;
  const divisor = reedSolomonDivisor(ecLength);
  const blocks = [];

  let offset = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const length = shortDataLength + (block < shortBlockCount ? 0 : 1);
    const blockData = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: blockData, ec: reedSolomonRemainder(blockData, divisor) });
  }

  const result = [];
  const longestDataLength = shortDataLength + (shortBlockCount < blockCount ? 1 : 0);
  for (let index = 0; index < longestDataLength; index += 1) {
    for (const block of blocks) {
      if (index < block.data.length) result.push(block.data[index]);
    }
  }
  for (let index = 0; index < ecLength; index += 1) {
    for (const block of blocks) result.push(block.ec[index]);
  }

  if (offset !== data.length || result.length !== totalCodewords) {
    throw new Error('qr_internal_error');
  }
  return result;
}

function bit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function formatBits(ecLevel, mask) {
  const data = (FORMAT_LEVEL_BITS[ecLevel] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function versionBits(version) {
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1F25);
  }
  return (version << 12) | remainder;
}

function maskApplies(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: throw new Error('qr_internal_error');
  }
}

function createMatrix(version, ecLevel, codewords) {
  const size = 17 + version * 4;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array(size).fill(false));

  function drawFunctionModule(x, y, dark) {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  }

  function drawFinderPattern(centerX, centerY) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        drawFunctionModule(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  function drawAlignmentPattern(centerX, centerY) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        drawFunctionModule(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFormatBits(mask) {
    const value = formatBits(ecLevel, mask);
    for (let i = 0; i <= 5; i += 1) drawFunctionModule(8, i, bit(value, i));
    drawFunctionModule(8, 7, bit(value, 6));
    drawFunctionModule(8, 8, bit(value, 7));
    drawFunctionModule(7, 8, bit(value, 8));
    for (let i = 9; i < 15; i += 1) drawFunctionModule(14 - i, 8, bit(value, i));

    for (let i = 0; i < 8; i += 1) drawFunctionModule(size - 1 - i, 8, bit(value, i));
    for (let i = 8; i < 15; i += 1) drawFunctionModule(8, size - 15 + i, bit(value, i));
    drawFunctionModule(8, size - 8, true);
  }

  function drawVersion() {
    if (version < 7) return;
    const value = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = bit(value, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      drawFunctionModule(a, b, dark);
      drawFunctionModule(b, a, dark);
    }
  }

  for (let i = 0; i < size; i += 1) {
    drawFunctionModule(6, i, i % 2 === 0);
    drawFunctionModule(i, 6, i % 2 === 0);
  }
  drawFinderPattern(3, 3);
  drawFinderPattern(size - 4, 3);
  drawFinderPattern(3, size - 4);

  const positions = ALIGNMENT_PATTERN_POSITIONS[version];
  for (let row = 0; row < positions.length; row += 1) {
    for (let column = 0; column < positions.length; column += 1) {
      const atFinder = (row === 0 && column === 0)
        || (row === 0 && column === positions.length - 1)
        || (row === positions.length - 1 && column === 0);
      if (!atFinder) drawAlignmentPattern(positions[column], positions[row]);
    }
  }
  drawFormatBits(0);
  drawVersion();

  let dataBit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (isFunction[y][x] || dataBit >= codewords.length * 8) continue;
        modules[y][x] = bit(codewords[dataBit >>> 3], 7 - (dataBit & 7));
        dataBit += 1;
      }
    }
  }
  if (dataBit !== codewords.length * 8) throw new Error('qr_internal_error');

  function applyMask(mask) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!isFunction[y][x] && maskApplies(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  function addFinderHistory(runLength, history) {
    let length = runLength;
    if (history[0] === 0) length += size;
    history.pop();
    history.unshift(length);
  }

  function finderPatternCount(history) {
    const unit = history[1];
    const core = unit > 0
      && history[2] === unit
      && history[3] === unit * 3
      && history[4] === unit
      && history[5] === unit;
    if (!core) return 0;
    return Number(history[0] >= unit * 4 && history[6] >= unit)
      + Number(history[6] >= unit * 4 && history[0] >= unit);
  }

  function terminateFinderHistory(runColor, runLength, history) {
    let length = runLength;
    if (runColor) {
      addFinderHistory(length, history);
      length = 0;
    }
    length += size;
    addFinderHistory(length, history);
    return finderPatternCount(history);
  }

  function linePenalty(getModule) {
    let score = 0;
    let runColor = false;
    let runLength = 0;
    const history = Array(7).fill(0);
    for (let index = 0; index < size; index += 1) {
      const color = getModule(index);
      if (color === runColor) {
        runLength += 1;
        if (runLength === 5) score += 3;
        else if (runLength > 5) score += 1;
      } else {
        addFinderHistory(runLength, history);
        if (!runColor) score += finderPatternCount(history) * 40;
        runColor = color;
        runLength = 1;
      }
    }
    score += terminateFinderHistory(runColor, runLength, history) * 40;
    return score;
  }

  function penaltyScore() {
    let score = 0;
    for (let y = 0; y < size; y += 1) score += linePenalty((x) => modules[y][x]);
    for (let x = 0; x < size; x += 1) score += linePenalty((y) => modules[y][x]);

    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const color = modules[y][x];
        if (modules[y][x + 1] === color
          && modules[y + 1][x] === color
          && modules[y + 1][x + 1] === color) score += 3;
      }
    }

    let dark = 0;
    for (const row of modules) for (const cell of row) dark += Number(cell);
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = null;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(mask);
    drawFormatBits(mask);
    const penalty = penaltyScore();
    if (penalty < bestPenalty) {
      bestMask = mask;
      bestPenalty = penalty;
      bestModules = modules.map((row) => row.slice());
    }
    applyMask(mask);
  }

  if (bestModules === null) throw new Error('qr_internal_error');
  // Redrawing is not needed for the returned copy, but keeps the working state
  // internally coherent and makes tie-breaking (lowest mask number) explicit.
  drawFormatBits(bestMask);
  return bestModules;
}

export function qrMatrix(text, { ecLevel = 'M' } = {}) {
  if (!Object.hasOwn(FORMAT_LEVEL_BITS, ecLevel)) throw new Error('qr_invalid_ec_level');
  const bytes = new TextEncoder().encode(String(text));

  let version = MIN_VERSION;
  while (version <= MAX_VERSION && bytes.length > byteCapacity(version, ecLevel)) version += 1;
  if (version > MAX_VERSION) throw new Error('qr_too_long');

  const data = makeDataCodewords(bytes, version, ecLevel);
  const codewords = addErrorCorrectionAndInterleave(data, version, ecLevel);
  const modules = createMatrix(version, ecLevel, codewords);
  return { version, size: 17 + version * 4, modules };
}

export function qrSvg(matrix, { scale = 4, margin = 4 } = {}) {
  if (!matrix || !Number.isInteger(matrix.size) || !Array.isArray(matrix.modules)
    || matrix.modules.length !== matrix.size || matrix.size <= 0) {
    throw new TypeError('qr_invalid_matrix');
  }
  if (!Number.isInteger(scale) || scale <= 0 || !Number.isInteger(margin) || margin < 0) {
    throw new TypeError('qr_invalid_svg_options');
  }

  const path = [];
  for (let y = 0; y < matrix.size; y += 1) {
    const row = matrix.modules[y];
    if (!Array.isArray(row) || row.length !== matrix.size || row.some((cell) => typeof cell !== 'boolean')) {
      throw new TypeError('qr_invalid_matrix');
    }
    for (let x = 0; x < matrix.size;) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < matrix.size && row[end]) end += 1;
      const left = (x + margin) * scale;
      const top = (y + margin) * scale;
      const width = (end - x) * scale;
      path.push(`M ${left} ${top} h ${width} v ${scale} h -${width} z`);
      x = end;
    }
  }

  const width = (matrix.size + margin * 2) * scale;
  return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}" width="${width}" height="${width}" role="img" aria-label="LINE 諮詢 QR code" shape-rendering="crispEdges"><rect width="${width}" height="${width}" fill="#fff"/><path d="${path.join(' ')}" fill="#000"/></svg>`;
}
