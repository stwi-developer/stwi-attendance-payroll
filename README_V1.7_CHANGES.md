# STWI Attendance & Payroll V1.7

Base: Git HEAD `d653ca6`. No Prisma schema change and no new migration.

## 1. New confirmed attendance rules (STWI, 23-Sep-2026)

| # | Situation (Zoho) | V1.7 behaviour |
|---|---|---|
| Q1 | `0.5 day Present, 0.5 day Absent`, Total Hours **under 8h** | Manual Review (UNEXPECTED_DURATION), **no automatic leave**. The day **still gets a late mark** if check-in is late. At 8h or more it stays an automatic 0.5 day (e.g. overnight checkout). |
| Q2 | Status exactly `Absent` | Always **1 full day** of leave, whatever hours were recorded. |
| Q3 | Status `Absent` | **No late mark**. |
| Q4 | Any other working day under 8h (under 4h for half-day STWI leave) | Manual Review (UNEXPECTED_DURATION). HR checks the status and decides the leave. The automatic "(8 − hours) ÷ 8" shortfall leave is **removed**. |
| Q5a | Check-in but **no check-out** | Manual Review (MISSING_CHECKOUT). If Zoho says Absent it counts as 1 day until HR decides otherwise. |
| Q6 | Double Deduction Leave ticked | Always costs a full day. It is added **after** the 1.5 paid-leave allowance: `max(0, leave + late-leave − 1.5) + double-deduction`. |
| Q8 | Payroll Review | Fully editable. Edits are kept through Calculate and Finalize, and the payable recalculates from them. |

Unchanged: 09:30 / 14:30 late thresholds, 3 late marks = 1 leave, 1.5 paid leave, gross ÷ calendar days, P.Tax ₹200 when gross > ₹12,000, weekends/holidays, full/half STWI leave, `… / Regularized` = present.

### Resolving a review now asks for the day's leave
For MISSING_CHECKIN, MISSING_CHECKOUT, UNEXPECTED_DURATION and AMBIGUOUS_LEAVE reviews, **Resolve** asks: *Leave for this day? 0 / 0.5 / 1*. Leave it blank to keep the current value. The answer is written to that day's attendance row, used by payroll, and remembered: re-uploading the same employee's file re-applies it instead of reopening the review.

## 2. Bug fixes
1. **Excel export always failed** with `Cannot read properties of undefined (reading 'Workbook')`, because of a default import without `esModuleInterop`. Fixed.
2. **ZIP upload always failed** for the same reason. Fixed.
3. **Salary date window**: August used salaries dated up to 1 October. It now uses the last day of the month. New employees' salary defaults to the joining date instead of today.
4. **Payable recalculated differently** by Deposit / Undo / Other Deduction / list / export. There is now one calculation everywhere.
5. **Finalize discarded Payroll Review edits.** Fixed (edits are stored as overrides).
6. **EMI not stable across months**: month 2 needed re-selection and changed the amount (e.g. 2,000 → 1,333.33). EMI now continues automatically with the same installment. Undo still works for the current run.
7. **Re-upload deleted** manual-entry rows, resolved reviews (penalties, double-deduction) and the payroll result. These are now kept.
8. **Attendance Edit wiped** check-in, check-out and hours. Fixed.
9. **Process deleted open reviews** raised by the import (e.g. Absent days), so they silently vanished. Fixed.
10. A corrupt file in a ZIP no longer aborts the whole batch (that file is marked ERROR). A filename vs worksheet ID mismatch now marks the file MISMATCH.
11. The login screen is no longer prefilled with the CEO email and password. The deposit button asks you to type FULL or EMI (Cancel no longer means EMI).
12. Finalize records the deposit amount shown on the payroll row (respects Payroll Review edits), capped at the outstanding amount.

## 3. Files changed
- `backend/src/runs/runs.service.ts`: rules, import, process, reviews, payroll, deposit, export
- `backend/src/runs/runs.controller.ts`: JSZip import, 400 error for empty upload
- `backend/src/employees/employees.service.ts`: salary date defaults to joining date
- `backend/prisma/seed.ts`: adds rule `full_day_min_hours = 8`
- `frontend/src/App.tsx`, `frontend/src/api.ts`: resolve dialog, payroll editor, fixes above
- `docs/sql/2026-09-23_v1.7_live_db_fix.sql`: one-time script for the **hosted** database (MyISAM → InnoDB, orphans, salary dates, rule)
- `docs/sql/2026-09-23_v1.7_local_salary_dates.sql`: one-time script for your **local** database (salary dates only)

## 4. Tested
On MariaDB 10.11 with the six August Zoho files plus a deposit test employee (TEST001) for August and September, 44 automated checks passed. They cover every rule above, both builds, export, finalize/lock/reopen, re-upload, EMI months 1–2 with Undo, and the salary window. The live DB script was tested on a MyISAM replica with orphans: after it ran there were 15 InnoDB tables, 22 FKs and 0 orphans, and cascade deletes work.
