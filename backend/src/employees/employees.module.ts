import { Module } from '@nestjs/common';
import { EmployeeImportController, EmployeesController } from './employees.controller';
import { EmployeeImportService } from './employee-import.service';
import { EmployeesService } from './employees.service';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from '../audit.service';

@Module({
  imports: [AuthModule],
  controllers: [EmployeesController, EmployeeImportController],
  providers: [EmployeesService, EmployeeImportService, AuditService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
