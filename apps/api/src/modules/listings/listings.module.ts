import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListingsController } from './listings.controller';
import { ListingsExpiryWorker } from './listings-expiry.worker';
import { ListingsService } from './listings.service';

@Module({
  imports: [AuthModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingsExpiryWorker],
  exports: [ListingsService],
})
export class ListingsModule {}
