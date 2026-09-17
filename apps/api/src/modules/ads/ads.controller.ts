import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const serveQuery = z.object({
  placement: z.enum(['home', 'search', 'channel']).default('home'),
  cityId: z.string().uuid().optional(),
});

/** Flat CPC charged per click, in cents; configurable via app_config.ads.cpc_minor. */
const DEFAULT_CPC_MINOR = 50;

/**
 * Native ad serving (§9.1): returns one active campaign for the slot.
 * Campaigns are funded up-front; clicks debit the budget at the flat CPC.
 */
@ApiTags('ads')
@Controller({ path: 'ads', version: '1' })
export class AdsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('serve')
  async serve(@Query(new ZodPipe(serveQuery)) query: z.infer<typeof serveQuery>) {
    const now = new Date();
    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        status: 'active',
        placement: query.placement,
        startsAt: { lte: now },
        endsAt: { gt: now },
        ...(query.cityId ? { OR: [{ cityId: query.cityId }, { cityId: null }] } : {}),
      },
      take: 10,
    });
    const eligible = campaigns.filter((c) => c.spentMinor < c.budgetMinor);
    if (!eligible.length) return { ad: null };
    const pick = eligible[Math.floor(Math.random() * eligible.length)];
    // Impression accounting is best-effort; clicks are the billable event.
    await this.prisma.adCampaign.update({
      where: { id: pick.id },
      data: { impressions: { increment: 1 } },
    });
    return {
      ad: {
        id: pick.id,
        title: pick.title,
        body: pick.body,
        targetUrl: pick.targetUrl,
        imageUrl: pick.imageUrl,
        sponsored: true,
      },
    };
  }

  @Post(':id/click')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async click(@Param('id', ParseUUIDPipe) id: string) {
    const cfg = await this.prisma.appConfig.findUnique({ where: { key: 'ads' } });
    const cpc =
      cfg && typeof cfg.value === 'object' && cfg.value && 'cpc_minor' in cfg.value
        ? Number((cfg.value as { cpc_minor: number }).cpc_minor)
        : DEFAULT_CPC_MINOR;
    const campaign = await this.prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign || campaign.status !== 'active') return { ok: false };
    const spent = campaign.spentMinor + cpc;
    await this.prisma.adCampaign.update({
      where: { id },
      data: {
        clicks: { increment: 1 },
        spentMinor: spent,
        ...(spent >= campaign.budgetMinor ? { status: 'ended' } : {}),
      },
    });
    return { ok: true, targetUrl: campaign.targetUrl };
  }
}
