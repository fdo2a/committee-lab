CREATE TABLE `run_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`status` text NOT NULL,
	`report` text DEFAULT '{}' NOT NULL
);
