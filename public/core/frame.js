const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const MAX_META_BYTES = 65_536;

export function encodeFrame(meta, bytes = null) {
  const metaBytes = encoder.encode(JSON.stringify(meta));
  if (metaBytes.byteLength > MAX_META_BYTES) throw new RangeError('metadata_too_large');
  const body = bytes == null
    ? new Uint8Array(0)
    : new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
  const output = new Uint8Array(4 + metaBytes.byteLength + body.byteLength);
  new DataView(output.buffer).setUint32(0, metaBytes.byteLength, false);
  output.set(metaBytes, 4);
  output.set(body, 4 + metaBytes.byteLength);
  return output;
}

export function decodeFrame(value) {
  const input = value instanceof Uint8Array
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  if (input.byteLength < 4) throw new RangeError('invalid_frame');
  const length = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(0, false);
  if (length > MAX_META_BYTES || 4 + length > input.byteLength) throw new RangeError('invalid_frame');
  let meta;
  try {
    meta = JSON.parse(decoder.decode(input.subarray(4, 4 + length)));
  } catch {
    throw new TypeError('invalid_frame');
  }
  return { meta, bytes: input.slice(4 + length) };
}
