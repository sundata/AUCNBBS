import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SocialController } from './social.controller';

@Module({ imports: [AuthModule], controllers: [SocialController] })
export class SocialModule {}
