CREATE TABLE `employees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fullName` varchar(200) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`payRate` decimal(10,2) NOT NULL,
	`role` varchar(64) NOT NULL,
	`storeLocation` varchar(64) NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employees_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `manager_stores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storeLocation` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `manager_stores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payroll_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`storeLocation` varchar(64) NOT NULL,
	`weekStart` timestamp NOT NULL,
	`hoursWorked` decimal(6,2) NOT NULL DEFAULT '0',
	`scheduledHours` decimal(6,2) NOT NULL DEFAULT '0',
	`payRateSnapshot` decimal(10,2) NOT NULL,
	`regularPay` decimal(10,2) NOT NULL DEFAULT '0',
	`overtimePay` decimal(10,2) NOT NULL DEFAULT '0',
	`grossPay` decimal(10,2) NOT NULL DEFAULT '0',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payroll_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE INDEX `idx_employees_store` ON `employees` (`storeLocation`);--> statement-breakpoint
CREATE INDEX `idx_manager_stores_user` ON `manager_stores` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_payroll_employee_week` ON `payroll_entries` (`employeeId`,`weekStart`);--> statement-breakpoint
CREATE INDEX `idx_payroll_store_week` ON `payroll_entries` (`storeLocation`,`weekStart`);