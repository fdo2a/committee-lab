CREATE TABLE `review_evidence` (
	`job_id` text NOT NULL,
	`part` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`job_id`, `part`)
);
--> statement-breakpoint
CREATE TABLE `review_job` (
	`id` text PRIMARY KEY NOT NULL,
	`window_id` text NOT NULL,
	`scope` text NOT NULL,
	`digest` text NOT NULL,
	`immutable_digest` text NOT NULL,
	`code_digest` text NOT NULL,
	`revision` integer NOT NULL,
	`market` text NOT NULL,
	`phase` text NOT NULL,
	`round` integer NOT NULL,
	`status` text NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`result` text,
	`claim_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_job_request_unique` ON `review_job` (`window_id`,`scope`,`digest`);--> statement-breakpoint
CREATE TABLE `review_window` (
	`id` text PRIMARY KEY NOT NULL,
	`session_key` text NOT NULL,
	`started_at` integer NOT NULL,
	`deadline` integer NOT NULL,
	`rounds` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_window_session_key_unique` ON `review_window` (`session_key`);