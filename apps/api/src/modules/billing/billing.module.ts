import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
@Module({ imports: [AuthModule], controllers: [BillingController] })
export class BillingModule {}
