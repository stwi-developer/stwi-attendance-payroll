import { Module } from '@nestjs/common';

import { ReferenceController } from './reference.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReferenceController],
})
export class ReferenceModule {}