// Integer 0.0001 USD units avoid rounding at the persistent combined ceiling.
// The default remains $0.50. A larger allowance requires explicit server config.
export const LIMIT_UNITS = 5000;
export const MAX_LIMIT_UNITS = 20000;
export const IMAGE_UNITS = 25;
export const MAX_RUN_REQUESTS = 60;
// Keep the paid task within Workers' post-disconnect waitUntil window. A
// disconnected tab must not leave every later scene locked out for 3 minutes.
export const PROVIDER_TIMEOUT_MS = 15000;
export const IN_FLIGHT_LEASE_MS = 30000;
export class HttpError extends Error {
  constructor(status, message, detail = {}) { super(message); this.status = status; this.detail = detail; }
}

export function limitUnits(env) {
  const raw = env.TOTAL_VISION_BUDGET_UNITS ?? LIMIT_UNITS;
  if (raw === 'unlimited') return null;
  const units = typeof raw === 'number' ? raw
    : typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(units) || units < 1 || units > MAX_LIMIT_UNITS) {
    throw new HttpError(503, 'TOTAL_VISION_BUDGET_UNITS must be an integer from 1 to 20000 (0.0001 USD units), or the explicit value "unlimited".');
  }
  return units;
}

export const formatUsd = amount => '$' + amount.toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 4,
});

export function baselineUnits(env) {
  const raw = String(env.INITIAL_VISION_SPENT_UNITS ?? '');
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) {
    throw new HttpError(503, 'The existing vision spend must be configured before hosted SAM can run.');
  }
  return Number(raw);
}

export async function initializeBudget(env) {
  limitUnits(env); // Fail closed before mutating the ledger on invalid config.
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
  const limit = limitUnits(env);
  const unlimited = limit === null;
  const row = await env.DB.prepare(`SELECT
    (SELECT initial_units FROM vision_budget_baseline WHERE id = 'vision') AS initial_units,
    COALESCE(SUM(units), 0) AS hosted_units, COUNT(*) AS requests
    FROM vision_requests`).first();
  if (!row || !Number.isInteger(row.initial_units)) throw new HttpError(503, 'Vision budget has not been initialized.');
  const spent = row.initial_units + row.hosted_units;
  return {
    currency: 'USD', unlimited, limit_per_scene: unlimited ? null : limit / 10000,
    scenes: {vision: spent / 10000}, requests: row.requests,
    reserved_local_or_prior_usd: row.initial_units / 10000,
    budget_scope: unlimited
      ? 'No Twinforge spending cap. Meta account credit still applies. Recorded spend includes the reserved local allowance or prior spend plus hosted image reservations; it is not a Meta account balance.'
      : `The ${formatUsd(limit / 10000)} combined ceiling includes the reserved local allowance or prior spend plus hosted image reservations. The reserved portion is unavailable to this hosted runtime; it is not necessarily money already spent.`,
    hosted_requests: row.requests, persistent: true,
    remaining_requests: unlimited ? null : Math.max(0, Math.floor((limit - spent) / IMAGE_UNITS)),
  };
}

export async function inFlight(env, now = Date.now()) {
  const row = await env.DB.prepare(`SELECT created_ms FROM vision_requests
    WHERE status = 'requesting' AND created_ms > ? ORDER BY created_ms DESC LIMIT 1`)
    .bind(now - IN_FLIGHT_LEASE_MS).first();
  if (!row) return null;
  return {
    started_at: new Date(row.created_ms).toISOString(),
    busy_until_ms: row.created_ms + IN_FLIGHT_LEASE_MS,
    retry_after_s: Math.min(3, Math.max(1, Math.ceil((row.created_ms + IN_FLIGHT_LEASE_MS - now) / 1000))),
  };
}

export const RESERVE_SQL = `INSERT INTO vision_requests
  (id, run_id, frame_id, source_time_s, source_kind, image_sha256,
   request_sha256, units, created_ms, status)
  SELECT ?, ?, ?, ?, ?, ?, ?, 25, ?, 'requesting'
  WHERE
    EXISTS (SELECT 1 FROM vision_budget_baseline WHERE id = 'vision')
    AND (? IS NULL OR (SELECT initial_units FROM vision_budget_baseline WHERE id = 'vision')
      + (SELECT COALESCE(SUM(units), 0) FROM vision_requests) + 25 <= ?)
    AND (? IS NULL OR (SELECT COUNT(*) FROM vision_requests WHERE run_id = ?) < ?)
    AND NOT EXISTS (SELECT 1 FROM vision_requests WHERE run_id = ? AND frame_id = ?)
    AND NOT EXISTS (SELECT 1 FROM vision_requests WHERE run_id = ? AND source_time_s >= ?)
    AND NOT EXISTS (SELECT 1 FROM vision_requests WHERE status = 'requesting' AND created_ms > ?)
  RETURNING id`;

export async function reserve(env, frame, requestHash) {
  const limit = limitUnits(env);
  const maxRunRequests = limit === null ? null : MAX_RUN_REQUESTS;
  const id = crypto.randomUUID().replaceAll('-', ''), now = Date.now();
  // Preserve interrupted reservations and their cost, but close stale leases
  // so status and audit history describe what actually happened.
  await env.DB.prepare(`UPDATE vision_requests SET status = 'failed', completed_at = ?
    WHERE status = 'requesting' AND created_ms <= ?`)
    .bind(new Date(now).toISOString(), now - IN_FLIGHT_LEASE_MS).run();
  // This single SQLite write checks and claims every quota atomically. A
  // restarted Worker or another isolate cannot overspend or duplicate a frame.
  const row = await env.DB.prepare(RESERVE_SQL).bind(
    id, frame.run_id, frame.frame_id, frame.source_time_s, frame.source_kind,
    frame.image_sha256, requestHash, now, limit, limit,
    maxRunRequests, frame.run_id, maxRunRequests,
    frame.run_id, frame.frame_id, frame.run_id, frame.source_time_s,
    now - IN_FLIGHT_LEASE_MS,
  ).first();
  if (row) return id;
  const previous = await env.DB.prepare(`SELECT frame_id, source_time_s FROM vision_requests
    WHERE run_id = ? ORDER BY source_time_s DESC LIMIT 1`).bind(frame.run_id).first();
  const duplicate = await env.DB.prepare('SELECT id FROM vision_requests WHERE run_id = ? AND frame_id = ?')
    .bind(frame.run_id, frame.frame_id).first();
  if (duplicate) throw new HttpError(400, 'Frame already submitted; no duplicate paid request was made.',
    {code:'duplicate_frame', provider_call_made:false});
  if (previous && frame.source_time_s <= previous.source_time_s) {
    throw new HttpError(400, 'Frames must use strictly increasing source timestamps.',
      {code:'out_of_order_frame', provider_call_made:false});
  }
  const budget = await summary(env);
  if (!budget.unlimited && !budget.remaining_requests) throw new HttpError(429, `The shared ${formatUsd(limit / 10000)} vision budget is exhausted.`,
    {code:'budget_exhausted', provider_call_made:false, remaining_requests:0});
  const run = await env.DB.prepare('SELECT COUNT(*) AS requests FROM vision_requests WHERE run_id = ?').bind(frame.run_id).first();
  if (maxRunRequests !== null && run.requests >= maxRunRequests) throw new HttpError(429, 'Live SAM run reached its 60-image request limit.',
    {code:'run_limit', provider_call_made:false, max_requests_per_run:MAX_RUN_REQUESTS});
  const busy = await inFlight(env, now);
  throw new HttpError(429, 'SAM is processing another frame; wait before sending the next.',
    {code:'sam_busy', provider_call_made:false, retry_after_s:busy?.retry_after_s ?? 1,
      ...(busy ? {busy_until_ms:busy.busy_until_ms} : {})});
}

export async function settle(env, id, status, responseHash = null, result = null) {
  // Every reservation remains charged, including failed or interrupted calls.
  // A stale in-flight slot expires after 30s, but its dollars never expire.
  await env.DB.prepare(`UPDATE vision_requests SET status = ?, completed_at = ?,
    response_sha256 = ?, result_json = ? WHERE id = ? AND status = 'requesting'`)
    .bind(status, new Date().toISOString(), responseHash, result ? JSON.stringify(result) : null, id).run();
}
