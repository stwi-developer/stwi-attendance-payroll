-- ============================================================================
-- STWI Attendance & Payroll - hosted database repair (29 Sep 2026)
-- Run in phpMyAdmin > select softtec1_attendance_payroll (NOT a WordPress DB)
-- > SQL tab. Take an Export (backup) first. Safe to run more than once.
--
-- Why: tables created as MyISAM ignore foreign keys, so deleting a month left
-- its payroll/attendance rows behind ("orphans"). Those broke
-- "Export Employee Information" (Field payrollRun ... got null).
-- This script: 1) shows the current engines, 2) removes orphan rows,
-- 3) converts every table to InnoDB, 4) adds the missing foreign keys,
-- 5) shows the result (engines all InnoDB, foreign_keys = 24).
-- ============================================================================

-- 1) before
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;

-- 2) orphan rows
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM `LeaveEvent` WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`) OR `employeeId` NOT IN (SELECT `id` FROM `Employee`) OR `attendanceRecordId` NOT IN (SELECT `id` FROM `AttendanceRecord`);
DELETE FROM `AttendanceRecord` WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`) OR `employeeId` NOT IN (SELECT `id` FROM `Employee`);
DELETE FROM `LeaveEvent` WHERE `attendanceRecordId` NOT IN (SELECT `id` FROM `AttendanceRecord`);
DELETE FROM `AttendanceFile` WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`);
UPDATE `AttendanceRecord` SET `attendanceFileId` = NULL WHERE `attendanceFileId` IS NOT NULL AND `attendanceFileId` NOT IN (SELECT `id` FROM `AttendanceFile`);
DELETE FROM `PayrollResult` WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`) OR `employeeId` NOT IN (SELECT `id` FROM `Employee`);
DELETE FROM `ManualReview` WHERE `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`);
UPDATE `ManualReview` SET `employeeId` = NULL WHERE `employeeId` IS NOT NULL AND `employeeId` NOT IN (SELECT `id` FROM `Employee`);
UPDATE `ManualReview` SET `assignedToId` = NULL WHERE `assignedToId` IS NOT NULL AND `assignedToId` NOT IN (SELECT `id` FROM `User`);
DELETE FROM `SecurityDepositTransaction` WHERE `employeeId` NOT IN (SELECT `id` FROM `Employee`) OR `securityDepositId` NOT IN (SELECT `id` FROM `SecurityDeposit`);
DELETE FROM `SecurityDeposit` WHERE `employeeId` NOT IN (SELECT `id` FROM `Employee`);
DELETE FROM `SecurityDepositTransaction` WHERE `securityDepositId` NOT IN (SELECT `id` FROM `SecurityDeposit`);
UPDATE `SecurityDeposit` SET `payrollRunId` = NULL WHERE `payrollRunId` IS NOT NULL AND `payrollRunId` NOT IN (SELECT `id` FROM `PayrollRun`);
DELETE FROM `EmployeeSalary` WHERE `employeeId` NOT IN (SELECT `id` FROM `Employee`);
UPDATE `Employee` SET `departmentId` = NULL WHERE `departmentId` IS NOT NULL AND `departmentId` NOT IN (SELECT `id` FROM `Department`);
UPDATE `Employee` SET `designationId` = NULL WHERE `designationId` IS NOT NULL AND `designationId` NOT IN (SELECT `id` FROM `Designation`);
UPDATE `Department` SET `parentId` = NULL WHERE `parentId` IS NOT NULL AND `parentId` NOT IN (SELECT `id` FROM (SELECT `id` FROM `Department`) d);
UPDATE `AuditLog` SET `userId` = NULL WHERE `userId` IS NOT NULL AND `userId` NOT IN (SELECT `id` FROM `User`);
UPDATE `AuditLog` SET `employeeId` = NULL WHERE `employeeId` IS NOT NULL AND `employeeId` NOT IN (SELECT `id` FROM `Employee`);
DELETE FROM `EmployeeImportRow` WHERE `batchId` NOT IN (SELECT `id` FROM `EmployeeImportBatch`);
SET FOREIGN_KEY_CHECKS = 1;

-- 3) every table -> InnoDB (tables that are already InnoDB are only rebuilt)

ALTER TABLE `User` ENGINE=InnoDB;
ALTER TABLE `Department` ENGINE=InnoDB;
ALTER TABLE `Designation` ENGINE=InnoDB;
ALTER TABLE `EmploymentType` ENGINE=InnoDB;
ALTER TABLE `Employee` ENGINE=InnoDB;
ALTER TABLE `EmployeeSalary` ENGINE=InnoDB;
ALTER TABLE `PayrollRun` ENGINE=InnoDB;
ALTER TABLE `AttendanceFile` ENGINE=InnoDB;
ALTER TABLE `AttendanceRecord` ENGINE=InnoDB;
ALTER TABLE `LeaveEvent` ENGINE=InnoDB;
ALTER TABLE `PayrollResult` ENGINE=InnoDB;
ALTER TABLE `ManualReview` ENGINE=InnoDB;
ALTER TABLE `SecurityDeposit` ENGINE=InnoDB;
ALTER TABLE `SecurityDepositTransaction` ENGINE=InnoDB;
ALTER TABLE `RuleDefinition` ENGINE=InnoDB;
ALTER TABLE `AuditLog` ENGINE=InnoDB;
ALTER TABLE `EmployeeImportBatch` ENGINE=InnoDB;
ALTER TABLE `EmployeeImportRow` ENGINE=InnoDB;
ALTER TABLE `AppLabel` ENGINE=InnoDB;
ALTER TABLE `_prisma_migrations` ENGINE=InnoDB;

-- 4) foreign keys that are missing (skipped when they already exist)
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Employee' AND CONSTRAINT_NAME = 'Employee_departmentId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Employee` ADD CONSTRAINT `Employee_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Employee' AND CONSTRAINT_NAME = 'Employee_designationId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Employee` ADD CONSTRAINT `Employee_designationId_fkey` FOREIGN KEY (`designationId`) REFERENCES `Designation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'EmployeeSalary' AND CONSTRAINT_NAME = 'EmployeeSalary_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `EmployeeSalary` ADD CONSTRAINT `EmployeeSalary_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PayrollRun' AND CONSTRAINT_NAME = 'PayrollRun_createdById_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `PayrollRun` ADD CONSTRAINT `PayrollRun_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AttendanceFile' AND CONSTRAINT_NAME = 'AttendanceFile_payrollRunId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `AttendanceFile` ADD CONSTRAINT `AttendanceFile_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AttendanceRecord' AND CONSTRAINT_NAME = 'AttendanceRecord_payrollRunId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AttendanceRecord' AND CONSTRAINT_NAME = 'AttendanceRecord_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AttendanceRecord' AND CONSTRAINT_NAME = 'AttendanceRecord_attendanceFileId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_attendanceFileId_fkey` FOREIGN KEY (`attendanceFileId`) REFERENCES `AttendanceFile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'LeaveEvent' AND CONSTRAINT_NAME = 'LeaveEvent_payrollRunId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'LeaveEvent' AND CONSTRAINT_NAME = 'LeaveEvent_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'LeaveEvent' AND CONSTRAINT_NAME = 'LeaveEvent_attendanceRecordId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_attendanceRecordId_fkey` FOREIGN KEY (`attendanceRecordId`) REFERENCES `AttendanceRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PayrollResult' AND CONSTRAINT_NAME = 'PayrollResult_payrollRunId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `PayrollResult` ADD CONSTRAINT `PayrollResult_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PayrollResult' AND CONSTRAINT_NAME = 'PayrollResult_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `PayrollResult` ADD CONSTRAINT `PayrollResult_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ManualReview' AND CONSTRAINT_NAME = 'ManualReview_payrollRunId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ManualReview' AND CONSTRAINT_NAME = 'ManualReview_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ManualReview' AND CONSTRAINT_NAME = 'ManualReview_assignedToId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'SecurityDeposit' AND CONSTRAINT_NAME = 'SecurityDeposit_payrollRunId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `SecurityDeposit` ADD CONSTRAINT `SecurityDeposit_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'SecurityDeposit' AND CONSTRAINT_NAME = 'SecurityDeposit_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `SecurityDeposit` ADD CONSTRAINT `SecurityDeposit_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'SecurityDepositTransaction' AND CONSTRAINT_NAME = 'SecurityDepositTransaction_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `SecurityDepositTransaction` ADD CONSTRAINT `SecurityDepositTransaction_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'SecurityDepositTransaction' AND CONSTRAINT_NAME = 'SecurityDepositTransaction_securityDepositId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `SecurityDepositTransaction` ADD CONSTRAINT `SecurityDepositTransaction_securityDepositId_fkey` FOREIGN KEY (`securityDepositId`) REFERENCES `SecurityDeposit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AuditLog' AND CONSTRAINT_NAME = 'AuditLog_userId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AuditLog' AND CONSTRAINT_NAME = 'AuditLog_employeeId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Department' AND CONSTRAINT_NAME = 'Department_parentId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `Department` ADD CONSTRAINT `Department_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'EmployeeImportRow' AND CONSTRAINT_NAME = 'EmployeeImportRow_batchId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `EmployeeImportRow` ADD CONSTRAINT `EmployeeImportRow_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `EmployeeImportBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- 5) after: every table InnoDB and foreign_keys = 24
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ENGINE <> 'InnoDB';
SELECT COUNT(*) AS foreign_keys FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY';
