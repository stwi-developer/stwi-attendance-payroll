# STWI Attendance & Payroll V1.5 – August rules / employee view

This version incorporates the confirmed August payroll rules and the Dixit/Harsh workbook examples.

## Confirmed payroll rules
- Per-day salary = gross salary / actual calendar days in the payroll month.
- Paid leave allowance = 1.5 days per month.
- Every 3 late marks = 1 additional leave deduction.
- Late-mark leave and actual leave are combined before applying the 1.5 paid-leave allowance.
- Total deductible leave = max(0, actual leave + late-mark leave + double-deduction leave - 1.5).
- Half-day = 0.5 day salary deduction when it falls into deductible leave.
- P.Tax = ₹200 when gross salary is strictly greater than ₹12,000.
- Normal late threshold = after 09:30.
- First-half leave (employee works second half) = expected login 14:30.
- Second-half leave (employee works first half) = expected login 09:30.
- Generic Zoho half-day rows such as “0.5 day Present, 0.5 day Absent” infer the working half from the first check-in (afternoon => 14:30 threshold).
- Uploaded Zoho source Status is preserved and displayed in Attendance; internal status remains separate for payroll processing.
- A fresh employee upload replaces attendance records imported from older source files for that employee/month. Manual-entry records are preserved.

## August validation examples
Dixit gross ₹16,000, 31 calendar days:
- actual leave = 2.0 days
- 4 late marks = 1.0 late-leave day
- combined = 3.0
- paid leave = 1.5
- deductible = 1.5
- daily salary = ₹16,000 / 31 = ₹516.129032
- attendance deduction = ₹774.193548
- P.Tax = ₹200
- payable before security deposit / penalty / other deduction = ₹15,025.806452

Harsh gross ₹18,000, 31 calendar days:
- actual leave = 1.5 days
- late marks = 2, therefore 0 late-leave day
- paid leave = 1.5
- deductible = 0
- P.Tax = ₹200
- payable before security deposit / penalty / other deduction = ₹17,800

## Files to replace
- backend/src/runs/runs.service.ts
- backend/src/runs/runs.controller.ts
- backend/src/prisma/seed.ts
- frontend/src/App.tsx
- frontend/src/api.ts

No Prisma schema migration is required for this change.
