CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorScope` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	`entityType` varchar(64),
	`entityId` int,
	`detail` text,
	`ip` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uploadedBy` varchar(64) NOT NULL,
	`storeLocation` varchar(64),
	`weekStart` timestamp NOT NULL,
	`fileUrl` text NOT NULL,
	`filename` varchar(200) NOT NULL,
	`status` enum('parsed','committed') NOT NULL DEFAULT 'parsed',
	`employeeCount` int NOT NULL DEFAULT 0,
	`matchedCount` int NOT NULL DEFAULT 0,
	`unmatchedCount` int NOT NULL DEFAULT 0,
	`totalHours` decimal(8,2) NOT NULL DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`committedAt` timestamp,
	CONSTRAINT `schedule_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_shifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`storeLocation` varchar(64) NOT NULL,
	`weekStart` timestamp NOT NULL,
	`shiftDate` timestamp NOT NULL,
	`startLabel` varchar(32),
	`endLabel` varchar(32),
	`hours` decimal(5,2) NOT NULL,
	`source` enum('import','manual') NOT NULL DEFAULT 'import',
	`importId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedule_shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_created` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_entity` ON `audit_log` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `idx_schedule_imports_week` ON `schedule_imports` (`weekStart`);--> statement-breakpoint
CREATE INDEX `idx_schedule_shifts_emp_week` ON `schedule_shifts` (`employeeId`,`weekStart`);--> statement-breakpoint
CREATE INDEX `idx_schedule_shifts_store_week` ON `schedule_shifts` (`storeLocation`,`weekStart`);