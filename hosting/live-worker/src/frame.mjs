import jpeg from 'jpeg-js';
import {HttpError} from './budget.mjs';

export const MAX_IMAGE_BYTES = 400 * 1024;
export const MAX_BODY_BYTES = 560 * 1024;
const FIELDS = ['concept', 'frame_id', 'image_base64', 'run_id', 'source_kind', 'source_time_s'];

// Coordinates are pixels in the exact submitted JPEG, not browser/CSS pixels.
// Meta's object-prompt grammar uses inclusive box ends; the public UI contract
// stays x/y/width/height, matching the tracker and avoiding edge off-by-ones.
export function validateSelection(value, width, height) {
  if (value == null) return null;
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new HttpError(400, 'Selection must be a point or box in image pixels.');
  const fields = value.type === 'point' ? ['type', 'x', 'y'] : value.type === 'box' ? ['height', 'type', 'width', 'x', 'y'] : null;
  if (!fields || Object.keys(value).sort().join(',') !== fields.join(',') ||
      fields.filter(k => k !== 'type').some(k => !Number.isSafeInteger(value[k]))) {
    throw new HttpError(400, 'Selection accepts only integer point or box coordinates.');
  }
  if (value.x < 0 || value.y < 0 || value.x >= width || value.y >= height ||
      (value.type === 'box' && (value.width < 1 || value.height < 1 || value.x + value.width > width || value.y + value.height > height))) {
    throw new HttpError(400, 'Selection lies outside the submitted image.');
  }
  return {...value};
}

export function buildSamPrompt(frame) {
  const selection = validateSelection(frame.selection, frame.width, frame.height);
  if (!selection) return frame.concept;
  const {x, y} = selection, size = ';w=' + frame.width + ';h=' + frame.height;
  if (selection.type === 'point') return '<0f>1<|point;x=' + x + ';y=' + y + size + '|>';
  return '<0f>1<|box;x1=' + x + ';y1=' + y + ';x2=' + (x + selection.width - 1) + ';y2=' + (y + selection.height - 1) + size + '|>';
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export async function readBoundedBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'SAM request exceeds the size limit.');
  if (!request.body) throw new HttpError(400, 'JSON body required.');
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, 'SAM request exceeds the size limit.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

// Inspect dimensions before allocating a decoder raster, and reject EXIF
// orientation rather than silently rotating coordinates away from the input.
export function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new HttpError(400, 'Only complete JPEG observation frames are accepted.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2, dimensions = null;
  while (offset < bytes.length - 1) {
    if (bytes[offset++] !== 0xff) throw new HttpError(400, 'JPEG could not be decoded.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new HttpError(400, 'Truncated JPEG.');
    const size = view.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) throw new HttpError(400, 'Truncated JPEG.');
    const start = offset + 2;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (size < 8) throw new HttpError(400, 'Invalid JPEG dimensions.');
      dimensions = {width: view.getUint16(start + 3), height: view.getUint16(start + 1)};
    }
    if (marker === 0xe1 && bytes[start] === 69 && bytes[start+1] === 120 && bytes[start+2] === 105 && bytes[start+3] === 102) {
      const tiff = start + 6, end = offset + size;
      if (tiff + 8 > end) throw new HttpError(400, 'Invalid JPEG EXIF metadata.');
      const little = view.getUint16(tiff) === 0x4949;
      if ((!little && view.getUint16(tiff) !== 0x4d4d) || view.getUint16(tiff+2, little) !== 42) throw new HttpError(400, 'Invalid JPEG EXIF metadata.');
      const directory = tiff + view.getUint32(tiff+4, little);
      if (directory + 2 > end) throw new HttpError(400, 'Invalid JPEG EXIF metadata.');
      const count = view.getUint16(directory, little);
      if (directory + 2 + count * 12 > end) throw new HttpError(400, 'Invalid JPEG EXIF metadata.');
      for (let i = 0; i < count; i++) {
        const entry = directory + 2 + i * 12;
        if (view.getUint16(entry, little) === 274 && view.getUint16(entry+8, little) !== 1) {
          throw new HttpError(400, 'Rotate JPEG pixels before submission; EXIF rotation is not accepted.');
        }
      }
    }
    offset += size;
  }
  if (!dimensions || Math.min(dimensions.width, dimensions.height) < 16 || Math.max(dimensions.width, dimensions.height) > 640) {
    throw new HttpError(400, 'JPEG dimensions must be between 16 and 640 pixels.');
  }
  return dimensions;
}

export async function validateFrame(raw) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object' || Object.keys(raw).filter(k => k !== 'selection').sort().join(',') !== FIELDS.join(',')) {
    throw new HttpError(400, 'A SAM frame accepts only pixels, concept, an optional visual selection, frame identity, source time, run identity and source kind.');
  }
  if (typeof raw.concept !== 'string' || !raw.concept.trim() || raw.concept.trim().length > 80 || /[\x00-\x1f<>|,;]/.test(raw.concept)) {
    throw new HttpError(400, 'Use one short object concept, such as ball or red cup.');
  }
  if (typeof raw.frame_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(raw.frame_id)) throw new HttpError(400, 'Invalid frame_id.');
  if (typeof raw.run_id !== 'string' || !/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(raw.run_id)) throw new HttpError(400, 'run_id must be a canonical lowercase UUID.');
  if (typeof raw.source_time_s !== 'number' || !Number.isFinite(raw.source_time_s) || raw.source_time_s < 0 || raw.source_time_s > 86400) throw new HttpError(400, 'Invalid source_time_s.');
  if (!['synthetic', 'camera', 'video'].includes(raw.source_kind)) throw new HttpError(400, 'Invalid source_kind.');
  const encoded = raw.image_base64;
  if (typeof encoded !== 'string' || !encoded || encoded.length > 4*Math.ceil(MAX_IMAGE_BYTES/3) || encoded.length%4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HttpError(400, 'Supply raw JPEG base64 below 400 KiB.');
  let bytes;
  try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); }
  catch { throw new HttpError(400, 'Invalid JPEG base64.'); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(400, 'JPEG exceeds the 400 KiB limit.');
  const dimensions = jpegDimensions(bytes);
  let image;
  try { image = jpeg.decode(bytes, {useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 1, maxMemoryUsageInMB: 32}); }
  catch { throw new HttpError(400, 'JPEG could not be decoded.'); }
  if (image.width !== dimensions.width || image.height !== dimensions.height) throw new HttpError(400, 'JPEG dimensions disagree.');
  return {...raw, concept: raw.concept.trim(), selection:validateSelection(raw.selection, dimensions.width, dimensions.height),
    ...dimensions, image, image_sha256: await sha256(bytes)};
}
