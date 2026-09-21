import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DailyNotesController } from './daily-notes.controller';
import { DeliveryGuard } from './delivery.guard';
@Module({ imports: [AuthModule], controllers: [DailyNotesController], providers: [DeliveryGuard] })
export class DailyNotesModule {}
