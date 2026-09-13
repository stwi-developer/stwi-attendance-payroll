STWI Attendance & Payroll V1.4 - Source Status / Date Fix

Replace only:
1. backend/src/runs/runs.service.ts
2. frontend/src/App.tsx

Why:
- Zoho date-only values such as 06-Aug-2026 were being converted through local timezone,
  shifting the date one day backward in the database.
- The app was replacing the Zoho Status with internal enum labels (PRESENT, WEEK_OFF,
  HALF_DAY, etc.) in the visible Attendance table.
- Payable Hours was being used as the attendance Hours display instead of raw Total Hours.
- STWI leave summary was treating every leaveFraction as STWI leave.
- Late marks were calculated from the shifted/stale records.

Expected Dixit August 2026 after deleting the old file and re-importing:
- STWI Leave: 1.5 days (06-Aug 0.5, 27-Aug 1.0)
- Half-day records: 2 (06-Aug 0.5, 17-Aug 0.5)
- Late marks: 4 (05-Aug, 11-Aug, 13-Aug, 14-Aug)
- 08-Aug, 22-Aug, 26-Aug, 29-Aug, 31-Aug should import on their real dates.
- Attendance Status column displays the exact Zoho Status from the source sheet.
- Attendance Hours column displays raw Total Hours.

After replacement:
1. Stop backend and frontend.
2. Replace the two files.
3. Restart backend and frontend.
4. In August 2026, delete the existing Attendance_entries_12_Dixit.xlsx upload.
5. Refresh the browser.
6. Upload the original Zoho Excel again.
7. Process Attendance.
8. Verify Attendance and Leave & Late Summary before calculating payroll.

Do not resolve the old stale MISSING_CHECKIN reviews manually before re-importing.
Reprocessing removes/rebuilds open MISSING_CHECKIN reviews for each active employee.
