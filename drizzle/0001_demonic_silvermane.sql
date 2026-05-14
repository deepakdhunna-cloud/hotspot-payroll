CREATE TABLE `pin_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` varchar(64) NOT NULL,
	`pinHash` varchar(128) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pin_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `pin_codes_scope_unique` UNIQUE(`scope`)
);
--> statement-breakpoint
CREATE TABLE `time_punches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`storeLocation` varchar(64) NOT NULL,
	`clockInAt` timestamp NOT NULL,
	`clockOutAt` timestamp,
	`source` enum('kiosk','manual') NOT NULL DEFAULT 'kiosk',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `time_punches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `employees` ADD `clockCodeHash` varchar(128);--> statement-breakpoint
CREATE INDEX `idx_time_punches_employee` ON `time_punches` (`employeeId`);--> statement-breakpoint
CREATE INDEX `idx_time_punches_store_in` ON `time_punches` (`storeLocation`,`clockInAt`);