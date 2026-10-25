CREATE TABLE `thread_invites` (
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
CREATE UNIQUE INDEX `thread_invites_token_hash_idx` ON `thread_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `thread_invites_thread_idx` ON `thread_invites` (`thread_id`,`created_at`);