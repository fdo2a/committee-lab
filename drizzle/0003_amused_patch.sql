CREATE TABLE `paper_account_part` (
	`id` text NOT NULL,
	`part_set` text NOT NULL,
	`part` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`id`, `part_set`, `part`)
);
