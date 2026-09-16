# V1 End-to-End Test Checklist

## Authentication
- CEO login works.
- HR login works.
- Junior HR login works.
- Protected routes reject missing/invalid tokens.

## Employee master
- Create employee with unique Employee ID.
- Duplicate Employee ID is rejected.
- Salary history is created on employee creation.
- Salary increment creates a new history record.
- Deposit target equals current gross salary.
- Existing deposit is subtracted from required amount.

## Monthly run
- Create August 2026 run.
- Duplicate month is rejected.
- Upload the six supplied Zoho XLS files.
- File hash duplicate is detected.
- Filename Employee Code is matched to Employee master.
- Unmatched file creates employee-mismatch review.

## Attendance engine
- Sunday is non-working.
- 1st and 3rd Saturdays are non-working.
- 2nd, 4th and 5th Saturdays are working.
- Working Saturdays use normal late-mark logic.
- Holiday rows have no late mark.
- Holiday + weekend is counted once.
- 09:30 exactly is not late.
- 09:31+ on a normal working day is late.
- First Half STWI Leave uses 14:30 expected login.
- Second Half STWI Leave uses 09:30 expected login.
- Full-day STWI Leave with approximately zero hours gives 1 day leave.
- Half-day STWI Leave with 4+ hours inside configured range gives 0.5 day leave.
- Ambiguous leave goes to Manual Review.
- Missing check-in on a working day goes to Manual Review.

## Payroll
- Daily salary = gross / actual calendar days in month (August = gross / 31).
- Paid leave allowance = 1.5 days.
- Excess STWI leave = total STWI leave - 1.5 when positive.
- Every 3 late marks = 1 leave deduction.
- Remaining late marks remain visible.
- Double Deduction Leave adds configured deduction day when ticked.
- Penalty is entered from Manual Review.
- Gross > ₹12,000 => P.Tax ₹200.
- Gross <= ₹12,000 => P.Tax ₹0.
- Employees with missing salary are not produced in payroll results.

## Security deposit
- New employee may record a historical deposit already taken at creation.
- Historical held deposit is visible on Employee Detail and counts toward the target.
- If held deposit equals salary, payroll finalization does not require FULL/EMI selection.
- Equal-salary subsequent months still finalize without a deposit prompt.
- Salary increase requires only the difference between current salary and held deposit.
- Undo before finalization clears only the current-run deposit deduction.
- Regularized existing deposit remains held across payroll runs.
- FULL top-up completes the outstanding deposit and increases held balance.
- EMI top-up keeps the selected installment amount across subsequent calculations.
- New ₹30,000 employee => required deposit ₹30,000.
- Full method => ₹30,000 one-time.
- EMI method => ₹10,000 x 3.
- Existing deposit held ₹30,000 + salary increase to ₹36,000 => additional ₹6,000.
- Increment full => ₹6,000.
- Increment EMI => ₹2,000 x 3.

## Finalization/export
- Open manual reviews block finalization.
- Finalize locks the run.
- Reopen is restricted to CEO/HR and is audited.
- Excel export includes Payment Sheet, Email Summary, Manual Review, and employee attendance sheets.
- Finalized run can be downloaded from history.
