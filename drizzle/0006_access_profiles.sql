CREATE TABLE `access_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`role` enum('admin','cfo','manager') NOT NULL,
	`stores` text,
	`pinScope` varchar(64) NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deletedAt` timestamp,
	CONSTRAINT `access_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `access_profiles_pinScope_unique` UNIQUE(`pinScope`)
);
