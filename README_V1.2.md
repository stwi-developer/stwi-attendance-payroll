# STWI Attendance & Payroll – V1.2 Stabilized Build

## Stack
- React + TypeScript + Vite
- Node.js + NestJS + TypeScript
- MySQL 8.4
- Prisma 6

## What this build fixes
- Processing is blocked until at least one valid attendance Excel file has been uploaded.
- Payroll calculation is blocked until attendance has been processed and all Manual Review items are resolved.
- Uploads are marked READY, then PROCESSED only after the Process Attendance action.
- Empty/invalid attendance files are recorded as ERROR instead of silently allowing processing.
- Employee information can be edited.
- Employees without historical attendance/payroll/deposit data can be deleted; employees with history must be deactivated.
- Monthly Draft runs can be deleted.
- Uploaded attendance files can be deleted before finalization; related imported attendance/leave records are removed.
- Attendance records can be added manually, edited and deleted.
- Manual reviews can be resolved; unresolved/rejected reviews can be deleted by CEO/HR, while resolved reviews are retained for audit.
- Filters and pagination are preserved.
- Security deposit and other deduction controls remain on payroll review.
- Excel export remains available after payroll calculation/review.
- 15-Aug weekend/holiday overlap is counted once by excluding holiday dates from week-off day totals when both flags are set.

## Backend setup
1. Keep your existing `backend/.env` from the working installation. Do not commit it.
2. From `backend`:

```powershell
npm install
npx prisma generate
npm run start:dev
```

No new migration is required for the V1.2 changes because the Prisma schema is unchanged.

## Frontend setup
From `frontend`:

```powershell
npm install
npm run dev
```

Open http://localhost:5173

## Development login
- CEO: `ceo@company.local`
- HR: `hr@company.local`
- Junior HR: `jrhr@company.local`
- Seed password: `ChangeMe123!`

Change the development passwords before production use.

## End-to-end test
1. Login as HR or CEO.
2. Create a test employee with salary ₹30,000.
3. Update salary to ₹36,000 and verify salary history.
4. Create August 2026 run.
5. Try Process before upload: it must be rejected.
6. Upload a real Zoho `.xls` / `.xlsx` file.
7. Verify the uploaded file is READY.
8. Click Process Attendance.
9. Verify the file becomes PROCESSED and missing attendance creates Manual Review entries.
10. Edit/delete/add attendance rows from the Attendance table.
11. Resolve open Manual Review items and enter penalty / Double Deduction Leave where required.
12. Try Calculate Payroll with open reviews: it must be rejected.
13. Calculate after all reviews are resolved.
14. Review Payroll and test Security Deposit FULL vs EMI.
15. Export Excel. The first sheet is `Payment Sheet`; additional sheets include `email summary`, `Manual Review`, `Calculation Trace` and employee sheets.
16. Finalize the run.
17. Try editing/deleting after finalization: it must be blocked.
18. Reopen the run with CEO/HR and verify audit trail.

## Payroll rules in the application
- Daily salary = Gross monthly salary / 30.
- Paid leave allowance = 1.5 days per month; no carry-forward.
- Every 3 late marks = 1 leave deduction.
- Excess STWI/leave = leave used - 1.5, minimum zero.
- Double Deduction Leave is manually selected during Manual Review.
- Penalty is manually entered by HR/CEO during Manual Review.
- P.Tax = ₹200 when gross monthly salary >= ₹15,000; otherwise ₹0.
- Security deposit target = current monthly salary.
- Additional security deposit = max(0, current salary - deposit already held).
- Security deposit method = FULL or EMI_3_MONTHS.
- Sunday and 1st/3rd Saturday are non-working; 2nd/4th/5th Saturday is working.
- Holiday/weekend overlap is counted once.
- Normal login threshold = 09:30; first-half leave working second half threshold = 14:30; second-half leave working first half threshold = 09:30.
- Holiday rows do not receive late marks.

## Important data rule
The database is the source of truth. Uploaded Excel is treated as source documentation and generated Excel is treated as output/reporting. Legacy workbook anomalies such as unexplained manual additions are not copied silently.
