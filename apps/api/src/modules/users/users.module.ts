import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicUsersController, UsersController } from './users.controller';
import { UsersDeletionWorker } from './users-deletion.worker';
import { NotificationsWorker } from './notifications.worker';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, PublicUsersController],
  providers: [UsersDeletionWorker, NotificationsWorker],
})
export class UsersModule {}
