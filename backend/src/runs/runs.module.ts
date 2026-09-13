import { Module } from '@nestjs/common';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';
import { SecurityDepositService } from '../security-deposit.service';
import { AuditService } from '../audit.service';

@Module({ controllers: [RunsController], providers: [RunsService, SecurityDepositService, AuditService] })
export class RunsModule {}
