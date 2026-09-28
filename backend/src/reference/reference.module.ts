import { Module } from '@nestjs/common';

import { ReferenceController } from './reference.controller';
import { LabelsController } from './labels.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReferenceController, LabelsController],
})
export class ReferenceModule {}