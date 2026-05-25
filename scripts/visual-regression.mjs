import { deflateSync, inflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_BASELINE = 'docs/visual-quality-baseline.json';
const DEFAULT_CASE_NAME = 'default-reference';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAMPLE_GRID_X = 160;
const SAMPLE_GRID_Y = 120;
const SIGNATURE_WIDTH = 96;
const SIGNATURE_HEIGHT = 54;
const SIGNATURE_ARTIFACT_SCALE = 6;
const PERCEPTUAL_BLOCK_SIZE = 16;

function usage(exitCode = 0) {
  const text = `
Usage:
  node scripts/visual-regression.mjs --image output/playwright/visual-reference-fix-final.png
  node scripts/visual-regression.mjs --image output/playwright/visual-reference-fix-final.png --update
  node scripts/visual-regression.mjs --list

Options:
  --image <path>      PNG screenshot to compare.
  --name <name>       Baseline case name. Defaults to ${DEFAULT_CASE_NAME}.
  --baseline <path>   Baseline JSON path. Defaults to ${DEFAULT_BASELINE}.
  --report-dir <path> Write JSON/HTML/signature-diff artifacts for compare mode.
  --update            Update or create the named baseline from --image.
  --list              List baseline cases.
  --json              Emit machine-readable comparison output.
`;
  console.log(text.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    baseline: DEFAULT_BASELINE,
    name: DEFAULT_CASE_NAME,
    image: '',
    reportDir: '',
    update: false,
    list: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--baseline') args.baseline = argv[++i] ?? '';
    else if (arg === '--report-dir') args.reportDir = argv[++i] ?? '';
    else if (arg === '--name') args.name = argv[++i] ?? '';
    else if (arg === '--image') args.image = argv[++i] ?? '';
    else if (arg === '--update') args.update = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.baseline) throw new Error('--baseline requires a path');
  if (!args.name) throw new Error('--name requires a value');
  if (args.reportDir && args.update) throw new Error('--report-dir is only supported in compare mode');
  return args;
}

function readU32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function writeU32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC32_TABLE.length; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC32_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([
    writeU32(data.length),
    payload,
    writeU32(crc32(payload)),
  ]);
}

function encodeRgbaPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error(`RGBA payload size does not match ${width}x${height}`);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND'),
  ]);
}

function writeRgbaPng(filePath, width, height, rgba) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, encodeRgbaPng(width, height, rgba));
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${filePath} is not a PNG file`);
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset + 8 <= buffer.length) {
    const length = readU32(buffer, offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error(`Invalid PNG chunk length in ${filePath}`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0) throw new Error(`PNG has invalid dimensions: ${filePath}`);
  if (bitDepth !== 8) throw new Error(`Only 8-bit PNG screenshots are supported, got bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('Interlaced PNG screenshots are not supported');

  const channelsByType = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
  ]);
  const channels = channelsByType.get(colorType);
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);

  const bytesPerPixel = channels;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expected = (rowBytes + 1) * height;
  if (inflated.length < expected) throw new Error(`PNG data is shorter than expected in ${filePath}`);

  const pixels = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  let src = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    inflated.copy(current, 0, src, src + rowBytes);
    src += rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 1) current[x] = (current[x] + left) & 0xff;
      else if (filter === 2) current[x] = (current[x] + up) & 0xff;
      else if (filter === 3) current[x] = (current[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) current[x] = (current[x] + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
    }

    for (let x = 0; x < width; x++) {
      const srcOffset = x * channels;
      const dstOffset = (y * width + x) * 4;
      if (colorType === 0) {
        const g = current[srcOffset];
        pixels[dstOffset + 0] = g;
        pixels[dstOffset + 1] = g;
        pixels[dstOffset + 2] = g;
        pixels[dstOffset + 3] = 255;
      } else if (colorType === 2) {
        pixels[dstOffset + 0] = current[srcOffset + 0];
        pixels[dstOffset + 1] = current[srcOffset + 1];
        pixels[dstOffset + 2] = current[srcOffset + 2];
        pixels[dstOffset + 3] = 255;
      } else if (colorType === 4) {
        const g = current[srcOffset];
        pixels[dstOffset + 0] = g;
        pixels[dstOffset + 1] = g;
        pixels[dstOffset + 2] = g;
        pixels[dstOffset + 3] = current[srcOffset + 1];
      } else {
        pixels[dstOffset + 0] = current[srcOffset + 0];
        pixels[dstOffset + 1] = current[srcOffset + 1];
        pixels[dstOffset + 2] = current[srcOffset + 2];
        pixels[dstOffset + 3] = current[srcOffset + 3];
      }
    }

    previous.set(current);
  }

  return { width, height, pixels };
}

function fnv1a32(value, byte) {
  value ^= byte;
  return Math.imul(value, 0x01000193) >>> 0;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function lumaByteFromRgb(r, g, b) {
  return Math.max(0, Math.min(255, Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722)));
}

function screenshotMetricsFromPng(png) {
  const { width, height, pixels } = png;
  const pixelCount = width * height;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let sumLuma2 = 0;
  let dark = 0;
  let bright = 0;
  let green = 0;
  let white = 0;
  let nonBlack = 0;
  let topLuma = 0;
  let bottomLuma = 0;
  let topCount = 0;
  let bottomCount = 0;
  let sampledHash = 0x811c9dc5;
  const sampledColors = new Set();
  const stepX = Math.max(1, Math.floor(width / SAMPLE_GRID_X));
  const stepY = Math.max(1, Math.floor(height / SAMPLE_GRID_Y));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const r = pixels[offset + 0] / 255;
      const g = pixels[offset + 1] / 255;
      const b = pixels[offset + 2] / 255;
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      sumR += r;
      sumG += g;
      sumB += b;
      sumLuma += luma;
      sumLuma2 += luma * luma;
      if (luma < 0.08) dark++;
      if (luma > 0.82) bright++;
      if (g > r * 1.04 && g > b * 1.08 && g > 0.18) green++;
      if (r > 0.72 && g > 0.72 && b > 0.68 && Math.max(r, g, b) - Math.min(r, g, b) < 0.16) white++;
      if (r + g + b > 0.08) nonBlack++;
      if (y < height / 2) {
        topLuma += luma;
        topCount++;
      } else {
        bottomLuma += luma;
        bottomCount++;
      }
      if (x % stepX === 0 && y % stepY === 0) {
        const ri = pixels[offset + 0];
        const gi = pixels[offset + 1];
        const bi = pixels[offset + 2];
        sampledColors.add(`${ri},${gi},${bi}`);
        sampledHash = fnv1a32(fnv1a32(fnv1a32(sampledHash, ri), gi), bi);
      }
    }
  }

  const meanLuma = sumLuma / pixelCount;
  const variance = Math.max(0, sumLuma2 / pixelCount - meanLuma * meanLuma);
  return {
    width,
    height,
    pixelCount,
    meanR: round(sumR / pixelCount),
    meanG: round(sumG / pixelCount),
    meanB: round(sumB / pixelCount),
    meanLuma: round(meanLuma),
    stdLuma: round(Math.sqrt(variance)),
    darkFraction: round(dark / pixelCount),
    brightFraction: round(bright / pixelCount),
    greenFraction: round(green / pixelCount),
    whiteFraction: round(white / pixelCount),
    nonBlackFraction: round(nonBlack / pixelCount),
    topHalfLuma: round(topLuma / Math.max(1, topCount)),
    bottomHalfLuma: round(bottomLuma / Math.max(1, bottomCount)),
    sampledColors: sampledColors.size,
    sampledHash: `0x${sampledHash.toString(16).padStart(8, '0')}`,
  };
}

function imageSignature(png) {
  const data = Buffer.alloc(SIGNATURE_WIDTH * SIGNATURE_HEIGHT * 3);
  let hash = 0x811c9dc5;
  for (let sy = 0; sy < SIGNATURE_HEIGHT; sy++) {
    const sourceY = Math.min(png.height - 1, Math.max(0, Math.floor((sy + 0.5) * png.height / SIGNATURE_HEIGHT)));
    for (let sx = 0; sx < SIGNATURE_WIDTH; sx++) {
      const sourceX = Math.min(png.width - 1, Math.max(0, Math.floor((sx + 0.5) * png.width / SIGNATURE_WIDTH)));
      const sourceOffset = (sourceY * png.width + sourceX) * 4;
      const targetOffset = (sy * SIGNATURE_WIDTH + sx) * 3;
      const r = png.pixels[sourceOffset + 0];
      const g = png.pixels[sourceOffset + 1];
      const b = png.pixels[sourceOffset + 2];
      data[targetOffset + 0] = r;
      data[targetOffset + 1] = g;
      data[targetOffset + 2] = b;
      hash = fnv1a32(fnv1a32(fnv1a32(hash, r), g), b);
    }
  }
  return {
    width: SIGNATURE_WIDTH,
    height: SIGNATURE_HEIGHT,
    colorSpace: 'srgb-rgb8',
    hash: `0x${hash.toString(16).padStart(8, '0')}`,
    data: data.toString('base64'),
  };
}

function fullResolutionPerceptualField(png) {
  const { width, height, pixels } = png;
  const luma = Buffer.alloc(width * height);
  let hash = 0x811c9dc5;
  for (let i = 0; i < width * height; i++) {
    const source = i * 4;
    const byte = lumaByteFromRgb(pixels[source + 0], pixels[source + 1], pixels[source + 2]);
    luma[i] = byte;
    hash = fnv1a32(hash, byte);
  }
  const compressed = deflateSync(luma);
  return {
    width,
    height,
    colorSpace: 'srgb-luma8',
    compression: 'deflate-base64',
    blockSize: PERCEPTUAL_BLOCK_SIZE,
    byteLength: luma.length,
    compressedBytes: compressed.length,
    hash: `0x${hash.toString(16).padStart(8, '0')}`,
    data: compressed.toString('base64'),
  };
}

function analyzeScreenshot(filePath) {
  const png = decodePng(filePath);
  return {
    metrics: screenshotMetricsFromPng(png),
    signature: imageSignature(png),
    perceptual: fullResolutionPerceptualField(png),
  };
}

function decodeSignature(signature) {
  if (!signature || typeof signature !== 'object') return null;
  const width = Math.trunc(Number(signature.width));
  const height = Math.trunc(Number(signature.height));
  if (width <= 0 || height <= 0 || typeof signature.data !== 'string') return null;
  const bytes = Buffer.from(signature.data, 'base64');
  if (bytes.length !== width * height * 3) return null;
  return { width, height, bytes, hash: signature.hash ?? '' };
}

function lumaFromRgbBytes(buffer, offset) {
  return (buffer[offset + 0] * 0.2126 + buffer[offset + 1] * 0.7152 + buffer[offset + 2] * 0.0722) / 255;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index];
}

function percentileFromHistogram(histogram, p, total) {
  if (total <= 0) return 0;
  const target = Math.min(total, Math.max(1, Math.ceil(total * p)));
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen >= target) return i / 255;
  }
  return (histogram.length - 1) / 255;
}

function compareSignatures(actualSignature, expectedSignature, thresholds) {
  const actual = decodeSignature(actualSignature);
  const expected = decodeSignature(expectedSignature);
  if (!actual || !expected) {
    return {
      skipped: true,
      reason: 'baseline signature missing or invalid',
      failures: [],
      stats: null,
    };
  }
  if (actual.width !== expected.width || actual.height !== expected.height || actual.bytes.length !== expected.bytes.length) {
    return {
      skipped: false,
      failures: [`signature dimensions expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`],
      stats: {
        actualWidth: actual.width,
        actualHeight: actual.height,
        expectedWidth: expected.width,
        expectedHeight: expected.height,
        actualHash: actual.hash,
        expectedHash: expected.hash,
      },
    };
  }

  const pixelCount = actual.width * actual.height;
  const colorDiffs = [];
  let sumAbs = 0;
  let sumSq = 0;
  let maxDiff = 0;
  let sumActualLuma = 0;
  let sumExpectedLuma = 0;
  let sumActualLuma2 = 0;
  let sumExpectedLuma2 = 0;
  let sumLumaProduct = 0;
  for (let i = 0; i < actual.bytes.length; i += 3) {
    const dr = Math.abs(actual.bytes[i + 0] - expected.bytes[i + 0]) / 255;
    const dg = Math.abs(actual.bytes[i + 1] - expected.bytes[i + 1]) / 255;
    const db = Math.abs(actual.bytes[i + 2] - expected.bytes[i + 2]) / 255;
    const diff = (dr + dg + db) / 3;
    colorDiffs.push(diff);
    sumAbs += diff;
    sumSq += diff * diff;
    maxDiff = Math.max(maxDiff, diff);

    const actualLuma = lumaFromRgbBytes(actual.bytes, i);
    const expectedLuma = lumaFromRgbBytes(expected.bytes, i);
    sumActualLuma += actualLuma;
    sumExpectedLuma += expectedLuma;
    sumActualLuma2 += actualLuma * actualLuma;
    sumExpectedLuma2 += expectedLuma * expectedLuma;
    sumLumaProduct += actualLuma * expectedLuma;
  }
  colorDiffs.sort((a, b) => a - b);

  const meanActualLuma = sumActualLuma / pixelCount;
  const meanExpectedLuma = sumExpectedLuma / pixelCount;
  const varActual = Math.max(0, sumActualLuma2 / pixelCount - meanActualLuma * meanActualLuma);
  const varExpected = Math.max(0, sumExpectedLuma2 / pixelCount - meanExpectedLuma * meanExpectedLuma);
  const cov = sumLumaProduct / pixelCount - meanActualLuma * meanExpectedLuma;
  const c1 = 0.01 * 0.01;
  const c2 = 0.03 * 0.03;
  const ssim = ((2 * meanActualLuma * meanExpectedLuma + c1) * (2 * cov + c2))
    / ((meanActualLuma * meanActualLuma + meanExpectedLuma * meanExpectedLuma + c1) * (varActual + varExpected + c2));

  const stats = {
    width: actual.width,
    height: actual.height,
    meanAbsColorDiff: round(sumAbs / pixelCount),
    rmsColorDiff: round(Math.sqrt(sumSq / pixelCount)),
    p95ColorDiff: round(percentile(colorDiffs, 0.95)),
    maxColorDiff: round(maxDiff),
    lumaSsim: round(ssim),
    actualHash: actual.hash,
    expectedHash: expected.hash,
  };
  const failures = [];
  if (stats.meanAbsColorDiff > thresholds.signatureMeanAbsMaximum) {
    failures.push(`signatureMeanAbsColorDiff ${stats.meanAbsColorDiff} exceeds ${thresholds.signatureMeanAbsMaximum}`);
  }
  if (stats.rmsColorDiff > thresholds.signatureRmsMaximum) {
    failures.push(`signatureRmsColorDiff ${stats.rmsColorDiff} exceeds ${thresholds.signatureRmsMaximum}`);
  }
  if (stats.p95ColorDiff > thresholds.signatureP95Maximum) {
    failures.push(`signatureP95ColorDiff ${stats.p95ColorDiff} exceeds ${thresholds.signatureP95Maximum}`);
  }
  if (stats.maxColorDiff > thresholds.signatureMaxMaximum) {
    failures.push(`signatureMaxColorDiff ${stats.maxColorDiff} exceeds ${thresholds.signatureMaxMaximum}`);
  }
  if (stats.lumaSsim < thresholds.signatureSsimMinimum) {
    failures.push(`signatureLumaSsim ${stats.lumaSsim} below ${thresholds.signatureSsimMinimum}`);
  }
  return { skipped: false, failures, stats };
}

function decodePerceptualField(perceptual) {
  if (!perceptual || typeof perceptual !== 'object') return null;
  const width = Math.trunc(Number(perceptual.width));
  const height = Math.trunc(Number(perceptual.height));
  if (width <= 0 || height <= 0 || typeof perceptual.data !== 'string') return null;
  const encoded = Buffer.from(perceptual.data, 'base64');
  const bytes = perceptual.compression === 'deflate-base64' ? inflateSync(encoded) : encoded;
  if (bytes.length !== width * height) return null;
  return {
    width,
    height,
    blockSize: Math.max(4, Math.trunc(Number(perceptual.blockSize ?? PERCEPTUAL_BLOCK_SIZE)) || PERCEPTUAL_BLOCK_SIZE),
    bytes,
    hash: perceptual.hash ?? '',
  };
}

function ssimFromMoments(count, sumActual, sumExpected, sumActual2, sumExpected2, sumProduct) {
  if (count <= 0) return 1;
  const meanActual = sumActual / count;
  const meanExpected = sumExpected / count;
  const varActual = Math.max(0, sumActual2 / count - meanActual * meanActual);
  const varExpected = Math.max(0, sumExpected2 / count - meanExpected * meanExpected);
  const cov = sumProduct / count - meanActual * meanExpected;
  const c1 = 0.01 * 0.01;
  const c2 = 0.03 * 0.03;
  return ((2 * meanActual * meanExpected + c1) * (2 * cov + c2))
    / ((meanActual * meanActual + meanExpected * meanExpected + c1) * (varActual + varExpected + c2));
}

function comparePerceptualFields(actualField, expectedField, thresholds) {
  const actual = decodePerceptualField(actualField);
  const expected = decodePerceptualField(expectedField);
  if (!actual || !expected) {
    return {
      skipped: true,
      reason: 'baseline full-resolution perceptual field missing or invalid',
      failures: [],
      stats: null,
    };
  }
  if (actual.width !== expected.width || actual.height !== expected.height || actual.bytes.length !== expected.bytes.length) {
    return {
      skipped: false,
      failures: [`perceptual dimensions expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`],
      stats: {
        actualWidth: actual.width,
        actualHeight: actual.height,
        expectedWidth: expected.width,
        expectedHeight: expected.height,
        actualHash: actual.hash,
        expectedHash: expected.hash,
      },
    };
  }

  const pixelCount = actual.width * actual.height;
  const diffHistogram = new Uint32Array(256);
  const changedPixelThreshold = thresholds.perceptualChangedPixelLumaThreshold ?? 0.08;
  let changedPixels = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let maxDiff = 0;
  let sumActual = 0;
  let sumExpected = 0;
  let sumActual2 = 0;
  let sumExpected2 = 0;
  let sumProduct = 0;

  for (let i = 0; i < actual.bytes.length; i++) {
    const a = actual.bytes[i] / 255;
    const e = expected.bytes[i] / 255;
    const diffByte = Math.abs(actual.bytes[i] - expected.bytes[i]);
    const diff = diffByte / 255;
    diffHistogram[diffByte]++;
    sumAbs += diff;
    sumSq += diff * diff;
    maxDiff = Math.max(maxDiff, diff);
    if (diff > changedPixelThreshold) changedPixels++;
    sumActual += a;
    sumExpected += e;
    sumActual2 += a * a;
    sumExpected2 += e * e;
    sumProduct += a * e;
  }

  const blockSize = Math.max(4, Math.min(actual.blockSize, expected.blockSize));
  const blockSsims = [];
  for (let by = 0; by < actual.height; by += blockSize) {
    for (let bx = 0; bx < actual.width; bx += blockSize) {
      let count = 0;
      let blockActual = 0;
      let blockExpected = 0;
      let blockActual2 = 0;
      let blockExpected2 = 0;
      let blockProduct = 0;
      const maxY = Math.min(actual.height, by + blockSize);
      const maxX = Math.min(actual.width, bx + blockSize);
      for (let y = by; y < maxY; y++) {
        const row = y * actual.width;
        for (let x = bx; x < maxX; x++) {
          const index = row + x;
          const a = actual.bytes[index] / 255;
          const e = expected.bytes[index] / 255;
          count++;
          blockActual += a;
          blockExpected += e;
          blockActual2 += a * a;
          blockExpected2 += e * e;
          blockProduct += a * e;
        }
      }
      blockSsims.push(ssimFromMoments(count, blockActual, blockExpected, blockActual2, blockExpected2, blockProduct));
    }
  }
  blockSsims.sort((a, b) => a - b);
  const blockMean = blockSsims.reduce((sum, value) => sum + value, 0) / Math.max(1, blockSsims.length);
  const globalSsim = ssimFromMoments(pixelCount, sumActual, sumExpected, sumActual2, sumExpected2, sumProduct);

  const stats = {
    width: actual.width,
    height: actual.height,
    blockSize,
    meanAbsLumaDiff: round(sumAbs / pixelCount),
    rmsLumaDiff: round(Math.sqrt(sumSq / pixelCount)),
    p95LumaDiff: round(percentileFromHistogram(diffHistogram, 0.95, pixelCount)),
    maxLumaDiff: round(maxDiff),
    changedFraction: round(changedPixels / pixelCount),
    lumaSsim: round(globalSsim),
    blockMeanSsim: round(blockMean),
    blockP05Ssim: round(percentile(blockSsims, 0.05)),
    blockMinSsim: round(blockSsims[0] ?? 1),
    actualHash: actual.hash,
    expectedHash: expected.hash,
  };
  const failures = [];
  if (stats.meanAbsLumaDiff > thresholds.perceptualMeanAbsMaximum) {
    failures.push(`perceptualMeanAbsLumaDiff ${stats.meanAbsLumaDiff} exceeds ${thresholds.perceptualMeanAbsMaximum}`);
  }
  if (stats.rmsLumaDiff > thresholds.perceptualRmsMaximum) {
    failures.push(`perceptualRmsLumaDiff ${stats.rmsLumaDiff} exceeds ${thresholds.perceptualRmsMaximum}`);
  }
  if (stats.p95LumaDiff > thresholds.perceptualP95Maximum) {
    failures.push(`perceptualP95LumaDiff ${stats.p95LumaDiff} exceeds ${thresholds.perceptualP95Maximum}`);
  }
  if (stats.changedFraction > thresholds.perceptualChangedFractionMaximum) {
    failures.push(`perceptualChangedFraction ${stats.changedFraction} exceeds ${thresholds.perceptualChangedFractionMaximum}`);
  }
  if (stats.lumaSsim < thresholds.perceptualSsimMinimum) {
    failures.push(`perceptualLumaSsim ${stats.lumaSsim} below ${thresholds.perceptualSsimMinimum}`);
  }
  if (stats.blockP05Ssim < thresholds.perceptualBlockP05SsimMinimum) {
    failures.push(`perceptualBlockP05Ssim ${stats.blockP05Ssim} below ${thresholds.perceptualBlockP05SsimMinimum}`);
  }
  return { skipped: false, failures, stats };
}

function safeFileStem(value) {
  return String(value ?? 'visual').replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'visual';
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function relativeUrl(fromDir, filePath) {
  return path.relative(fromDir, filePath).replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
}

function scaledSignatureRgba(signature, scale) {
  const decoded = decodeSignature(signature);
  if (!decoded) return null;
  const width = decoded.width * scale;
  const height = decoded.height * scale;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(x / scale);
      const source = (sy * decoded.width + sx) * 3;
      const target = (y * width + x) * 4;
      rgba[target + 0] = decoded.bytes[source + 0];
      rgba[target + 1] = decoded.bytes[source + 1];
      rgba[target + 2] = decoded.bytes[source + 2];
      rgba[target + 3] = 255;
    }
  }
  return { width, height, rgba, decoded };
}

function signatureDiffRgba(actualSignature, expectedSignature, scale) {
  const actual = decodeSignature(actualSignature);
  const expected = decodeSignature(expectedSignature);
  if (!actual || !expected || actual.width !== expected.width || actual.height !== expected.height) return null;
  const width = actual.width * scale;
  const height = actual.height * scale;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(x / scale);
      const source = (sy * actual.width + sx) * 3;
      const dr = Math.abs(actual.bytes[source + 0] - expected.bytes[source + 0]) / 255;
      const dg = Math.abs(actual.bytes[source + 1] - expected.bytes[source + 1]) / 255;
      const db = Math.abs(actual.bytes[source + 2] - expected.bytes[source + 2]) / 255;
      const diff = Math.min(1, ((dr + dg + db) / 3) * 8);
      const target = (y * width + x) * 4;
      rgba[target + 0] = Math.round(32 + diff * 223);
      rgba[target + 1] = Math.round(diff * diff * 212);
      rgba[target + 2] = Math.round((1 - diff) * 32);
      rgba[target + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function perceptualDiffRgba(actualField, expectedField) {
  const actual = decodePerceptualField(actualField);
  const expected = decodePerceptualField(expectedField);
  if (!actual || !expected || actual.width !== expected.width || actual.height !== expected.height) return null;
  const width = actual.width;
  const height = actual.height;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < actual.bytes.length; i++) {
    const delta = (actual.bytes[i] - expected.bytes[i]) / 255;
    const strength = Math.min(1, Math.abs(delta) * 5.0);
    const target = i * 4;
    rgba[target + 0] = Math.round(26 + Math.max(0, delta) * 229);
    rgba[target + 1] = Math.round(34 + (1 - strength) * 76);
    rgba[target + 2] = Math.round(34 + Math.max(0, -delta) * 221);
    rgba[target + 3] = 255;
  }
  return { width, height, rgba };
}

function comparisonReportPayload(result, reportPaths) {
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    name: result.name,
    image: result.image,
    passed: result.failures.length === 0,
    failures: result.failures,
    actual: result.actual,
    expected: result.expected,
    thresholds: result.thresholds,
    signature: result.signature,
    perceptual: result.perceptual,
    artifacts: reportPaths,
  };
}

function writeComparisonReport(reportDir, result, actualSignature, expectedSignature, actualPerceptual, expectedPerceptual) {
  mkdirSync(reportDir, { recursive: true });
  const stem = safeFileStem(result.name);
  const paths = {
    json: path.join(reportDir, `${stem}.json`),
    html: path.join(reportDir, `${stem}.html`),
    actualSignature: path.join(reportDir, `${stem}-actual-signature.png`),
    expectedSignature: path.join(reportDir, `${stem}-expected-signature.png`),
    diffSignature: path.join(reportDir, `${stem}-signature-diff.png`),
    perceptualDiff: path.join(reportDir, `${stem}-perceptual-diff.png`),
  };

  const actualPreview = scaledSignatureRgba(actualSignature, SIGNATURE_ARTIFACT_SCALE);
  const expectedPreview = scaledSignatureRgba(expectedSignature, SIGNATURE_ARTIFACT_SCALE);
  const diffPreview = signatureDiffRgba(actualSignature, expectedSignature, SIGNATURE_ARTIFACT_SCALE);
  const perceptualDiff = perceptualDiffRgba(actualPerceptual, expectedPerceptual);
  if (actualPreview) writeRgbaPng(paths.actualSignature, actualPreview.width, actualPreview.height, actualPreview.rgba);
  if (expectedPreview) writeRgbaPng(paths.expectedSignature, expectedPreview.width, expectedPreview.height, expectedPreview.rgba);
  if (diffPreview) writeRgbaPng(paths.diffSignature, diffPreview.width, diffPreview.height, diffPreview.rgba);
  if (perceptualDiff) writeRgbaPng(paths.perceptualDiff, perceptualDiff.width, perceptualDiff.height, perceptualDiff.rgba);

  const payload = comparisonReportPayload(result, Object.fromEntries(
    Object.entries(paths).map(([key, value]) => [key, value.replaceAll('\\', '/')]),
  ));
  writeFileSync(paths.json, `${JSON.stringify(payload, null, 2)}\n`);

  const signatureStats = result.signature?.stats;
  const perceptualStats = result.perceptual?.stats;
  const failureItems = result.failures.length > 0
    ? result.failures.map(item => `<li>${htmlEscape(item)}</li>`).join('\n')
    : '<li>None</li>';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Visual Regression: ${htmlEscape(result.name)}</title>
  <style>
    body { margin: 24px; font: 14px/1.5 system-ui, sans-serif; color: #16202a; background: #f7f8fa; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
    code { background: #e9eef3; border-radius: 4px; padding: 1px 4px; }
    .status { display: inline-block; padding: 3px 8px; border-radius: 4px; color: white; background: ${result.failures.length === 0 ? '#137a46' : '#a0362c'}; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; align-items: start; }
    figure { margin: 0; padding: 12px; background: white; border: 1px solid #d7dde5; border-radius: 6px; }
    img { display: block; max-width: 100%; height: auto; background: #111; }
    table { border-collapse: collapse; background: white; }
    th, td { border: 1px solid #d7dde5; padding: 6px 8px; text-align: right; }
    th:first-child, td:first-child { text-align: left; }
  </style>
</head>
<body>
  <h1>Visual Regression: ${htmlEscape(result.name)} <span class="status">${result.failures.length === 0 ? 'passed' : 'failed'}</span></h1>
  <p>Image: <code>${htmlEscape(result.image)}</code></p>
  <h2>Failures</h2>
  <ul>${failureItems}</ul>
  <h2>Metrics</h2>
  <table>
    <tr><th>Metric</th><th>Actual</th><th>Expected</th></tr>
    ${['meanLuma', 'stdLuma', 'greenFraction', 'whiteFraction', 'brightFraction', 'nonBlackFraction', 'sampledColors'].map(key => `<tr><td>${key}</td><td>${htmlEscape(result.actual[key])}</td><td>${htmlEscape(result.expected[key])}</td></tr>`).join('\n')}
    ${signatureStats ? `<tr><td>signature mean diff</td><td>${signatureStats.meanAbsColorDiff}</td><td>0</td></tr>
    <tr><td>signature rms diff</td><td>${signatureStats.rmsColorDiff}</td><td>0</td></tr>
    <tr><td>signature p95 diff</td><td>${signatureStats.p95ColorDiff}</td><td>0</td></tr>
    <tr><td>signature luma SSIM</td><td>${signatureStats.lumaSsim}</td><td>1</td></tr>` : ''}
    ${perceptualStats ? `<tr><td>full-res mean luma diff</td><td>${perceptualStats.meanAbsLumaDiff}</td><td>0</td></tr>
    <tr><td>full-res rms luma diff</td><td>${perceptualStats.rmsLumaDiff}</td><td>0</td></tr>
    <tr><td>full-res p95 luma diff</td><td>${perceptualStats.p95LumaDiff}</td><td>0</td></tr>
    <tr><td>full-res luma SSIM</td><td>${perceptualStats.lumaSsim}</td><td>1</td></tr>
    <tr><td>full-res p05 block SSIM</td><td>${perceptualStats.blockP05Ssim}</td><td>1</td></tr>` : ''}
  </table>
  <h2>Artifacts</h2>
  <div class="grid">
    <figure><figcaption>Actual screenshot</figcaption><img src="${relativeUrl(reportDir, result.image)}" alt="Actual screenshot"></figure>
    ${expectedPreview ? `<figure><figcaption>Expected signature</figcaption><img src="${relativeUrl(reportDir, paths.expectedSignature)}" alt="Expected signature"></figure>` : ''}
    ${actualPreview ? `<figure><figcaption>Actual signature</figcaption><img src="${relativeUrl(reportDir, paths.actualSignature)}" alt="Actual signature"></figure>` : ''}
    ${diffPreview ? `<figure><figcaption>Signature diff heatmap</figcaption><img src="${relativeUrl(reportDir, paths.diffSignature)}" alt="Signature diff"></figure>` : ''}
    ${perceptualDiff ? `<figure><figcaption>Full-resolution luma diff heatmap</figcaption><img src="${relativeUrl(reportDir, paths.perceptualDiff)}" alt="Full-resolution luma diff"></figure>` : ''}
  </div>
</body>
</html>
`;
  writeFileSync(paths.html, html);
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value.replaceAll('\\', '/')]));
}

function defaultThresholds() {
  return {
    meanR: 0.08,
    meanG: 0.08,
    meanB: 0.08,
    meanLuma: 0.08,
    stdLuma: 0.08,
    darkFraction: 0.05,
    brightFraction: 0.08,
    greenFraction: 0.12,
    whiteFraction: 0.12,
    topHalfLuma: 0.10,
    bottomHalfLuma: 0.10,
    nonBlackFractionMinimum: 0.98,
    sampledColorsMinimum: 1000,
    signatureMeanAbsMaximum: 0.07,
    signatureRmsMaximum: 0.12,
    signatureP95Maximum: 0.24,
    signatureMaxMaximum: 0.80,
    signatureSsimMinimum: 0.82,
    perceptualMeanAbsMaximum: 0.055,
    perceptualRmsMaximum: 0.095,
    perceptualP95Maximum: 0.20,
    perceptualChangedPixelLumaThreshold: 0.08,
    perceptualChangedFractionMaximum: 0.28,
    perceptualSsimMinimum: 0.78,
    perceptualBlockP05SsimMinimum: 0.46,
  };
}

function readBaseline(filePath) {
  if (!existsSync(filePath)) {
    return { schema: 1, updatedAt: null, cases: [] };
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (parsed.schema !== 1 || !Array.isArray(parsed.cases)) {
    throw new Error(`Unsupported visual baseline schema in ${filePath}`);
  }
  return parsed;
}

function writeBaseline(filePath, baseline) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

function caseByName(baseline, name) {
  return baseline.cases.find(item => item.name === name);
}

function compareMetrics(actual, expected, thresholds) {
  const failures = [];
  if (actual.width !== expected.width || actual.height !== expected.height) {
    failures.push(`dimensions expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`);
  }
  for (const key of ['meanR', 'meanG', 'meanB', 'meanLuma', 'stdLuma', 'darkFraction', 'brightFraction', 'greenFraction', 'whiteFraction', 'topHalfLuma', 'bottomHalfLuma']) {
    const tolerance = thresholds[key];
    if (typeof tolerance !== 'number') continue;
    const delta = Math.abs(actual[key] - expected[key]);
    if (delta > tolerance) {
      failures.push(`${key} delta ${round(delta)} exceeds ${tolerance} (expected ${expected[key]}, got ${actual[key]})`);
    }
  }
  if (actual.nonBlackFraction < (thresholds.nonBlackFractionMinimum ?? 0)) {
    failures.push(`nonBlackFraction ${actual.nonBlackFraction} below minimum ${thresholds.nonBlackFractionMinimum}`);
  }
  if (actual.sampledColors < (thresholds.sampledColorsMinimum ?? 0)) {
    failures.push(`sampledColors ${actual.sampledColors} below minimum ${thresholds.sampledColorsMinimum}`);
  }
  return failures;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseline = readBaseline(args.baseline);

  if (args.list) {
    for (const item of baseline.cases) {
      console.log(`${item.name}\t${item.width}x${item.height}\t${item.source ?? ''}`);
    }
    return;
  }

  if (args.update) {
    if (!args.image) throw new Error('--update requires --image');
    const analysis = analyzeScreenshot(args.image);
    const { metrics, signature, perceptual } = analysis;
    const nextCase = {
      name: args.name,
      source: args.image.replaceAll('\\', '/'),
      capturedAt: new Date().toISOString(),
      width: metrics.width,
      height: metrics.height,
      metrics,
      signature,
      perceptual,
      thresholds: defaultThresholds(),
    };
    const index = baseline.cases.findIndex(item => item.name === args.name);
    if (index >= 0) baseline.cases[index] = nextCase;
    else baseline.cases.push(nextCase);
    baseline.updatedAt = new Date().toISOString();
    writeBaseline(args.baseline, baseline);
    console.log(`Updated ${args.baseline} case "${args.name}" from ${args.image}`);
    console.log(JSON.stringify({
      metrics,
      signature: { ...signature, data: `<${signature.data.length} base64 chars>` },
      perceptual: { ...perceptual, data: `<${perceptual.data.length} base64 chars>` },
    }, null, 2));
    return;
  }

  const expectedCase = caseByName(baseline, args.name);
  if (!expectedCase) throw new Error(`No visual baseline case named "${args.name}". Run with --update first.`);
  const imagePath = args.image || expectedCase.source;
  if (!imagePath) throw new Error('No --image was provided and the baseline case has no source path.');
  if (!existsSync(imagePath)) throw new Error(`Screenshot not found: ${imagePath}`);

  const actualAnalysis = analyzeScreenshot(imagePath);
  const actual = actualAnalysis.metrics;
  const expected = expectedCase.metrics;
  const thresholds = { ...defaultThresholds(), ...(expectedCase.thresholds ?? {}) };
  const signatureComparison = compareSignatures(actualAnalysis.signature, expectedCase.signature, thresholds);
  const perceptualComparison = comparePerceptualFields(actualAnalysis.perceptual, expectedCase.perceptual, thresholds);
  const failures = [
    ...compareMetrics(actual, expected, thresholds),
    ...signatureComparison.failures,
    ...perceptualComparison.failures,
  ];
  const result = {
    name: args.name,
    image: imagePath,
    failures,
    actual,
    expected,
    thresholds,
    signature: signatureComparison,
    perceptual: perceptualComparison,
  };
  if (args.reportDir) {
    result.report = writeComparisonReport(
      args.reportDir,
      result,
      actualAnalysis.signature,
      expectedCase.signature,
      actualAnalysis.perceptual,
      expectedCase.perceptual,
    );
  }
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Visual regression case "${args.name}"`);
    console.log(`Image: ${imagePath}`);
    console.log(`Dimensions: ${actual.width}x${actual.height}`);
    console.log(`Mean luma: ${actual.meanLuma} | Std luma: ${actual.stdLuma} | sampled colors: ${actual.sampledColors}`);
    console.log(`Fractions: green ${actual.greenFraction}, white ${actual.whiteFraction}, bright ${actual.brightFraction}, nonblack ${actual.nonBlackFraction}`);
    if (signatureComparison.skipped) {
      console.log(`Signature: skipped (${signatureComparison.reason})`);
    } else if (signatureComparison.stats) {
      const s = signatureComparison.stats;
      console.log(`Signature: mean ${s.meanAbsColorDiff} | rms ${s.rmsColorDiff} | p95 ${s.p95ColorDiff} | ssim ${s.lumaSsim}`);
    }
    if (perceptualComparison.skipped) {
      console.log(`Full-res perceptual: skipped (${perceptualComparison.reason})`);
    } else if (perceptualComparison.stats) {
      const p = perceptualComparison.stats;
      console.log(`Full-res perceptual: mean ${p.meanAbsLumaDiff} | rms ${p.rmsLumaDiff} | p95 ${p.p95LumaDiff} | changed ${p.changedFraction} | ssim ${p.lumaSsim} | block p05 ${p.blockP05Ssim}`);
    }
    if (result.report) {
      console.log(`Report: ${result.report.html}`);
    }
    if (failures.length > 0) {
      console.error(`Visual regression failed:\n- ${failures.join('\n- ')}`);
    } else {
      console.log('Visual regression passed.');
    }
  }
  if (failures.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
