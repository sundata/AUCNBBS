import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppealsController } from './appeals.controller';

@Module({ imports: [AuthModule], controllers: [AppealsController] })
export class AppealsModule {}
