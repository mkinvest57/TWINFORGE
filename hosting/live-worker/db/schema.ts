import {sql} from 'drizzle-orm';
import {sqliteTable, text, integer, real, check, unique, index} from 'drizzle-orm/sqlite-core';

export const baseline = sqliteTable('vision_budget_baseline', {
  id: text('id').primaryKey().notNull(),
  initialUnits: integer('initial_units').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [check('vision_baseline_id', sql`${table.id} = 'vision'`), check('vision_baseline_nonnegative', sql`${table.initialUnits} >= 0`)]);

export const requests = sqliteTable('vision_requests', {
  id: text('id').primaryKey().notNull(),
  runId: text('run_id').notNull(),
  frameId: text('frame_id').notNull(),
  sourceTime: real('source_time_s').notNull(),
  sourceKind: text('source_kind').notNull(),
  imageHash: text('image_sha256').notNull(),
  requestHash: text('request_sha256').notNull(),
  units: integer('units').notNull(),
  createdMs: integer('created_ms').notNull(),
  completedAt: text('completed_at'),
  status: text('status').notNull(),
  responseHash: text('response_sha256'),
  result: text('result_json'),
}, table => [
  check('vision_source_kind', sql`${table.sourceKind} IN ('synthetic', 'camera')`),
  check('vision_image_price', sql`${table.units} = 25`),
  check('vision_status', sql`${table.status} IN ('requesting', 'complete', 'failed')`),
  unique('vision_unique_frame').on(table.runId, table.frameId),
  index('vision_requests_run_time').on(table.runId, table.sourceTime),
  index('vision_requests_inflight').on(table.status, table.createdMs),
]);
