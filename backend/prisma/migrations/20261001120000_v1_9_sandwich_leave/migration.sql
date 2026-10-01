-- V1.9 (STWI 1 Oct): weekend / holiday days counted as leave because they sit
-- between full-day leaves ("sandwich leave").
ALTER TABLE `AttendanceRecord` ADD COLUMN `isSandwich` BOOLEAN NOT NULL DEFAULT false;
