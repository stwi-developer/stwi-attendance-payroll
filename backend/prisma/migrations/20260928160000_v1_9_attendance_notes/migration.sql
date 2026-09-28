-- V1.9: keep Zoho "Check-in Notes" and "Check-out Notes" (shown in the attendance
-- table; "no lunch taken" in the check-out note is used by the half-day lunch rule).
-- Upload a month's files again to fill these for months imported earlier.
ALTER TABLE `AttendanceRecord`
    ADD COLUMN `checkInNotes` TEXT NULL,
    ADD COLUMN `checkOutNotes` TEXT NULL;
