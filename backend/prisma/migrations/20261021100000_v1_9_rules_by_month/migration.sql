-- V1.9 (STWI 21 Oct, KP-12): rules are dated by month (RuleDefinition.effectiveFrom).
-- Double Deduction Leave is typed in Payroll Review, so this setting is no longer used.
DELETE FROM `RuleDefinition` WHERE `key` = 'double_deduction_leave_days';
