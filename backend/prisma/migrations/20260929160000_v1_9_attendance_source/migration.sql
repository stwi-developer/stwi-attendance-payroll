-- V1.9: the other Zoho columns of each attendance day (paid / unpaid break,
-- payable hours, shift, description, locations) for the final
-- "Attendance & Payment" Excel. Upload a month again to fill it for older months.
ALTER TABLE `AttendanceRecord` ADD COLUMN `sourceJson` JSON NULL;
