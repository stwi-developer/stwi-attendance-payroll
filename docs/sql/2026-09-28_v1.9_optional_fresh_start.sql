-- ============================================================================
-- OPTIONAL - STWI answer Q11: "will start fresh".
-- Deletes ALL employees and everything that belongs to them: salary history,
-- security deposits, monthly runs, uploaded attendance, reviews, payroll and
-- unfinished Zoho imports.
-- KEEPS: users/logins, rules, departments, designations, employment types, labels.
--
-- This cannot be undone. Export a backup first. Run it only on the database
-- you mean to reset (check the database name selected in phpMyAdmin), and
-- only AFTER the V1.9 change is applied.
-- ============================================================================
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM `SecurityDepositTransaction`;
DELETE FROM `SecurityDeposit`;
DELETE FROM `LeaveEvent`;
DELETE FROM `AttendanceRecord`;
DELETE FROM `AttendanceFile`;
DELETE FROM `ManualReview`;
DELETE FROM `PayrollResult`;
DELETE FROM `PayrollRun`;
DELETE FROM `EmployeeSalary`;
DELETE FROM `EmployeeImportRow`;
DELETE FROM `EmployeeImportBatch`;
UPDATE `AuditLog` SET `employeeId` = NULL;
DELETE FROM `Employee`;
SET FOREIGN_KEY_CHECKS = 1;

SELECT 'employees' AS what, COUNT(*) AS n FROM `Employee`
UNION ALL SELECT 'payroll runs', COUNT(*) FROM `PayrollRun`
UNION ALL SELECT 'users (kept)', COUNT(*) FROM `User`;
