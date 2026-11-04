CREATE TABLE `vision_budget_baseline` (
	`id` text PRIMARY KEY NOT NULL,
	`initial_units` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "vision_baseline_id" CHECK("vision_budget_baseline"."id" = 'vision'),
	CONSTRAINT "vision_baseline_nonnegative" CHECK("vision_budget_baseline"."initial_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE `vision_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`frame_id` text NOT NULL,
	`source_time_s` real NOT NULL,
	`source_kind` text NOT NULL,
	`image_sha256` text NOT NULL,
	`request_sha256` text NOT NULL,
	`units` integer NOT NULL,
	`created_ms` integer NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`response_sha256` text,
	`result_json` text,
	CONSTRAINT "vision_source_kind" CHECK("vision_requests"."source_kind" IN ('synthetic', 'camera')),
	CONSTRAINT "vision_image_price" CHECK("vision_requests"."units" = 25),
	CONSTRAINT "vision_status" CHECK("vision_requests"."status" IN ('requesting', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `vision_requests_run_time` ON `vision_requests` (`run_id`,`source_time_s`);--> statement-breakpoint
CREATE INDEX `vision_requests_inflight` ON `vision_requests` (`status`,`created_ms`);--> statement-breakpoint
CREATE UNIQUE INDEX `vision_unique_frame` ON `vision_requests` (`run_id`,`frame_id`);