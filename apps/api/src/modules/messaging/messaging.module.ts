import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingController } from './messaging.controller';
@Module({ imports: [AuthModule], controllers: [MessagingController] })
export class MessagingModule {}
