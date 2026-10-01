# V1.9: new employee creation, Zoho import, danger-zone delete, STWI popups

Branch: `feature/v1.9-employee-creation` (based on `main` @ 462ab8b, V1.7 + V1.8).

## 1. Employees
- **Fields = the coloured columns of the Zoho "Employee View" export.**
  - Yellow (from Zoho): Employee ID, First/Last Name, Email, Department, Designation, Employment Type, Date of Joining, Total Experience, Date of Birth, Gender, Marital Status.
  - Green (typed in the app): Personal Mobile, Personal Email, Aadhaar, PAN, Permanent Address. Date of Exit is set with the Deactivate button.
  - Also typed in the app: Gross Salary, Salary Effective From, Security Deposit Already Taken, Professional Tax on/off, Notes.
  - Every field is required except Total Experience (Zoho leaves it empty for new joiners), Notes and Date of Exit.
  - Formats checked: email, 12-digit Aadhaar, PAN `ABCDE1234F`, IFSC `SBIN0001234`, 10+ digit mobile.
  - The rules live in one place per side: `backend/src/employees/employee-fields.ts` and `frontend/src/employees/fields.ts`.
- **Add Employee** (`/employees/new`): one form in sections. Zoho = yellow edge, Personal = green edge, then Salary, Bank and Other. Designation and Employment Type have "+ Add new…".
- **Import from Zoho** (`/employees/import`):
  - Upload the Employee View `.xls`.
  - Each person gets a status:
    - *Fix in Zoho*: a yellow value is empty or wrong. The popup names the Excel cell, e.g. `I3`, and where to fix it in Zoho.
    - *Needs details*: the green, salary or bank fields are still missing.
    - *Ready*.
    - *Already in app*: if Zoho changed, the screen shows "Web → SEO" with **Apply Zoho changes / Skip**.
  - Green values Zoho already has are pre-filled.
  - The import is saved in the database, so you can continue tomorrow.
  - **Upload again** after fixing Zoho keeps everything already typed.
  - The screen notes active app employees who are missing from the file.
  - **Save & Next** moves through the people, then **Create all ready** or **Create selected**.
- **Employee page**:
  - Edit button, salary increase with a reason note (date defaults to the 1st of next month), and salary history with Edit/Delete (the only row cannot be deleted).
  - **Deactivate** asks for the Date of Exit. **Reactivate** clears it.
- **Pay for part of a month**
  - *Joiners*: paid from the Date of Joining. The days before it are deducted like Double Deduction Leave (outside the 1.5 paid leave), and attendance on those days is ignored. Example: joins 21 Aug, so 20 days are deducted.
  - *Leavers* (STWI decision, 28 Sep): the last month is done **by hand**. When the Date of Exit falls in the month, Process/Calculate adds a Manual Review "Last month: … left on …". Calculate is blocked until it is resolved, and HR then edits that person's row in Payroll Review. The exit date does not cut the pay automatically.
  - An inactive employee is still included in payroll for the month of their exit, and not after it.
- **Employee ID format** `yyyy/mmm/code`, e.g. `2026/sep/06`. The month may be in upper or lower case. Older IDs without "/" (01, 12, 81) stay valid. `2026/SEP/06`, `2026/sep/06` and `2026-sep-06` are treated as the same ID: in forms (no duplicates), in the Zoho import and when matching attendance files (sheet or file name).
- **P.Tax per employee**: when switched off, the ₹200 is not deducted.
- **Junior HR** sees Aadhaar, PAN and account numbers masked (`********1234`) and cannot open Zoho imports.
- **Delete** also erases the typed details kept in Zoho imports and the personal details in the audit log.
- **Departments** = Zoho list: Accounts, Backoffice, Digital Marketing, HR, SEO (under HR), Web (under HR). Designations and employment types are added from Zoho data. The old app-only lists are hidden.

## 2. STWI popups everywhere
- Every browser `alert / confirm / prompt` is replaced (`frontend/src/ui/dialog.tsx`):
  - Errors are red popups.
  - Successes are popups with OK.
  - Confirmations are Yes/Cancel.
  - Delete confirmations are red.
- Inputs are now forms:
  - Resolve review: leave 0 / 0.5 / 1 as buttons, penalty, Double Deduction Leave checkbox.
  - Deposit: Full / EMI buttons.
  - Add Manual attendance: employee dropdown instead of a database ID.
  - Edit attendance.
- Upload results appear as a table, not raw JSON. Finalize and Reopen ask first.

## 3. Labels you can change (Settings → Labels & popup texts)
- Every button label and popup text has a default in `frontend/src/ui/labels.ts`.
- The CEO can change any of them in the app. Changes are saved in the database (`AppLabel`) and don't need a deploy. **Reset** goes back to the default.
- The "Rules" menu item is now "Settings" (Rules + Labels).

## 4. Database (migration `20260928120000_v1_9_employee_master`)
- `Employee`: new columns for the fields above, plus `deletedAt` / `deletedById`.
- `Department.parentId`.
- New tables, all created as **InnoDB**: `EmploymentType`, `EmployeeImportBatch`, `EmployeeImportRow`, `AppLabel`.
- Existing employees keep their data. Their name is split into first and last name.

## 6. V1.9 part 2 (28 Sep, afternoon)
- **Date format dd/Mmm/yyyy everywhere** (e.g. `21/Aug/2026`; date + time `28/Sep/2026, 12:49 pm`).
  - Every date the app shows is in this format, including dates inside messages and Manual Review texts.
  - Every date box is the new STWI date box (`frontend/src/ui/DateInput.tsx`). You can type `21/aug/2026`, `21/08/2026` or `21-8-2026`, or pick from a calendar. A wrong date turns the box red.
  - Excel exports use the same format: Payment Sheet Join Date and Renewal Date, employee sheets (with times as `09:30 AM`), and the employee information export.
- **Loaders**:
  - A thin yellow bar at the top while any data loads or saves.
  - Lists show "Loading…".
  - Long jobs show a "Please wait…" window that blocks double clicks: upload, process, calculate, export, finalize/reopen, Zoho import, create, export and delete employee.
  - Sign in shows "Signing in…".
- **Dashboard**: the four cards open Employees, Monthly Run, Manual Review and Payroll. **Payroll Results = number of finalized months.**
- **Login**: eye icon to show or hide the password.
- **Lunch rule (STWI half-day leave)**:
  - Lunch 12:30–13:30 is compulsory. On an "STWI Leave" half day, the lunch hour inside check-in to check-out is taken off, unless the Zoho **check-out note** says no lunch was taken ("no lunch taken", "lunch not taken", "lunch skipped", "without lunch").
  - At least **4:00** is needed. Otherwise the day goes to Manual Review, and the review shows the times and the notes.
  - Examples:
    - 09:28–13:36 with the "No lunch taken" note → OK.
    - The same without the note → 3:08 → review.
    - 09:30–14:30 → 4:00 → OK.
    - 09:33–14:20 → 3:47 → review.
  - Other statuses (Present, "0.5 day Present, 0.5 day Absent", …) are unchanged.
- **Attendance table**:
  - Zoho columns: Date, Employee, Check-in, Check-out, Total Hours as `08:18`, Status, **Check-in Notes, Check-out Notes**, then Late, Leave and Actions.
  - Excel-style grid lines, a row number column (#), row colours like the Excel sheet, and a header that stays visible while scrolling.
- **Database**: migration `20260928160000_v1_9_attendance_notes` adds `checkInNotes` and `checkOutNotes` to `AttendanceRecord`. Render applies it on deploy. **Upload a month's files again to fill the notes for months imported earlier.**
- **Fix**: exporting a month that has an employee ID with "/" (e.g. `2026/sep/06`) failed, because Excel sheet names cannot contain "/". The sheet is now named `2026-sep-06`.
- **Test cases**: `docs/test-data/v1.9/STWI_V1.9_Test_Cases.xlsx` now has 96 cases.

- **Bank details removed** (STWI, 28 Sep): no bank section in Add Employee, the employee page or the Zoho import, and bank details are no longer required. The old database columns stay but are unused. The employee page section is now "Payroll" (P.Tax on/off).
- **If `npm run start:dev` shows `Property 'checkInNotes' does not exist`**, the Prisma client is older than the database change. Stop the backend, then run `npx prisma migrate deploy` and `npx prisma generate`, and start it again.

- **Fix (29 Sep)**: "Export Employee Information" gave *Internal server error* on the hosted app. Cause: payroll rows of deleted months left behind because the hosting tables are MyISAM (no foreign keys). The export now skips such rows. Run `docs/sql/2026-09-29_hosted_repair_innodb.sql` once in phpMyAdmin, after a backup. It removes the orphan rows, converts every table to InnoDB and adds the 24 foreign keys, and it is safe to run again.
- **Fix (29 Sep)**: after Upload, the "Upload result" popup and the "Uploading…" window blocked each other. The result popup now opens after the wait window closes, and popups always sit above the wait window.

- **Fix (29 Sep): MISMATCH for new IDs.** Zoho names the file `Attendance_entries_2026_sep_06_Aryan.xls`, with "_" where the ID has "/". The app read the ID from the name as "2026", which didn't match the sheet's "2026/sep/06". It now reads `2026_sep_06` as `2026/sep/06`. Delete the MISMATCH file row in the run and upload the file again.
- **ZIP upload** (already supported): choose one `.zip` holding every employee's Zoho file in the run's Upload box. Each `.xls`/`.xlsx` inside is handled as its own file, and files already uploaded show DUPLICATE.
- **"0.5 day Present, 0.5 day Absent / Regularized" = whole working day** whatever the hours (under 8:00 or 4:00): present, no leave, no Manual Review. It is now matched loosely (spacing, "Regularised"). Without "Regularized", the half-day review stays.

- **Final "Attendance & Payment" export (29 Sep)**: Export Excel now builds STWI's own workbook layout with live formulas.
  - **Payment Sheet**: same 20 headers (yellow, bold 13pt).
    - G `=SUM(D/C*(K+O))`, J `=SUM(D-E-F-G-H-I)`.
    - K/L/M/N/O/P link to the employee sheet's O12/O4/O5/O10/O11/O9.
    - A1 = DRAFT until the month is finalized.
  - **email summary**: two-column cards linked to the Payment Sheet.
  - **One sheet per employee** (first name):
    - Zoho rows in A–L (Payable Hours, breaks, Time Tracker Hours, Shift, Description), coloured like the Excel. Late check-in cells are orange, with a colour key.
    - The N2:O26 block with the same labels and formulas.
  - **Manual Review** and **Calculation Trace** at the end. Dates are dd/Mmm/yyyy, and every sheet prints landscape, one page wide.
  - File name: `DRAFT - Attendance & Payment_Aug_2026.xlsx`, or `Attendance & Payment_Aug_2026.xlsx` after Finalize.
  - Small differences from STWI's hand-made file, so every payable equals the app:
    - O10 Paid Leave `=MIN(1.5,O9)`, so the deduction can't go negative.
    - O26 also subtracts Penalty (O23), as the Payment Sheet's J does.
    - G includes Double Deduction Leave (as in the Prakash row).
    - Days before joining are added to Double Deduction Leave, with a note.
    - E = security deposit deducted this month; F = other deductions (with a note).
    - A row edited in Payroll Review gets the app's payable as a value, with a note.
  - **Database**: migration `20260929160000_v1_9_attendance_source` adds `sourceJson` (the other Zoho columns of each day). Render applies it. **Upload a month again** so the breaks, shift and description fill in.

## 7. V1.9 part 3 (1 Oct): fix in Zoho, notes rule, sandwich leave

**Manual Review is read-only.**
- No Resolve or Delete buttons; the API refuses them (400).
- A red banner at the top of Manual Review (page and run) says: "N item(s) to fix in Zoho. Calculate stays blocked until all are fixed", then fix in Zoho, export again, upload again.
- New column **How to fix in Zoho** (also in the export's Manual Review sheet):

| Review | Fix in Zoho |
|---|---|
| R1 Checked in, no check-out | Add the check-out in Zoho (Regularization) or apply leave for the day. |
| R2 No check-in on a working day | Apply STWI Leave (full or half) or regularize the day in Zoho. |
| R3 Present under 8:00 | Regularize the day or apply STWI half-day leave in Zoho. |
| R4 0.5 Present / 0.5 Absent under 8:00 | Regularize (it then shows "/ Regularized" = whole day) or apply half-day leave in Zoho. |
| R5 STWI half day under 4:00 after lunch | Correct the check-in / check-out in Zoho (Regularize). |
| R6 Unclear STWI leave | Correct the leave type in Zoho. |
| R7 File doesn't match an employee | Fix the Employee ID in Zoho or the file name, then upload again. |
| Note on the day | Remove the check-in / check-out note in Zoho, then export and upload again. |
| No row for a date | Export the full month from Zoho and upload again. |
| Leaver "Last month" | Information only (does not block): adjust the pay in Payroll Review > Edit. |

- **Calculate** is blocked by every review except the leaver item.
- **Uploading an employee's file again** removes all that employee's reviews (any status). They come back only for problems still in the new file. Old HR decisions are no longer re-applied (Q1d).
- **Mismatch files**: deleting the file removes its "Could not match…" review. A file that failed (MISMATCH/ERROR) can be uploaded again, for example after the employee was created. It no longer shows as DUPLICATE.
- **Penalty and Double Deduction Leave** are entered only in Payroll Review > Edit.

**Notes rule.**
- Any check-in or check-out note, on any day, sends the day to Manual Review. This includes weekends, holidays and "no lunch taken".
- The day is on hold until the note is removed in Zoho and the file is uploaded again.
- If the day already has another review, the note is added to it and the fix text says to remove the note too.
- A cell with only "-" or "." counts as empty.
- Once a "no lunch taken" note is removed, the lunch hour is deducted again. A 13:36 check-out then becomes an R5 review.

**Sandwich leave.**
- Weekend and holiday days next to full-day leave count as 1 day of leave each:
  - Off days between two full-day leaves. Example: Fri leave, Sat, Sun, Mon leave → 4.
  - The off days on both sides of a leave that has off days on both sides. Example: Sat 3, Sun 4, Mon 5 leave, Tue 6 holiday → 4.
- **Counts as leave:** full-day STWI Leave, Absent, or a day edited to 1 day of leave.
- **Breaks the chain:**
  - half days
  - Present or Regularized days
  - an off day with a check-in (worked)
  - days still in Manual Review
  - missing days
  - days before joining
- 2nd and 4th Saturdays are working days. Only days inside the month count.
- The leave total includes sandwich days, so the deduction is total − 1.5 (example: 4 → 2.5).
- Recalculated after every upload, Process, Calculate and attendance add/edit/delete.
- **Attendance table:** red row with "· Sandwich leave".
- **Export:** red row, Status "… - Sandwich leave", N8 **Sandwich Leave** = count. O3 Leave excludes those days and O9 Total Leave includes them.
- **Database:** migration `20261001120000_v1_9_sandwich_leave` adds `AttendanceRecord.isSandwich`. Render applies it.

**After updating:** upload the open months again. Their reviews are rebuilt with the fix texts, and notes and sandwich days are applied.

## 5. Release steps (in this order)
1. **Backup**: phpMyAdmin → `softtec1_attendance_payroll` → Export.
2. **Database**: nothing to run by hand. The Render build command is `npm ci && npx prisma generate && npx prisma migrate deploy && npm run build`, so Render applies the V1.9 migration itself on deploy. `docs/sql/2026-09-28_v1.9_live_db.sql` is only a fallback if that command is ever changed.
3. *(Optional, Q11 "start fresh")*: `docs/sql/2026-09-28_v1.9_optional_fresh_start.sql` deletes all employees, runs and payroll, and keeps logins, rules and lists. This cannot be undone.
4. Merge `feature/v1.9-employee-creation` into `main` and push. Render and Cloudflare deploy.
5. In the app: Employees → Import from Zoho → upload the Employee View → fill details → Create.

Local (after `git pull` of the branch):
```powershell
cd backend
npx prisma migrate deploy
npx prisma generate
npm run build
npm run start:dev
```
Frontend: `cd frontend`, `npm run dev`.
