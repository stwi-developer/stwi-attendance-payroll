-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` ENUM('CEO', 'HR', 'JUNIOR_HR') NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Department_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Designation` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Designation_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employee` (
    `id` VARCHAR(36) NOT NULL,
    `employeeCode` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `joiningDate` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `departmentId` VARCHAR(36) NULL,
    `designationId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Employee_employeeCode_key`(`employeeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeSalary` (
    `id` VARCHAR(36) NOT NULL,
    `employeeId` VARCHAR(36) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `grossSalary` DECIMAL(12, 2) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmployeeSalary_employeeId_effectiveFrom_idx`(`employeeId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollRun` (
    `id` VARCHAR(36) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PROCESSING', 'REVIEW', 'FINALIZED', 'REOPENED') NOT NULL DEFAULT 'DRAFT',
    `createdById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `finalizedAt` DATETIME(3) NULL,
    `reopenedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PayrollRun_year_month_key`(`year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceFile` (
    `id` VARCHAR(36) NOT NULL,
    `payrollRunId` VARCHAR(36) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `employeeCode` VARCHAR(100) NULL,
    `fileHash` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `errorMessage` TEXT NULL,

    INDEX `AttendanceFile_payrollRunId_employeeCode_idx`(`payrollRunId`, `employeeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceRecord` (
    `id` VARCHAR(36) NOT NULL,
    `payrollRunId` VARCHAR(36) NOT NULL,
    `employeeId` VARCHAR(36) NOT NULL,
    `attendanceFileId` VARCHAR(36) NULL,
    `workDate` DATE NOT NULL,
    `firstCheckIn` DATETIME(3) NULL,
    `lastCheckOut` DATETIME(3) NULL,
    `workedHours` DECIMAL(6, 2) NULL,
    `sourceStatus` VARCHAR(255) NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'STWI_LEAVE', 'HALF_DAY', 'HOLIDAY', 'WEEK_OFF', 'MANUAL_REVIEW') NOT NULL,
    `isLate` BOOLEAN NOT NULL DEFAULT false,
    `lateMinutes` INTEGER NOT NULL DEFAULT 0,
    `leaveFraction` DECIMAL(4, 2) NULL,
    `isHoliday` BOOLEAN NOT NULL DEFAULT false,
    `isWeekOff` BOOLEAN NOT NULL DEFAULT false,
    `manualNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AttendanceRecord_employeeId_workDate_idx`(`employeeId`, `workDate`),
    INDEX `AttendanceRecord_payrollRunId_status_idx`(`payrollRunId`, `status`),
    UNIQUE INDEX `AttendanceRecord_payrollRunId_employeeId_workDate_key`(`payrollRunId`, `employeeId`, `workDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveEvent` (
    `id` VARCHAR(36) NOT NULL,
    `payrollRunId` VARCHAR(36) NOT NULL,
    `employeeId` VARCHAR(36) NOT NULL,
    `attendanceRecordId` VARCHAR(36) NOT NULL,
    `leaveFraction` DECIMAL(4, 2) NOT NULL,
    `leaveType` VARCHAR(191) NOT NULL,
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LeaveEvent_attendanceRecordId_key`(`attendanceRecordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RuleDefinition` (
    `id` VARCHAR(36) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RuleDefinition_key_effectiveFrom_idx`(`key`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollResult` (
    `id` VARCHAR(36) NOT NULL,
    `payrollRunId` VARCHAR(36) NOT NULL,
    `employeeId` VARCHAR(36) NOT NULL,
    `grossSalary` DECIMAL(12, 2) NOT NULL,
    `calendarDays` INTEGER NOT NULL,
    `weekOffDays` DECIMAL(6, 2) NOT NULL,
    `holidayDays` DECIMAL(6, 2) NOT NULL,
    `paidLeaveAllowance` DECIMAL(6, 2) NOT NULL,
    `stwiLeaveDays` DECIMAL(6, 2) NOT NULL,
    `lateMarks` INTEGER NOT NULL,
    `lateLeaveDeduction` DECIMAL(6, 2) NOT NULL,
    `excessLeaveDeduction` DECIMAL(6, 2) NOT NULL,
    `doubleDeductionLeave` DECIMAL(6, 2) NOT NULL,
    `penalty` DECIMAL(12, 2) NOT NULL,
    `securityDeposit` DECIMAL(12, 2) NOT NULL,
    `ptax` DECIMAL(12, 2) NOT NULL,
    `otherDeductions` DECIMAL(12, 2) NOT NULL,
    `payableAmount` DECIMAL(12, 2) NOT NULL,
    `ruleSnapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PayrollResult_payrollRunId_employeeId_key`(`payrollRunId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManualReview` (
    `id` VARCHAR(36) NOT NULL,
    `payrollRunId` VARCHAR(36) NOT NULL,
    `employeeId` VARCHAR(36) NULL,
    `type` ENUM('MISSING_CHECKIN', 'MISSING_CHECKOUT', 'AMBIGUOUS_LEAVE', 'EMPLOYEE_MISMATCH', 'UNEXPECTED_DURATION', 'OTHER') NOT NULL,
    `status` ENUM('OPEN', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `description` TEXT NOT NULL,
    `resolution` TEXT NULL,
    `penaltyAmount` DECIMAL(12, 2) NULL,
    `doubleDeductionLeave` BOOLEAN NOT NULL DEFAULT false,
    `assignedToId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `ManualReview_payrollRunId_status_idx`(`payrollRunId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityDeposit` (
    `id` VARCHAR(36) NOT NULL,
    `payrollRunId` VARCHAR(36) NULL,
    `employeeId` VARCHAR(36) NOT NULL,
    `triggerReason` VARCHAR(191) NOT NULL,
    `previousSalary` DECIMAL(12, 2) NOT NULL,
    `currentSalary` DECIMAL(12, 2) NOT NULL,
    `requiredDeposit` DECIMAL(12, 2) NOT NULL,
    `alreadyHeld` DECIMAL(12, 2) NOT NULL,
    `additionalRequired` DECIMAL(12, 2) NOT NULL,
    `method` ENUM('FULL', 'EMI_3_MONTHS') NOT NULL,
    `installmentCount` INTEGER NOT NULL DEFAULT 1,
    `installmentAmount` DECIMAL(12, 2) NOT NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `SecurityDeposit_employeeId_status_idx`(`employeeId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityDepositTransaction` (
    `id` VARCHAR(36) NOT NULL,
    `employeeId` VARCHAR(36) NOT NULL,
    `securityDepositId` VARCHAR(36) NOT NULL,
    `payrollRunId` VARCHAR(36) NOT NULL,
    `installmentNumber` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `transactionDate` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SecurityDepositTransaction_employeeId_transactionDate_idx`(`employeeId`, `transactionDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NULL,
    `employeeId` VARCHAR(36) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(100) NOT NULL,
    `entityId` VARCHAR(36) NOT NULL,
    `beforeJson` JSON NULL,
    `afterJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_designationId_fkey` FOREIGN KEY (`designationId`) REFERENCES `Designation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeSalary` ADD CONSTRAINT `EmployeeSalary_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayrollRun` ADD CONSTRAINT `PayrollRun_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceFile` ADD CONSTRAINT `AttendanceFile_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_attendanceFileId_fkey` FOREIGN KEY (`attendanceFileId`) REFERENCES `AttendanceFile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveEvent` ADD CONSTRAINT `LeaveEvent_attendanceRecordId_fkey` FOREIGN KEY (`attendanceRecordId`) REFERENCES `AttendanceRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayrollResult` ADD CONSTRAINT `PayrollResult_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayrollResult` ADD CONSTRAINT `PayrollResult_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManualReview` ADD CONSTRAINT `ManualReview_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityDeposit` ADD CONSTRAINT `SecurityDeposit_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityDeposit` ADD CONSTRAINT `SecurityDeposit_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityDepositTransaction` ADD CONSTRAINT `SecurityDepositTransaction_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityDepositTransaction` ADD CONSTRAINT `SecurityDepositTransaction_securityDepositId_fkey` FOREIGN KEY (`securityDepositId`) REFERENCES `SecurityDeposit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
