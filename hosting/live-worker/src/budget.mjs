// Integer 0.0001 USD units avoid rounding at the persistent $0.50 ceiling.
export const LIMIT_UNITS = 5000;
export const IMAGE_UNITS = 25;
export const MAX_RUN_REQUESTS = 60;
export class HttpError extends Error {
  constructor(status, message, detail = {}) { super(message); this.status = status; this.detail = detail; }
}

export function baselineUnits(env) {
  const raw = String(env.INITIAL_VISION_SPENT_UNITS ?? '');
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) {
    throw new HttpError(503, 'The existing vision spend must be configured before hosted SAM can run.');
  }
  return Number(raw);
}

export async function initializeBudget(env) {
  const units = baselineUnits(env);
  if (!env.DB?.prepare) throw new HttpError(503, 'Persistent vision budget storage is unavailable.');
  // DML only; schema creation is exclusively a deployment migration. This
  // baseline reserves local allowance or imports prior spend. Raising it is
  // allowed; lowering it can never reset the combined ceiling.
  await env.DB.prepare(`INSERT INTO vision_budget_baseline (id, initial_units, updated_at)
    VALUES ('vision', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      initial_units = MAX(vision_budget_baseline.initial_units, excluded.initial_units),
      updated_at = excluded.updated_at`).bind(units, new Date().toISOString()).run();
}

export async function summary(env) {
  const row = await env.DB.prepare(`SELECT
    (SELECT initial_units FROM vision_budget_baseline WHERE id = 'vision') AS initial_units,
    COALESCE(SUM(units), 0) AS hosted_units, COUNT(*) AS requests
    FROM vision_requests`).first();
  if (!row || !Number.isInteger(row.initial_units)) throw new HttpError(503, 'Vision budget has not been initialized.');
  const spent = row.initial_units + row.hosted_units;
  return {
    currency: 'USD', limit_per_scene: LIMIT_UNITS / 10000,
    scenes: {vision: spent / 10000}, requests: row.requests,
    reserved_local_or_prior_usd: row.initial_units / 10000,
    budget_scope: 'The $0.50 combined ceiling includes the reserved local allowance or prior spend plus hosted image reservations. The reserved portion is unavailable to this hosted runtime; it is not necessarily money already spent.',
    hosted_requests: row.requests, persistent: true,
    remaining_requests: Math.max(0, Math.floor((LIMIT_UNITS - spent) / IMAGE_UNITS)),
  };
}

export const RESERVE_SQL = `INSERT INTO vision_requests
  (id, run_id, frame_id, source_time_s, source_kind, image_sha256,
   request_sha256, units, created_ms, status)
  SELECT ?, ?, ?, ?, ?, ?, ?, 25, ?, 'requesting'
  WHERE
    (SELECT initial_units FROM vision_budget_baseline WHERE id = 'vision')
      + (SELECT COALESCE(SUM(units), 0) FROM vision_requests) + 25 <= 5000
    AND (SELECT COUNT(*) FROM vision_requests WHERE run_id = ?) < 60
    AND NOT EXISTS (SELECT 1 FROM vision_requests WHERE run_id = ? AND frame_id = ?)
    AND NOT EXISTS (SELECT 1 FROM vision_requests WHERE run_id = ? AND source_time_s >= ?)
    AND NOT EXISTS (SELECT 1 FROM vision_requests WHERE status = 'requesting' AND created_ms > ?)
  RETURNING id`;

export async function reserve(env, frame, requestHash) {
  const id = crypto.randomUUID().replaceAll('-', ''), now = Date.now();
  // This single SQLite write checks and claims every quota atomically. A
  // restarted Worker or another isolate cannot overspend or duplicate a frame.
  const row = await env.DB.prepare(RESERVE_SQL).bind(
    id, frame.run_id, frame.frame_id, frame.source_time_s, frame.source_kind,
    frame.image_sha256, requestHash, now,
    frame.run_id, frame.run_id, frame.frame_id, frame.run_id, frame.source_time_s,
    now - 180000,
  ).first();
  if (row) return id;
  const previous = await env.DB.prepare(`SELECT frame_id, source_time_s FROM vision_requests
    WHERE run_id = ? ORDER BY source_time_s DESC LIMIT 1`).bind(frame.run_id).first();
  const duplicate = await env.DB.prepare('SELECT id FROM vision_requests WHERE run_id = ? AND frame_id = ?')
    .bind(frame.run_id, frame.frame_id).first();
  if (duplicate) throw new HttpError(400, 'Frame already submitted; no duplicate paid request was made.');
  if (previous && frame.source_time_s <= previous.source_time_s) {
    throw new HttpError(400, 'Frames must use strictly increasing source timestamps.');
  }
  const budget = await summary(env);
  if (!budget.remaining_requests) throw new HttpError(429, 'The shared $0.50 vision budget is exhausted.');
  const run = await env.DB.prepare('SELECT COUNT(*) AS requests FROM vision_requests WHERE run_id = ?').bind(frame.run_id).first();
  if (run.requests >= MAX_RUN_REQUESTS) throw new HttpError(429, 'Live SAM run reached its 60-image request limit.');
  throw new HttpError(429, 'SAM is processing another frame; wait before sending the next.',
    {code:'sam_busy', provider_call_made:false, retry_after_s:1});
}

export async function settle(env, id, status, responseHash = null, result = null) {
  // Every reservation remains charged, including failed or interrupted calls.
  // A stale in-flight slot expires after 180s, but its dollars never expire.
  await env.DB.prepare(`UPDATE vision_requests SET status = ?, completed_at = ?,
    response_sha256 = ?, result_json = ? WHERE id = ? AND status = 'requesting'`)
    .bind(status, new Date().toISOString(), responseHash, result ? JSON.stringify(result) : null, id).run();
}
