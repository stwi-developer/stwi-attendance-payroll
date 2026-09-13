# STWI Attendance & Payroll — V1.1

Internal attendance and payroll web application for CEO, HR and Junior HR.

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + TypeScript + NestJS
- Database: MySQL 8.4
- ORM: Prisma 6
- Excel import/export: SheetJS (`xlsx`) + ExcelJS

## Project structure

```text
internal-payroll-app/
├── backend/
├── frontend/
├── docs/
└── .gitignore
```

## Local setup

### 1. MySQL

Create the local database and application user if not already created:

```sql
CREATE DATABASE attendance_payroll
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'attendance_user'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
GRANT ALL PRIVILEGES ON attendance_payroll.* TO 'attendance_user'@'localhost';
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES ON *.* TO 'attendance_user'@'localhost';
FLUSH PRIVILEGES;
```

The extra CREATE/DROP privilege is needed only for local `prisma migrate dev` shadow-database work.

### 2. Backend

```powershell
cd backend
npm install
```

Create `backend/.env` from `.env.example`:

```env
DATABASE_URL="mysql://attendance_user:YOUR_PASSWORD@localhost:3306/attendance_payroll"
JWT_SECRET="CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"
PORT=4000
CORS_ORIGIN="http://localhost:5173"
```

Generate Prisma Client:

```powershell
npx prisma generate
```

The Prisma client schema includes both the local/native engine and the common Linux `debian-openssl-3.0.x` target so the same codebase can be built for Windows development and a Linux server.

Run migrations only when the Prisma schema actually changes:

```powershell
npx prisma migrate dev
```

Seed the three development users:

```powershell
npm run prisma:seed
```

Default development users are CEO, HR and Junior HR with the seeded development password shown by the seed script.

Start the backend:

```powershell
npm run start:dev
```

Backend health endpoint:

```text
http://localhost:4000/api/health
```

### 3. Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## V1.1 filter/pagination behavior

The latest version uses server-side filtering and pagination rather than loading all attendance/payroll rows into the browser.

### Employees

- Search by employee ID, name or email
- Status
- Department
- Designation
- Minimum/maximum salary
- Page size and previous/next pagination

### Monthly Runs / Payroll history

- Year
- Month
- Status
- Search year
- Page size and pagination

### Manual Review

- Status
- Review type
- Employee search
- Penalty present
- Double Deduction Leave
- Pagination

### Attendance

- Employee search
- Status
- Late / not late
- Leave / no leave
- Holiday / non-holiday
- Week-off / working
- Manual Review
- Date from / date to
- Pagination

### Payroll

- Employee search
- Late marks
- Leave present
- Penalty
- P.Tax
- Security deposit
- Gross salary range
- Payable range
- Pagination

### Rule Management

- Search by rule key/value
- Versioned rule updates with effective dates

## Payroll rules implemented in V1.1

- Daily salary = gross monthly salary / 30
- Paid leave allowance = 1.5 days per month; no carry-forward
- Every 3 late marks = 1 leave deduction
- Excess leave = leave used - 1.5, minimum zero
- Double Deduction Leave is manually selected in Manual Review
- HR penalty is entered manually through Manual Review
- P.Tax: gross >= INR 15,000 => INR 200; below => INR 0
- Security deposit target = current monthly salary
- Salary increment deposit top-up = current salary - deposit already held
- Deposit method: FULL or 3 equal installments
- Finalization is blocked while Manual Reviews remain open
- Finalization is blocked when an additional Security Deposit is due but no method was selected

## Attendance rules implemented

- Normal login after 09:30 is late; exactly 09:30 is not late
- First-half leave login expected at 14:30; after 14:30 is late
- Second-half leave login expected at 09:30; after 09:30 is late
- Full-day STWI Leave with zero/blank work is full leave
- Half-day STWI Leave is 0.5 day
- Generic Zoho half-day strings such as `0.5 day Present, 0.5 day Absent` are treated as half-day leave
- Sundays are non-working
- 1st and 3rd Saturdays are non-working
- 2nd, 4th and 5th Saturdays are working
- Holiday/weekend overlap is counted only once
- Missing working-day attendance creates Manual Review
- Holiday late marks are not counted

## Zoho import

The upload flow:

```text
Upload .xls/.xlsx
↓
Hash / duplicate check
↓
Read Employee ID from worksheet when available
↓
Fallback to filename pattern only when necessary
↓
Compare filename Employee ID vs worksheet Employee ID
↓
Match employee master
↓
Import daily attendance
↓
Create Manual Review records for mismatches/ambiguous records
```

## Excel export

The first worksheet is `Payment Sheet` and follows the existing August workbook's column layout. The exported workbook also contains:

- `email summary`
- `Manual Review`
- `Calculation Trace`
- One attendance sheet per employee code

## End-to-end regression test

Use the actual August 2026 Dixit file first because it is a useful rule regression case.

1. Log in as CEO or HR.
2. Create/verify the employee.
3. Confirm salary history.
4. Create an August 2026 Monthly Run.
5. Upload `Attendance_entries_12_Dixit.xls`.
6. Confirm the worksheet Employee ID is used for matching.
7. Process Attendance.
8. Check Manual Review queue.
9. Review the Aug 17 half-day and Aug 27 STWI leave pattern.
10. Recalculate payroll.
11. Check the Attendance and Payroll filters.
12. Verify P.Tax and late-mark results.
13. Select Security Deposit method when an additional deposit is due.
14. Export Excel and verify the first worksheet is `Payment Sheet`.
15. Resolve all open Manual Reviews.
16. Finalize.
17. Reopen and confirm the audit trail.

The legacy August workbook is a reference dataset, not the calculation authority. Legacy embedded/manual adjustments must not be copied into the new calculation engine without an explicit business rule.
