import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReferenceModule } from './reference/reference.module';
import { RunsModule } from './runs/runs.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, EmployeesModule, DashboardModule, ReferenceModule, RunsModule],
  controllers: [HealthController],
})
export class AppModule {}
