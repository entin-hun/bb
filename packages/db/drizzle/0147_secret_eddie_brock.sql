CREATE INDEX IF NOT EXISTS `terminal_sessions_status_thread_idx` ON `terminal_sessions` (`status`,`thread_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `diff_viewed_files` (
	`environment_id` text NOT NULL,
	`target_key` text NOT NULL,
	`path` text NOT NULL,
	`revision` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`environment_id`, `target_key`, `path`),
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `authentik_identities` (
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`issuer`, `subject`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `authentik_identities_user_idx` ON `authentik_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `thread_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by_user_id` text,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `thread_invites_token_hash_idx` ON `thread_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_invites_thread_idx` ON `thread_invites` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `thread_participants` (
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `user_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_participants_user_idx` ON `thread_participants` (`user_id`,`thread_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_sessions_user_idx` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_sessions_expiry_idx` ON `user_sessions` (`expires_at`);
