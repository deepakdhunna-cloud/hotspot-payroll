CREATE TABLE `attention_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refKey` varchar(120) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`storeLocation` varchar(64),
	`employeeId` int,
	`punchId` int,
	`weekStart` datetime,
	`title` varchar(255) NOT NULL,
	`detail` text,
	`status` enum('open','resolved') NOT NULL DEFAULT 'open',
	`resolution` varchar(16),
	`resolvedBy` varchar(64),
	`resolvedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attention_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `attention_items_refKey_unique` UNIQUE(`refKey`)
);
--> statement-breakpoint
CREATE INDEX `idx_attention_status` ON `attention_items` (`status`,`storeLocation`);