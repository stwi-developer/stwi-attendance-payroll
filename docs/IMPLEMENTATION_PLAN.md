# End-to-End Implementation Plan

## Stage 0 — Foundation
- Monorepo structure
- React/Vite frontend
- NestJS/Node backend
- MySQL + Prisma
- Environment configuration
- Migration/seed workflow

## Stage 1 — Authentication and roles
- Login
- Password hashing
- Session/JWT authentication
- CEO / HR / JUNIOR_HR permissions
- Audit user actions

## Stage 2 — Employee master
- Employee CRUD
- Employee code uniqueness
- Departments/designations
- Salary history
- Import/cleanup of the current master data

## Stage 3 — Monthly Run
- Create monthly run
- Confirm year/month
- Load effective salary
- Track source files
- Process status and locking

## Stage 4 — Zoho import
- Parse XLS/XLSX
- Validate file structure
- Match employee using Employee Code
- Detect duplicate/missing employees
- Store source file metadata
- Import daily attendance records

## Stage 5 — Attendance engine
- Calendar rules
- Sundays
- 1st/3rd Saturday non-working
- 2nd/4th/5th Saturday working
- Holiday handling
- STWI leave detection
- Normal/first-half/second-half login rules
- Late marks
- Missing attendance
- Manual Review creation

## Stage 6 — Manual Review
- Review queue
- Missing check-in/out
- Ambiguous STWI leave
- Unexpected durations
- Employee mismatch
- HR penalty input
- Double Deduction Leave tick
- Resolution/audit history

## Stage 7 — Payroll engine
- Daily salary = monthly salary / 30
- Paid leave allowance
- Excess leave
- Late-mark deductions
- Double deduction leave
- Penalty
- Professional Tax
- Security deposit
- Other approved deductions
- Payable calculation
- Full calculation trace

## Stage 8 — Security Deposit
- New employee deposit target = current salary
- Existing employee balance tracking
- Increment top-up = new salary - deposit already held
- Full deduction option
- 3-equal-installment option
- Deposit transaction history
- Completion tracking

## Stage 9 — Payroll review
- Employee-wise payroll
- Payment Sheet
- Drill-down to attendance/review decisions
- Approvals
- Finalization/lock

## Stage 10 — Excel output
- Employee sheets
- Payment Sheet
- Email Summary
- Manual Review/audit information
- Output linked to the payroll run

## Stage 11 — History and reporting
- Previous runs
- Reopen with CEO/HR permissions and audit trail
- Attendance reports
- Payroll reports
- Export/download history

## Stage 12 — Testing and production
- August 2026 regression dataset
- Rule edge cases
- Duplicate employee IDs
- Missing attendance
- Holiday/weekend overlap
- P.Tax threshold
- Late thresholds
- Security deposit increment top-up
- Full vs EMI security deposit
- Production deployment
- Backup/restore test
