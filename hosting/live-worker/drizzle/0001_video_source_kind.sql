PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_vision_requests` (
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
	CONSTRAINT "vision_source_kind" CHECK("source_kind" IN ('synthetic', 'camera', 'video')),
	CONSTRAINT "vision_image_price" CHECK("units" = 25),
	CONSTRAINT "vision_status" CHECK("status" IN ('requesting', 'complete', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_vision_requests`("id", "run_id", "frame_id", "source_time_s", "source_kind", "image_sha256", "request_sha256", "units", "created_ms", "completed_at", "status", "response_sha256", "result_json") SELECT "id", "run_id", "frame_id", "source_time_s", "source_kind", "image_sha256", "request_sha256", "units", "created_ms", "completed_at", "status", "response_sha256", "result_json" FROM `vision_requests`;--> statement-breakpoint
DROP TABLE `vision_requests`;--> statement-breakpoint
ALTER TABLE `__new_vision_requests` RENAME TO `vision_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `vision_requests_run_time` ON `vision_requests` (`run_id`,`source_time_s`);--> statement-breakpoint
CREATE INDEX `vision_requests_inflight` ON `vision_requests` (`status`,`created_ms`);--> statement-breakpoint
CREATE UNIQUE INDEX `vision_unique_frame` ON `vision_requests` (`run_id`,`frame_id`);