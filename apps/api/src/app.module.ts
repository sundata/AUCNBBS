import { DailyNotesModule } from './modules/daily-notes/daily-notes.module';
import { WeekendModule } from './modules/weekend/weekend.module';
import { PulseModule } from './modules/pulse/pulse.module';
import { AppealsModule } from './modules/appeals/appeals.module';
import { BillingModule } from './modules/billing/billing.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { EventsModule } from './modules/events/events.module';
import { MediaModule } from './modules/media/media.module';
import { AdminModule } from './modules/admin/admin.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { SocialModule } from './modules/social/social.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'node:path';
import { AdsModule } from './modules/ads/ads.module';
import { PrismaThrottleStorage } from './common/throttle.storage';
import { AuthModule } from './modules/auth/auth.module';
import { CommunityModule } from './modules/community/community.module';
import { ContentModule } from './modules/content/content.module';
import { FeedModule } from './modules/feed/feed.module';
import { HealthController } from './modules/health.controller';
import { ListingsModule } from './modules/listings/listings.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { RegionsModule } from './modules/regions/regions.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
    }),
    // W-9: Postgres-backed buckets so limits hold across multiple API instances.
    ThrottlerModule.forRootAsync({
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage: new PrismaThrottleStorage(prisma),
      }),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RegionsModule,
    CommunityModule,
    ContentModule,
    ListingsModule,
    SearchModule,
    FeedModule,
    ReportsModule,
    MessagingModule,
    AdminModule,
    MediaModule,
    BillingModule,
    SocialModule,
    AppealsModule,
    BusinessesModule,
    EventsModule,
    AdsModule,
    WeekendModule,
    PulseModule,
    DailyNotesModule,
  ],
  controllers: [HealthController],
  // THROTTLER_DISABLED is a test-system escape hatch; never set it in production.
  providers: process.env.THROTTLER_DISABLED
    ? []
    : [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
