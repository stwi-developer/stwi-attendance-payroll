-- ============================================================================
-- STWI Attendance & Payroll - V1.9 database change for the HOSTED database
-- (phpMyAdmin > select softtec1_attendance_payroll > SQL tab).
--
-- USE THIS FILE ONLY IF your Render build command does NOT contain
-- "npx prisma migrate deploy". If it does, Render applies the same change by
-- itself when the code is merged to main - do not run this file then.
--
-- 1. Export a backup of softtec1_attendance_payroll first.
-- 2. Run this whole file once, BEFORE merging V1.9 into main.
-- 3. The last query must show no rows (= every table is InnoDB).
-- ============================================================================

-- V1.9: employee master (Zoho Employee View fields), import staging, editable labels.
-- Every new table is created with ENGINE=InnoDB on purpose: the hosting server
-- defaults to MyISAM, which ignores foreign keys.

-- Employee: Zoho fields, manual fields, payroll/bank details, soft delete
ALTER TABLE `Employee`
    ADD COLUMN `firstName` VARCHAR(100) NULL,
    ADD COLUMN `lastName` VARCHAR(100) NULL,
    ADD COLUMN `employmentType` VARCHAR(100) NULL,
    ADD COLUMN `totalExperience` VARCHAR(100) NULL,
    ADD COLUMN `dateOfBirth` DATETIME(3) NULL,
    ADD COLUMN `gender` VARCHAR(30) NULL,
    ADD COLUMN `maritalStatus` VARCHAR(30) NULL,
    ADD COLUMN `personalMobile` VARCHAR(30) NULL,
    ADD COLUMN `personalEmail` VARCHAR(191) NULL,
    ADD COLUMN `dateOfExit` DATETIME(3) NULL,
    ADD COLUMN `permanentAddress` TEXT NULL,
    ADD COLUMN `aadhaar` VARCHAR(20) NULL,
    ADD COLUMN `pan` VARCHAR(20) NULL,
    ADD COLUMN `professionalTaxApplicable` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `bankAccountName` VARCHAR(150) NULL,
    ADD COLUMN `bankName` VARCHAR(150) NULL,
    ADD COLUMN `bankAccountNumber` VARCHAR(40) NULL,
    ADD COLUMN `bankIfsc` VARCHAR(20) NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(36) NULL;

-- Department: parent department (Zoho: SEO and Web are under HR)
ALTER TABLE `Department` ADD COLUMN `parentId` VARCHAR(36) NULL;
ALTER TABLE `Department` ADD CONSTRAINT `Department_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `EmploymentType` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `EmploymentType_name_key`(`name`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmployeeImportBatch` (
    `id` VARCHAR(36) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `missingJson` JSON NULL,
    `createdById` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmployeeImportRow` (
    `id` VARCHAR(36) NOT NULL,
    `batchId` VARCHAR(36) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `employeeCode` VARCHAR(100) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `zohoJson` JSON NOT NULL,
    `manualJson` JSON NULL,
    `problemsJson` JSON NULL,
    `diffJson` JSON NULL,
    `employeeId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `EmployeeImportRow_batchId_idx`(`batchId`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EmployeeImportRow` ADD CONSTRAINT `EmployeeImportRow_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `EmployeeImportBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `AppLabel` (
    `key` VARCHAR(120) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedById` VARCHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Master data: departments = Zoho list (Organization Setup > Departments)
INSERT INTO `Department` (`id`, `name`, `active`, `createdAt`)
SELECT REPLACE(UUID(), '-', ''), d.name, true, NOW(3)
  FROM (SELECT 'Accounts' AS name UNION ALL SELECT 'Backoffice' UNION ALL SELECT 'Digital Marketing'
        UNION ALL SELECT 'HR' UNION ALL SELECT 'SEO' UNION ALL SELECT 'Web') d
 WHERE NOT EXISTS (SELECT 1 FROM `Department` x WHERE x.`name` = d.name);
-- old app-only departments are hidden, unless an employee still uses one
UPDATE `Department` d SET d.`active` = (d.`name` IN ('Accounts','Backoffice','Digital Marketing','HR','SEO','Web')
    OR EXISTS (SELECT 1 FROM `Employee` e WHERE e.`departmentId` = d.`id`));
SET @stwi_hr_department := (SELECT `id` FROM `Department` WHERE `name` = 'HR' LIMIT 1);
UPDATE `Department` SET `parentId` = @stwi_hr_department WHERE `name` IN ('SEO', 'Web');

-- Master data: Zoho's standard Employment Type values
INSERT INTO `EmploymentType` (`id`, `name`, `active`, `createdAt`)
SELECT REPLACE(UUID(), '-', ''), t.name, true, NOW(3)
  FROM (SELECT 'Permanent' AS name UNION ALL SELECT 'On Contract' UNION ALL SELECT 'Temporary' UNION ALL SELECT 'Trainee') t;

-- Designations now come from Zoho: hide the old app-only list if unused
UPDATE `Designation` g SET g.`active` = false
 WHERE g.`name` IN ('Employee','Executive','Manager','HR','Accounts Executive')
   AND NOT EXISTS (SELECT 1 FROM `Employee` e WHERE e.`designationId` = g.`id`);

-- Existing employees: split the name into first / last name
UPDATE `Employee`
   SET `firstName` = SUBSTRING_INDEX(TRIM(`name`), ' ', 1),
       `lastName`  = NULLIF(TRIM(SUBSTRING(TRIM(`name`), CHAR_LENGTH(SUBSTRING_INDEX(TRIM(`name`), ' ', 1)) + 1)), '')
 WHERE `firstName` IS NULL;

-- Record the change so a later "prisma migrate deploy" does not run it again
INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`)
SELECT REPLACE(UUID(), '-', ''), '4c848549454cf9c0764ed384539356dd666ddf3d65998f79798002ce3f77bcc6', NOW(3), '20260928120000_v1_9_employee_master', NULL, NULL, NOW(3), 1
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `_prisma_migrations` WHERE `migration_name` = '20260928120000_v1_9_employee_master');

-- Check: must return no rows
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ENGINE <> 'InnoDB';
