#!/usr/bin/env node
/** TWINFORGE — optional SAM 3.1 mask decoding via @meta-sam/parser.
 * Usage : npm install (dans perception/) puis
 *   node decode_masks.mjs sam_output.txt
 * Reads SAM structured text (records <|box|><|mask|>) et affiche, par masque,
 * raster centroid + area in pixels. Without the package, the Python pipeline
 * falls back to box centroids (documented in the report).
 */
import { readFileSync } from 'node:fs';

let parser;
try {
  parser = await import('@meta-sam/parser');
} catch {
  console.error('@meta-sam/parser not found — run `npm install` in perception/. Pipeline fallback: box centroids.');
  process.exit(2);
}
const { parseImageStream, decodeMaskToRaster, recordsOfKind } = parser;

const text = readFileSync(process.argv[2], 'utf8');
async function* events() {
  yield { type: 'response.output_text.done', item_id: 'm1', output_index: 0, content_index: 0, text };
  yield { type: 'response.completed' };
}
const parsed = parseImageStream(events());
const result = await parsed.finalResult;
const out = [];
for (const rec of recordsOfKind(result.records, 'mask')) {
  const raster = decodeMaskToRaster(rec.mask); // Uint8Array 0/1, taille = bounds
  const w = rec.bounds.right - rec.bounds.left, h = rec.bounds.bottom - rec.bounds.top;
  let area = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (raster[y * w + x]) { area++; sx += x; sy += y; }
  }
  out.push({ object_id: rec.objectId, bounds: rec.bounds, area_px: area,
             centroid_image: area ? [+(rec.bounds.left + sx / area).toFixed(1), +(rec.bounds.top + sy / area).toFixed(1)] : null });
}
console.log(JSON.stringify(out, null, 1));
