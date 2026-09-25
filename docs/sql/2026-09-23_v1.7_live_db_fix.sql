-- ============================================================================
-- STWI Attendance & Payroll - V1.7 one-time LIVE database fix
-- Target: the hosted MariaDB/MySQL database (e.g. softtec1_attendance_payroll)
--
-- WHY
--   1. Every table on the live server was created as MyISAM. MyISAM ignores
--      foreign keys and transactions, so deleting a payroll run left its
--      attendance, leave and payroll rows behind (orphans), and Prisma
--      transactions could not roll back. This converts all tables to InnoDB
--      and adds the foreign keys defined in prisma/migrations/*_init.
--   2. Employee salary rows were dated on the day the employee was created
--      (17-Sep-2026). With the V1.7 salary-date fix, a salary dated 17-Sep no
--      longer applies to August, so those first salary rows are moved back to
--      the joining date (or 01-Jan-2026, whichever is earlier).
--   3. Adds the full_day_min_hours rule (8) used by the V1.7 short-hours review.
--
-- BEFORE RUNNING
--   * TAKE A BACKUP: phpMyAdmin -> select the database -> Export -> Quick -> SQL.
--   * Stop the backend (so nothing writes while this runs).
--   * Run this whole file in phpMyAdmin -> SQL tab, with the database selected.
--   * Safe to run once. Re-running is harmless except the FK section, which
--     will report "Duplicate key/constraint" if the keys already exist.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove / detach orphan rows (children whose parent no longer exists).
--    Order matters: deepest children first.
-- ---------------------------------------------------------------------------
DELETE FROM `LeaveEvent`
 WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`)
    OR `employeeId` NOT IN (SELECT `id` FROM `Employee`)
    OR `attendanceRecordId` NOT IN (SELECT `id` FROM `AttendanceRecord`);

DELETE FROM `AttendanceRecord`
 WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`)
    OR `employeeId` NOT IN (SELECT `id` FROM `Employee`);

-- LeaveEvents of attendance rows deleted just above
DELETE FROM `LeaveEvent` WHERE `attendanceRecordId` NOT IN (SELECT `id` FROM `AttendanceRecord`);

DELETE FROM `AttendanceFile` WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`);
UPDATE `AttendanceRecord` SET `attendanceFileId` = NULL
 WHERE `attendanceFileId` IS NOT NULL AND `attendanceFileId` NOT IN (SELECT `id` FROM `AttendanceFile`);

DELETE FROM `PayrollResult`
 WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`)
    OR `employeeId` NOT IN (SELECT `id` FROM `Employee`);

DELETE FROM `ManualReview` WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`);
UPDATE `ManualReview` SET `employeeId` = NULL
 WHERE `employeeId` IS NOT NULL AND `employeeId` NOT IN (SELECT `id` FROM `Employee`);
UPDATE `ManualReview` SET `assignedToId` = NULL
 WHERE `assignedToId` IS NOT NULL AND `assignedToId` NOT IN (SELECT `id` FROM `User`);

DELETE FROM `SecurityDepositTransaction`
 WHERE `employeeId` NOT IN (SELECT `id` FROM `Employee`)
    OR `securityDepositId` NOT IN (SELECT `id` FROM `SecurityDeposit`);
DELETE FROM `SecurityDeposit` WHERE `employeeId` NOT IN (SELECT `id` FROM `Employee`);
DELETE FROM `SecurityDepositTransaction` WHERE `securityDepositId` NOT IN (SELECT `id` FROM `SecurityDeposit`);
UPDATE `SecurityDeposit` SET `payrollRunId` = NULL
 WHERE `payrollRunId` IS NOT NULL AND `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`);

DELETE FROM `EmployeeSalary` WHERE `employeeId` NOT IN (SELECT `id` FROM `Employee`);
UPDATE `Employee` SET `departmentId` = NULL
 WHERE `departmentId` IS NOT NULL AND `departmentId` NOT IN (SELECT `id` FROM `Department`);
UPDATE `Employee` SET `designationId` = NULL
 WHERE `designationId` IS NOT NULL AND `designationId` NOT IN (SELECT `id` FROM `Designation`);

UPDATE `AuditLog` SET `userId` = NULL
 WHERE `userId` IS NOT NULL AND `userId` NOT IN (SELECT `id` FROM `User`);
UPDATE `AuditLog` SET `employeeId` = NULL
 WHERE `employeeId` IS NOT NULL AND `employeeId` NOT IN (SELECT `id` FROM `Employee`);

-- ---------------------------------------------------------------------------
-- 2. Convert every table to InnoDB (transactions + foreign keys).
-- ---------------------------------------------------------------------------
ALTER TABLE `User` ENGINE=InnoDB;
ALTER TABLE `Department` ENGINE=InnoDB;
ALTER TABLE `Designation` ENGINE=InnoDB;
ALTER TABLE `Employee` ENGINE=InnoDB;
ALTER TABLE `EmployeeSalary` ENGINE=InnoDB;
ALTER TABLE `PayrollRun` ENGINE=InnoDB;
ALTER TABLE `AttendanceFile` ENGINE=InnoDB;
ALTER TABLE `AttendanceRecord` ENGINE=InnoDB;
ALTER TABLE `LeaveEvent` ENGINE=InnoDB;
ALTER TABLE `RuleDefinition` ENGINE=InnoDB;
ALTER TABLE `PayrollResult` ENGINE=InnoDB;
ALTER TABLE `ManualReview` ENGINE=InnoDB;
ALTER TABLE `SecurityDeposit` ENGINE=InnoDB;
ALTER TABLE `SecurityDepositTransaction` ENGINE=InnoDB;
ALTER TABLE `AuditLog` ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 3. Foreign keys - identical to prisma/migrations/20260916114318_init.
-- ---------------------------------------------------------------------------
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_designationId_fkey` FOREIGN KEY (`designationId`) REFERENCES `Designation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `EmployeeSalary` ADD CONSTRAINT `EmployeeSalary_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PayrollRun` ADD CONSTRAINT `PayrollRun_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceFile` ADD CONSTRAINT `AttendanceFile_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_attendanceFileId_fkey` FOREIGN KEY (`attendanceFileId`) REFERENCES `AttendanceFile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_attendanceRecordId_fkey` FOREIGN KEY (`attendanceRecordId`) REFERENCES `AttendanceRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PayrollResult` ADD CONSTRAINT `PayrollResult_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PayrollResult` ADD CONSTRAINT `PayrollResult_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SecurityDeposit` ADD CONSTRAINT `SecurityDeposit_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SecurityDeposit` ADD CONSTRAINT `SecurityDeposit_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SecurityDepositTransaction` ADD CONSTRAINT `SecurityDepositTransaction_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SecurityDepositTransaction` ADD CONSTRAINT `SecurityDepositTransaction_securityDepositId_fkey` FOREIGN KEY (`securityDepositId`) REFERENCES `SecurityDeposit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Salary rows that were dated on the employee-creation day.
--    Only rows created by "Add Employee" (no notes) whose date equals the
--    employee's creation date are moved; salary CHANGES keep their dates.
-- ---------------------------------------------------------------------------
UPDATE `EmployeeSalary` s
  JOIN `Employee` e ON e.`id` = s.`employeeId`
   SET s.`effectiveFrom` = LEAST(COALESCE(e.`joiningDate`, '2026-01-01'), '2026-01-01')
 WHERE s.`notes` IS NULL
   AND DATE(s.`effectiveFrom`) = DATE(e.`createdAt`);

-- ---------------------------------------------------------------------------
-- 5. V1.7 rule: full-day minimum hours (only added if missing).
-- ---------------------------------------------------------------------------
INSERT INTO `RuleDefinition` (`id`, `key`, `value`, `effectiveFrom`, `effectiveTo`, `description`, `createdAt`)
SELECT REPLACE(UUID(), '-', ''), 'full_day_min_hours', '8', '2026-01-01 00:00:00.000', NULL,
       'Working-day hours (Zoho Total Hours). A working day under this goes to Manual Review (V1.7).', NOW(3)
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `RuleDefinition` WHERE `key` = 'full_day_min_hours' AND `effectiveTo` IS NULL);

-- ---------------------------------------------------------------------------
-- 6. Checks - every table should say InnoDB, and 22 foreign keys should exist.
-- ---------------------------------------------------------------------------
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;
SELECT COUNT(*) AS foreign_keys FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE();
SELECT e.`employeeCode`, e.`name`, s.`effectiveFrom`, s.`grossSalary` FROM `EmployeeSalary` s JOIN `Employee` e ON e.`id` = s.`employeeId` ORDER BY e.`employeeCode`, s.`effectiveFrom`;
