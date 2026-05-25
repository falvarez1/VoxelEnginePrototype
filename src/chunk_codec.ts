import type { TypedArrayPool } from './typed_array_pool.ts';

export const DENSITY_CODEC_RAW = 'raw-i16';
export const DENSITY_CODEC_DELTA_VARINT = 'delta-varint-i16-v1';
export const BYTE_CODEC_RAW = 'raw-bytes';
export const BYTE_CODEC_LZSS = 'lzss-bytes-v1';

export type DensityCodec = typeof DENSITY_CODEC_RAW | typeof DENSITY_CODEC_DELTA_VARINT;
export type BytePayloadCodec = typeof BYTE_CODEC_RAW | typeof BYTE_CODEC_LZSS;

export interface EncodedDensitySamples {
  codec: DensityCodec;
  bytes: Uint8Array;
  sampleCount: number;
  rawBytes: number;
}

export interface EncodedBytePayload {
  codec: BytePayloadCodec;
  bytes: Uint8Array;
  rawBytes: number;
}

export interface PayloadCompressionStats {
  payloads: number;
  rawBytes: number;
  encodedBytes: number;
  savedBytes: number;
  ratio: number;
  rawPayloads: number;
  lzssPayloads: number;
  deltaVarintPayloads: number;
}

export function createPayloadCompressionStats(): PayloadCompressionStats {
  return {
    payloads: 0,
    rawBytes: 0,
    encodedBytes: 0,
    savedBytes: 0,
    ratio: 1,
    rawPayloads: 0,
    lzssPayloads: 0,
    deltaVarintPayloads: 0,
  };
}

export function addPayloadCompression(
  stats: PayloadCompressionStats,
  codec: string | undefined,
  encodedBytes: number,
  rawBytes: number,
): PayloadCompressionStats {
  stats.payloads++;
  stats.rawBytes += rawBytes;
  stats.encodedBytes += encodedBytes;
  stats.savedBytes = Math.max(0, stats.rawBytes - stats.encodedBytes);
  stats.ratio = stats.rawBytes > 0 ? stats.encodedBytes / stats.rawBytes : 1;
  if (codec === BYTE_CODEC_LZSS) stats.lzssPayloads++;
  else if (codec === DENSITY_CODEC_DELTA_VARINT) stats.deltaVarintPayloads++;
  else stats.rawPayloads++;
  return stats;
}

export function addEncodedBytePayload(stats: PayloadCompressionStats, payload: EncodedBytePayload): PayloadCompressionStats {
  return addPayloadCompression(stats, payload.codec, payload.bytes.byteLength, payload.rawBytes);
}

export function addEncodedDensityPayload(stats: PayloadCompressionStats, payload: EncodedDensitySamples): PayloadCompressionStats {
  return addPayloadCompression(stats, payload.codec, payload.bytes.byteLength, payload.rawBytes);
}

function copyBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

function encodeLzss(source: Uint8Array): Uint8Array {
  const minMatch = 3;
  const maxMatch = 18;
  const windowSize = 4096;
  const hashSize = 1 << 15;
  if (source.byteLength < minMatch) return source.slice();

  const table = new Int32Array(hashSize);
  table.fill(-1);
  const output = new Uint8Array(source.byteLength + Math.ceil(source.byteLength / 8) + 16);
  let inputOffset = 0;
  let outputOffset = 0;

  const hashAt = (offset: number): number => (
    ((source[offset] * 73856093) ^ (source[offset + 1] * 19349663) ^ (source[offset + 2] * 83492791)) & (hashSize - 1)
  );

  while (inputOffset < source.byteLength) {
    const flagOffset = outputOffset++;
    let flags = 0;
    for (let bit = 0; bit < 8 && inputOffset < source.byteLength; bit++) {
      let bestLength = 0;
      let bestOffset = 0;
      if (inputOffset + minMatch <= source.byteLength) {
        const hash = hashAt(inputOffset);
        const candidate = table[hash];
        table[hash] = inputOffset;
        if (candidate >= 0 && inputOffset - candidate <= windowSize) {
          const limit = Math.min(maxMatch, source.byteLength - inputOffset);
          while (bestLength < limit && source[candidate + bestLength] === source[inputOffset + bestLength]) bestLength++;
          if (bestLength >= minMatch) bestOffset = inputOffset - candidate;
          else bestLength = 0;
        }
      }

      if (bestLength >= minMatch) {
        const token = ((bestLength - minMatch) << 12) | (bestOffset - 1);
        output[outputOffset++] = token & 0xff;
        output[outputOffset++] = token >> 8;
        for (let i = 1; i < bestLength && inputOffset + i + minMatch <= source.byteLength; i++) {
          table[hashAt(inputOffset + i)] = inputOffset + i;
        }
        inputOffset += bestLength;
      } else {
        flags |= 1 << bit;
        output[outputOffset++] = source[inputOffset++];
      }
    }
    output[flagOffset] = flags;
  }

  return output.slice(0, outputOffset);
}

function decodeLzss(source: Uint8Array, rawBytes: number, pool?: TypedArrayPool): Uint8Array {
  const minMatch = 3;
  const output = pool?.acquireUint8(rawBytes) ?? new Uint8Array(rawBytes);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < source.byteLength && outputOffset < rawBytes) {
    const flags = source[inputOffset++];
    for (let bit = 0; bit < 8 && outputOffset < rawBytes; bit++) {
      if ((flags & (1 << bit)) !== 0) {
        if (inputOffset >= source.byteLength) throw new Error('LZSS byte payload ended inside a literal.');
        output[outputOffset++] = source[inputOffset++];
      } else {
        if (inputOffset + 1 >= source.byteLength) throw new Error('LZSS byte payload ended inside a match token.');
        const token = source[inputOffset++] | (source[inputOffset++] << 8);
        const offset = (token & 0x0fff) + 1;
        const length = (token >> 12) + minMatch;
        const start = outputOffset - offset;
        if (start < 0) throw new Error('LZSS byte payload referenced data before the output buffer.');
        for (let i = 0; i < length && outputOffset < rawBytes; i++) {
          output[outputOffset] = output[start + i];
          outputOffset++;
        }
      }
    }
  }

  if (outputOffset !== rawBytes) throw new Error('LZSS byte payload did not fill the expected output length.');
  if (inputOffset !== source.byteLength) throw new Error('LZSS byte payload has trailing bytes.');
  return output;
}

function encodeSignedVarint(value: number, target: Uint8Array, offset: number): number {
  let encoded = value < 0 ? (-value * 2) - 1 : value * 2;
  do {
    let byte = encoded & 0x7f;
    encoded = Math.floor(encoded / 128);
    if (encoded > 0) byte |= 0x80;
    target[offset++] = byte;
  } while (encoded > 0);
  return offset;
}

function decodeSignedVarint(source: Uint8Array, offset: number): [number, number] {
  let encoded = 0;
  let shift = 0;
  while (true) {
    if (offset >= source.byteLength) throw new Error('Delta-varint density payload ended unexpectedly.');
    const byte = source[offset++];
    encoded += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new Error('Delta-varint density value is too large.');
  }
  const value = (encoded & 1) === 1 ? -((encoded + 1) / 2) : encoded / 2;
  return [value, offset];
}

function encodeDeltaVarint(samples: Int16Array): Uint8Array {
  const target = new Uint8Array(samples.length * 3);
  let offset = 0;
  let previous = 0;
  for (const sample of samples) {
    offset = encodeSignedVarint(sample - previous, target, offset);
    previous = sample;
  }
  return target.slice(0, offset);
}

function decodeDeltaVarint(bytes: Uint8Array, sampleCount: number, pool?: TypedArrayPool): Int16Array {
  const samples = pool?.acquireInt16(sampleCount) ?? new Int16Array(sampleCount);
  let offset = 0;
  let previous = 0;
  for (let i = 0; i < sampleCount; i++) {
    const [delta, nextOffset] = decodeSignedVarint(bytes, offset);
    const sample = previous + delta;
    if (sample < -32768 || sample > 32767) throw new Error('Decoded density sample is outside int16 range.');
    samples[i] = sample;
    previous = sample;
    offset = nextOffset;
  }
  if (offset !== bytes.byteLength) throw new Error('Delta-varint density payload has trailing bytes.');
  return samples;
}

export function encodeDensitySamples(samples: Int16Array): EncodedDensitySamples {
  const raw = copyBytes(samples);
  const compressed = samples.length > 0 ? encodeDeltaVarint(samples) : raw;
  if (compressed.byteLength < raw.byteLength) {
    return {
      codec: DENSITY_CODEC_DELTA_VARINT,
      bytes: compressed,
      sampleCount: samples.length,
      rawBytes: raw.byteLength,
    };
  }
  return {
    codec: DENSITY_CODEC_RAW,
    bytes: raw,
    sampleCount: samples.length,
    rawBytes: raw.byteLength,
  };
}

export function encodeBytePayload(view: ArrayBufferView): EncodedBytePayload {
  const raw = copyBytes(view);
  const compressed = encodeLzss(raw);
  if (compressed.byteLength < raw.byteLength) {
    return {
      codec: BYTE_CODEC_LZSS,
      bytes: compressed,
      rawBytes: raw.byteLength,
    };
  }
  return {
    codec: BYTE_CODEC_RAW,
    bytes: raw,
    rawBytes: raw.byteLength,
  };
}

export function decodeBytePayload(codec: string | undefined, bytes: Uint8Array, rawBytes?: number, pool?: TypedArrayPool): Uint8Array {
  const normalized = codec ?? BYTE_CODEC_RAW;
  if (normalized === BYTE_CODEC_RAW) {
    if (rawBytes !== undefined && bytes.byteLength !== rawBytes) throw new Error('Raw byte payload length mismatch.');
    const output = pool?.acquireUint8(bytes.byteLength) ?? new Uint8Array(bytes.byteLength);
    output.set(bytes);
    return output;
  }
  if (normalized === BYTE_CODEC_LZSS) {
    if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) throw new Error('Compressed byte payload is missing a valid raw length.');
    return decodeLzss(bytes, rawBytes, pool);
  }
  throw new Error(`Unsupported byte payload codec: ${normalized}.`);
}

export function decodeDensitySamples(codec: string | undefined, bytes: Uint8Array, sampleCount?: number, pool?: TypedArrayPool): Int16Array {
  const normalized = codec ?? DENSITY_CODEC_RAW;
  if (normalized === DENSITY_CODEC_RAW) {
    if (bytes.byteLength % Int16Array.BYTES_PER_ELEMENT !== 0) throw new Error('Raw density payload is not int16 aligned.');
    const decoded = pool?.acquireInt16(bytes.byteLength / Int16Array.BYTES_PER_ELEMENT) ?? new Int16Array(bytes.byteLength / Int16Array.BYTES_PER_ELEMENT);
    new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength).set(bytes);
    if (sampleCount !== undefined && decoded.length !== sampleCount) throw new Error('Raw density payload sample count mismatch.');
    return decoded;
  }
  if (normalized === DENSITY_CODEC_DELTA_VARINT) {
    if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) throw new Error('Compressed density payload is missing a valid sample count.');
    return decodeDeltaVarint(bytes, sampleCount, pool);
  }
  throw new Error(`Unsupported density codec: ${normalized}.`);
}
