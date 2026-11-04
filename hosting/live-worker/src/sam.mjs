import {parseImageStream, decodeMaskToRaster, decodeMaskToSVGPath, recordsOfKind} from '@meta-sam/parser';
import {HttpError, initializeBudget, summary, reserve, settle, IMAGE_UNITS, MAX_RUN_REQUESTS} from './budget.mjs';
import {validateFrame, readBoundedBody, sha256} from './frame.mjs';

const MODEL = 'sam-3.1';
const PROVIDER = 'meta-model-api';
const encoder = new TextEncoder();

export async function samStatus(env) {
  const keyAvailable = typeof env.META_MODEL_API_KEY === 'string' && env.META_MODEL_API_KEY.length > 0;
  let budget = null, budgetError = null;
  try { await initializeBudget(env); budget = await summary(env); }
  catch (error) { budgetError = error instanceof HttpError ? error.message : 'Persistent vision budget storage is unavailable.'; }
  const remaining = budget?.remaining_requests ?? 0;
  return {
    schema_version: 'twinforge.sam.status.v1', available: keyAvailable && !budgetError && remaining > 0,
    key_available: keyAvailable, decoder_available: true, budget_available: !budgetError,
    model: MODEL, provider: PROVIDER, live_only: true,
    price_per_image_usd: IMAGE_UNITS / 10000, max_requests_per_run: MAX_RUN_REQUESTS,
    max_image_side: 640, budget_scene: 'vision', budget,
    remaining_requests: remaining,
    remaining_usd: budget ? Math.max(0, budget.limit_per_scene - budget.scenes.vision) : 0,
    ...(budgetError ? {error: budgetError} : {}),
    scope: 'SAM segments pixels; a separate predictor estimates future motion.',
  };
}

function outputText(response) {
  if (!response || ['failed', 'incomplete', 'cancelled'].includes(response.status) || !Array.isArray(response.output)) {
    throw new HttpError(503, 'SAM did not return a completed image response.');
  }
  return response.output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
}

export async function detectionsFromText(text, frame) {
  if (!text.trim()) return [];
  // Preserve the provider's original source dimensions: the parser's bounds
  // are half-open but intentionally do not retain these wire w/h fields.
  const boxes = [...text.matchAll(/(\d+)<\|box;([^|]*)\|>/g)];
  if (!boxes.length || boxes.length > 32) throw new HttpError(503, 'SAM returned no readable bounded mask records.');
  for (const [, , attributes] of boxes) {
    const box = Object.fromEntries(attributes.split(';').filter(v => v.includes('=')).map(v => v.split('=').map(x => x.trim())));
    if (Number(box.w) !== frame.width || Number(box.h) !== frame.height) throw new HttpError(503, 'SAM coordinates do not match the submitted image.');
  }
  // Bound the wire raster before the official parser decodes it internally.
  const dimensions = [...text.matchAll(/<\|mask;[^|]*?data=([0-9]+),([0-9]+),/g)];
  if (dimensions.length !== boxes.length) throw new HttpError(503, 'SAM mask missing; box-only fallback is disabled.');
  for (const [, height, width] of dimensions) {
    if (!Number.isSafeInteger(Number(height)) || !Number.isSafeInteger(Number(width)) ||
      Number(height) < 1 || Number(width) < 1 || Number(height) > frame.height || Number(width) > frame.width) {
      throw new HttpError(503, 'SAM mask raster exceeds the submitted image.');
    }
  }
  async function* events() {
    yield {type: 'response.output_text.done', item_id: 'm1', output_index: 0, content_index: 0, text};
    yield {type: 'response.completed'};
  }
  let parsed;
  try {
    const stream = parseImageStream(events());
    for await (const snapshot of stream) { /* consume the provider text */ }
    parsed = await stream.finalResult;
  } catch { throw new HttpError(503, 'SAM mask decoding failed; no fallback detection was created.'); }
  if (parsed.diagnostics.some(d => d.severity === 'error')) throw new HttpError(503, 'SAM mask records are invalid.');
  const masks = recordsOfKind(parsed.records, 'mask');
  if (masks.length !== boxes.length) throw new HttpError(503, 'SAM mask missing; box-only fallback is disabled.');
  return masks.map(record => {
    const bounds = record.bounds, width = record.mask.width, height = record.mask.height;
    if (![bounds.left, bounds.top, bounds.right, bounds.bottom, width, height].every(Number.isInteger) ||
      bounds.left < 0 || bounds.top < 0 || bounds.right > frame.width || bounds.bottom > frame.height ||
      width < 1 || height < 1 || width > 640 || height > 640 ||
      bounds.right - bounds.left !== width || bounds.bottom - bounds.top !== height) throw new HttpError(503, 'SAM returned an invalid mask box.');
    let raster, path;
    try { raster = decodeMaskToRaster(record.mask); path = decodeMaskToSVGPath(record.mask); }
    catch { throw new HttpError(503, 'SAM mask decoding failed.'); }
    if (raster.length !== width * height) throw new HttpError(503, 'SAM mask dimensions disagree.');
    const histogram = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let area = 0, sumX = 0, sumY = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!raster[y * width + x]) continue;
      const sourceX = bounds.left + x, sourceY = bounds.top + y;
      area++; sumX += sourceX; sumY += sourceY;
      const pixel = (sourceY * frame.width + sourceX) * 3;
      for (let channel = 0; channel < 3; channel++) histogram[channel][frame.image.data[pixel + channel]]++;
    }
    if (!area) throw new HttpError(503, 'SAM returned an empty foreground mask.');
    const median = counts => {
      let cumulative = 0, low = null;
      for (let n = 0; n < 256; n++) {
        cumulative += counts[n];
        if (low === null && cumulative > Math.floor((area-1)/2)) low = n;
        if (cumulative > Math.floor(area/2)) return (low + n) / 2;
      }
      return 0;
    };
    const polygons = [];
    let polygon = [], points = 0;
    for (const token of path.matchAll(/([MLZ])([^MLZ]*)/g)) {
      if (token[1] === 'Z') { if (polygon.length) polygons.push(polygon); polygon = []; }
      else {
        const pair = token[2].trim().split(/[ ,]+/).map(Number);
        if (pair.length !== 2 || !pair.every(Number.isFinite)) throw new HttpError(503, 'SAM returned an invalid contour.');
        polygon.push([pair[0] + bounds.left, pair[1] + bounds.top]); points++;
      }
      if (polygons.length > 128 || points > 20000) throw new HttpError(503, 'SAM mask contour exceeds the display limit.');
    }
    if (!polygons.length) throw new HttpError(503, 'SAM returned no mask contour.');
    return {
      id: String(record.objectId), box: {x1: bounds.left, y1: bounds.top, x2: bounds.right, y2: bounds.bottom},
      centroid: [sumX / area, sumY / area], area, polygons,
      color_rgb: histogram.map(median), mask_decoded: true,
    };
  });
}

export async function segment(request, env, providerFetch = fetch) {
  const started = performance.now();
  const frame = await validateFrame(await readBoundedBody(request));
  if (typeof env.META_MODEL_API_KEY !== 'string' || !env.META_MODEL_API_KEY) throw new HttpError(503, 'META_MODEL_API_KEY is not configured.');
  await initializeBudget(env);
  const payload = {model: MODEL, input: [{role: 'user', content: [
    {type: 'input_text', text: frame.concept},
    {type: 'input_image', image_url: 'data:image/jpeg;base64,' + frame.image_base64},
  ]}]};
  const payloadJson = JSON.stringify(payload), requestHash = await sha256(encoder.encode(payloadJson));
  const id = await reserve(env, frame, requestHash);
  let responseHash = null;
  try {
    let response;
    try {
      response = await providerFetch('https://api.meta.ai/v1/responses', {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + env.META_MODEL_API_KEY},
        body: payloadJson, signal: AbortSignal.timeout(120000),
      });
    } catch { throw new HttpError(503, 'SAM provider connection failed. The reserved image cost is retained.'); }
    if (!response.ok) throw new HttpError(503, 'SAM provider returned HTTP ' + response.status + '.');
    // Bound output too: a provider failure must not grow memory without limit.
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(503, 'SAM returned an empty response.');
    const chunks = []; let length = 0;
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.length;
      if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new HttpError(503, 'SAM response exceeds the decoding limit.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    responseHash = await sha256(bytes);
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new HttpError(503, 'SAM returned invalid JSON.'); }
    const detections = await detectionsFromText(outputText(data), frame);
    const result = {
      schema_version: 'twinforge.sam.frame.v1', run_id: frame.run_id, frame_id: frame.frame_id,
      source_time_s: frame.source_time_s, source_kind: frame.source_kind,
      width: frame.width, height: frame.height, image_sha256: frame.image_sha256,
      model: MODEL, provider: PROVIDER, evidence_id: id,
      status: detections.length ? 'detected' : 'no_matches', detections,
      receipt: {request_id: id, model: MODEL, request_sha256: requestHash},
      latency_ms: Math.round((performance.now() - started) * 100) / 100,
      charged_usd: IMAGE_UNITS / 10000, budget: await summary(env),
      observation_units: 'px', live_provider_call: true,
    };
    await settle(env, id, 'complete', responseHash, result);
    return result;
  } catch (error) {
    await settle(env, id, 'failed', responseHash);
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'SAM observation failed; no fallback detection was created.');
  }
}
