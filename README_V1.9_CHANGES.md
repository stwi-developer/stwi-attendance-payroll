# V1.9: new employee creation, Zoho import, danger-zone delete, STWI popups

Branch: `feature/v1.9-employee-creation` (based on `main` @ 462ab8b, V1.7 + V1.8).

## 1. Employees
- **Fields = the coloured columns of the Zoho "Employee View" export.**
  - Yellow (from Zoho): Employee ID, First/Last Name, Email, Department, Designation, Employment Type, Date of Joining, Total Experience, Date of Birth, Gender, Marital Status.
  - Green (typed in the app): Personal Mobile, Personal Email, Aadhaar, PAN, Permanent Address. Date of Exit is set with the Deactivate button.
  - Also typed in the app: Gross Salary, Salary Effective From, Security Deposit Already Taken, Professional Tax on/off, bank details (holder, bank, account no., IFSC), Notes.
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
