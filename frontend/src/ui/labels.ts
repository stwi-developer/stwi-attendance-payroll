// V1.9: every popup text and button label in one place.
// The texts below are the defaults. The CEO can change any of them in
// Settings -> Labels (saved in the database, no deploy needed).
// Use {name} placeholders for values filled in at run time.

export type LabelDef = { group: string; text: string };

export const DEFAULT_LABELS: Record<string, LabelDef> = {
  // ---- navigation ----
  'nav.dashboard': { group: 'Navigation', text: 'Dashboard' },
  'nav.employees': { group: 'Navigation', text: 'Employees' },
  'nav.runs': { group: 'Navigation', text: 'Monthly Run' },
  'nav.reviews': { group: 'Navigation', text: 'Manual Review' },
  'nav.payroll': { group: 'Navigation', text: 'Payroll' },
  'nav.settings': { group: 'Navigation', text: 'Settings' },
  'nav.logout': { group: 'Navigation', text: 'Logout' },

  // ---- common buttons ----
  'btn.ok': { group: 'Common buttons', text: 'OK' },
  'btn.cancel': { group: 'Common buttons', text: 'Cancel' },
  'btn.yes': { group: 'Common buttons', text: 'Yes' },
  'btn.no': { group: 'Common buttons', text: 'No' },
  'btn.save': { group: 'Common buttons', text: 'Save' },
  'btn.clear': { group: 'Common buttons', text: 'Clear' },
  'btn.open': { group: 'Common buttons', text: 'Open' },
  'btn.edit': { group: 'Common buttons', text: 'Edit' },
  'btn.delete': { group: 'Common buttons', text: 'Delete' },
  'btn.back': { group: 'Common buttons', text: '← Back' },
  'btn.previous': { group: 'Common buttons', text: 'Previous' },
  'btn.next': { group: 'Common buttons', text: 'Next' },
  'btn.signIn': { group: 'Common buttons', text: 'Sign in' },

  // ---- popup titles ----
  'popup.success.title': { group: 'Popups', text: 'Done' },
  'popup.error.title': { group: 'Popups', text: 'Something went wrong' },
  'popup.confirm.title': { group: 'Popups', text: 'Please confirm' },
  'popup.confirm.message': { group: 'Popups', text: 'Are you sure?' },
  'popup.delete.title': { group: 'Popups', text: 'Delete?' },

  // ---- employees ----
  'emp.btn.add': { group: 'Employees', text: '+ Add Employee' },
  'emp.btn.import': { group: 'Employees', text: 'Import from Zoho' },
  'emp.btn.create': { group: 'Employees', text: 'Create Employee' },
  'emp.btn.saveInfo': { group: 'Employees', text: 'Save Employee' },
  'emp.btn.saveSalary': { group: 'Employees', text: 'Save Salary' },
  'emp.btn.deactivate': { group: 'Employees', text: 'Deactivate' },
  'emp.btn.reactivate': { group: 'Employees', text: 'Reactivate' },
  'emp.btn.deleteEmployee': { group: 'Employees', text: 'Delete Employee' },
  'emp.btn.export': { group: 'Employees', text: 'Export Employee Information' },
  'emp.btn.editSalaryRow': { group: 'Employees', text: 'Edit' },
  'emp.btn.deleteSalaryRow': { group: 'Employees', text: 'Delete' },
  'emp.created': { group: 'Employees', text: 'Employee {name} ({code}) was created.' },
  'emp.saved': { group: 'Employees', text: 'Employee details were saved.' },
  'emp.salarySaved': { group: 'Employees', text: 'Salary was saved.' },
  'emp.salaryRowDeleted': { group: 'Employees', text: 'Salary row was deleted.' },
  'emp.deactivate.title': { group: 'Employees', text: 'Deactivate {name}?' },
  'emp.deactivate.message': { group: 'Employees', text: 'The employee will no longer be included in payroll after the exit date. You can reactivate later.' },
  'emp.deactivated': { group: 'Employees', text: '{name} is now inactive.' },
  'emp.reactivate.title': { group: 'Employees', text: 'Reactivate {name}?' },
  'emp.reactivate.message': { group: 'Employees', text: 'The exit date will be cleared and the employee will be included in payroll again.' },
  'emp.reactivated': { group: 'Employees', text: '{name} is active again.' },
  'emp.danger.title': { group: 'Employees', text: 'Danger zone: delete {name}' },
  'emp.danger.message': { group: 'Employees', text: 'Personal details (address, Aadhaar, PAN, bank, phone, dates) are erased permanently. Past payroll months keep the name, ID and amounts so old reports stay correct. First export the employee information, then type the Employee ID to confirm.' },
  'emp.danger.typeToConfirm': { group: 'Employees', text: 'Type the Employee ID {code} to confirm' },
  'emp.deleted': { group: 'Employees', text: '{name} was deleted.' },
  'emp.salaryRowDelete.title': { group: 'Employees', text: 'Delete this salary row?' },

  // ---- import ----
  'imp.btn.upload': { group: 'Import', text: 'Upload Employee View' },
  'imp.btn.saveNext': { group: 'Import', text: 'Save & Next' },
  'imp.btn.save': { group: 'Import', text: 'Save' },
  'imp.btn.createSelected': { group: 'Import', text: 'Create selected' },
  'imp.btn.createReady': { group: 'Import', text: 'Create all ready' },
  'imp.btn.applyUpdate': { group: 'Import', text: 'Apply Zoho changes' },
  'imp.btn.skip': { group: 'Import', text: 'Skip' },
  'imp.btn.cancelImport': { group: 'Import', text: 'Cancel import' },
  'imp.uploaded': { group: 'Import', text: '{total} employees read from {file}. {ready} ready, {needs} need details, {problems} with problems, {existing} already in the app.' },
  'imp.created': { group: 'Import', text: '{count} employee(s) created.' },
  'imp.cancel.title': { group: 'Import', text: 'Cancel this import?' },
  'imp.cancel.message': { group: 'Import', text: 'Details typed for employees not yet created will be lost. Employees already created stay.' },

  // ---- monthly run ----
  'run.btn.create': { group: 'Monthly run', text: 'Create Run' },
  'run.btn.upload': { group: 'Monthly run', text: 'Upload' },
  'run.btn.process': { group: 'Monthly run', text: 'Process Attendance' },
  'run.btn.calculate': { group: 'Monthly run', text: 'Calculate Payroll' },
  'run.btn.export': { group: 'Monthly run', text: 'Export Excel' },
  'run.btn.finalize': { group: 'Monthly run', text: 'Finalize' },
  'run.btn.reopen': { group: 'Monthly run', text: 'Reopen' },
  'run.btn.backToRuns': { group: 'Monthly run', text: '← Runs' },
  'run.btn.addManual': { group: 'Monthly run', text: 'Add Manual' },
  'run.btn.allEmployees': { group: 'Monthly run', text: 'All Employees' },
  'run.btn.selectAll': { group: 'Monthly run', text: 'Select All' },
  'run.btn.deposit': { group: 'Monthly run', text: 'Deposit' },
  'run.btn.undoDeposit': { group: 'Monthly run', text: 'Undo' },
  'run.btn.saveChanges': { group: 'Monthly run', text: 'Save Changes' },
  'run.btn.clearEdits': { group: 'Monthly run', text: 'Clear Edits' },
  'run.delete.title': { group: 'Monthly run', text: 'Delete this run?' },
  'run.delete.message': { group: 'Monthly run', text: 'All uploaded files, attendance, reviews and payroll of this month will be deleted.' },
  'run.done.process': { group: 'Monthly run', text: 'Attendance processed.' },
  'run.done.calculate': { group: 'Monthly run', text: 'Payroll calculated.' },
  'run.done.finalize': { group: 'Monthly run', text: 'The month is finalized.' },
  'run.done.reopen': { group: 'Monthly run', text: 'The month is reopened.' },
  'run.done.export': { group: 'Monthly run', text: 'The Excel file was downloaded.' },
  'run.done.deposit': { group: 'Monthly run', text: 'Security deposit method saved.' },
  'run.done.reset_deposit': { group: 'Monthly run', text: 'Security deposit choice removed.' },
  'run.done.edit_payroll': { group: 'Monthly run', text: 'Payroll changes saved.' },
  'run.done.reset_payroll_edits': { group: 'Monthly run', text: 'Manual edits removed.' },
  'run.done.resolve_review': { group: 'Monthly run', text: 'Review resolved.' },
  'run.done.manual_attendance': { group: 'Monthly run', text: 'Attendance row added.' },
  'run.done.update_attendance': { group: 'Monthly run', text: 'Attendance row updated.' },
  'run.done.delete_attendance': { group: 'Monthly run', text: 'Attendance row deleted.' },
  'run.done.delete_file': { group: 'Monthly run', text: 'File deleted.' },
  'run.done.delete_review': { group: 'Monthly run', text: 'Review deleted.' },
  'run.deleteFile.title': { group: 'Monthly run', text: 'Delete this file?' },
  'run.deleteFile.message': { group: 'Monthly run', text: 'Its attendance rows are removed from this month.' },
  'run.upload.title': { group: 'Monthly run', text: 'Upload result' },
  'run.finalize.title': { group: 'Monthly run', text: 'Finalize this month?' },
  'run.finalize.message': { group: 'Monthly run', text: 'After finalizing, attendance and payroll are locked until the month is reopened.' },
  'run.reopen.title': { group: 'Monthly run', text: 'Reopen this month?' },
  'run.reopen.message': { group: 'Monthly run', text: 'Attendance and payroll become editable again.' },
  'run.manual.title': { group: 'Monthly run', text: 'Add manual attendance' },
  'run.editAtt.title': { group: 'Monthly run', text: 'Edit attendance' },
  'run.deleteAtt.title': { group: 'Monthly run', text: 'Delete this attendance row?' },
  'run.deposit.title': { group: 'Monthly run', text: 'Security deposit method' },
  'run.deposit.message': { group: 'Monthly run', text: 'How should the security deposit be collected from {name}?' },
  'run.deposit.full': { group: 'Monthly run', text: 'Full (this month)' },
  'run.deposit.emi': { group: 'Monthly run', text: 'EMI (3 installments)' },
  'run.undoDeposit.title': { group: 'Monthly run', text: 'Undo the security deposit for {name}?' },
  'run.clearEdits.title': { group: 'Monthly run', text: 'Remove all manual edits?' },
  'run.clearEdits.message': { group: 'Monthly run', text: 'The calculated values will be used again for this employee.' },

  // ---- reviews ----
  'rev.banner.title': { group: 'Manual review', text: '{n} item(s) to fix in Zoho. Calculate stays blocked until all are fixed.' },
  'rev.banner.text': { group: 'Manual review', text: 'Reviews cannot be resolved in the app. Fix every item in Zoho as shown in "How to fix in Zoho", export the attendance from Zoho again and upload the Excel file(s) again. The new file replaces the old one and its reviews.' },
  'rev.banner.none': { group: 'Manual review', text: 'Nothing to fix in Zoho for this month. You can Calculate.' },
  'rev.col.fix': { group: 'Manual review', text: 'How to fix in Zoho' },
  'rev.info': { group: 'Manual review', text: 'Information (does not block)' },
  'rev.page.sub': { group: 'Manual review', text: 'Read only: fix these in Zoho, then export and upload again.' },
  'rev.leave.0': { group: 'Monthly run', text: '0 (present)' },
  'rev.leave.half': { group: 'Monthly run', text: '0.5 (half day)' },
  'rev.leave.1': { group: 'Monthly run', text: '1 (full day)' },
  'att.sandwich': { group: 'Monthly run', text: 'Sandwich leave' },

  // ---- settings ----
  'set.btn.saveRule': { group: 'Settings', text: 'Save' },
  'set.btn.saveLabel': { group: 'Settings', text: 'Save' },
  'set.btn.resetLabel': { group: 'Settings', text: 'Reset' },
  'set.saved': { group: 'Settings', text: 'Saved.' },
};

let overrides: Record<string, string> = {};
export function setLabelOverrides(map: Record<string, string>) { overrides = { ...map }; }
export function labelOverrides() { return overrides; }

/** Label text for a key, with {placeholders} filled in. */
export function L(key: string, vars?: Record<string, string | number | undefined | null>): string {
  let text = overrides[key] ?? DEFAULT_LABELS[key]?.text ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(v == null ? '' : String(v));
  return text;
}
