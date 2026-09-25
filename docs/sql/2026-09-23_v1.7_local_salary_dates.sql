-- ============================================================================
-- STWI Attendance & Payroll - V1.7 LOCAL database fix (your Windows MySQL 8.4)
--
-- Your local database is already InnoDB with foreign keys, so only the salary
-- dates and the new rule from the live script are needed locally.
-- Do NOT run `npm run prisma:seed` for this update: it resets the seeded users'
-- passwords (and on the live server would create extra ceo/hr accounts).
--
-- WHY: V1.7 fixes the salary-date window. Salary rows created by "Add
-- Employee" were dated on the creation day (e.g. 17-Sep-2026), so after the
-- fix they would no longer apply to August. This moves ONLY those first
-- salary rows back to the joining date (or 01-Jan-2026, whichever is
-- earlier). Salary changes made later keep their dates.
--
-- Run once:  mysql -u attendance_user -p attendance_payroll < docs\sql\2026-09-23_v1.7_local_salary_dates.sql
-- (or paste into MySQL Workbench / phpMyAdmin with the database selected)
-- ============================================================================

UPDATE `EmployeeSalary` s
  JOIN `Employee` e ON e.`id` = s.`employeeId`
   SET s.`effectiveFrom` = LEAST(COALESCE(e.`joiningDate`, '2026-01-01'), '2026-01-01')
 WHERE s.`notes` IS NULL
   AND DATE(s.`effectiveFrom`) = DATE(e.`createdAt`);

-- V1.7 rule shown in Rule Management (the code already defaults to 8 if missing).
INSERT INTO `RuleDefinition` (`id`, `key`, `value`, `effectiveFrom`, `effectiveTo`, `description`, `createdAt`)
SELECT REPLACE(UUID(), '-', ''), 'full_day_min_hours', '8', '2026-01-01 00:00:00.000', NULL,
       'Working-day hours (Zoho Total Hours). A working day under this goes to Manual Review (V1.7).', NOW(3)
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `RuleDefinition` WHERE `key` = 'full_day_min_hours' AND `effectiveTo` IS NULL);

SELECT e.`employeeCode`, e.`name`, s.`effectiveFrom`, s.`grossSalary`
  FROM `EmployeeSalary` s JOIN `Employee` e ON e.`id` = s.`employeeId`
 ORDER BY e.`employeeCode`, s.`effectiveFrom`;
