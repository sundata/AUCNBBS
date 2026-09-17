import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WeekendController } from './weekend.controller';
import { WeekendService } from './weekend.service';
@Module({ imports: [AuthModule], controllers: [WeekendController], providers: [WeekendService] })
export class WeekendModule {}
