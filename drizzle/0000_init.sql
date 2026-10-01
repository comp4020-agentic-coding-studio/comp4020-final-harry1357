CREATE TABLE `battle_log` (
	`battle_id` text NOT NULL,
	`seq` integer NOT NULL,
	`tick` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`battle_id`, `seq`),
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `battle_members` (
	`battle_id` text NOT NULL,
	`character_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`battle_id`, `character_id`),
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `battle_members_character` ON `battle_members` (`character_id`);--> statement-breakpoint
CREATE TABLE `battles` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`is_public` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `battles_status` ON `battles` (`status`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`damage` integer DEFAULT 0 NOT NULL,
	`healing` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_session_id_unique` ON `characters` (`session_id`);