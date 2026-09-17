import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { ListingsService } from './listings.service';

const now = new Date('2026-09-12T00:00:00Z');
function setup(status = 'active', expiresAt = new Date(now.getTime() - 1)) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const row = {
    id: 'listing',
    ownerId: 'owner',
    status,
    expiresAt,
    version: 3,
    type: 'item',
    riskFlags: [] as string[],
    owner: { id: 'owner', displayName: 'Owner', createdAt: now },
    city: {},
    createdAt: now,
    publishedAt: now,
  };
  const listing = {
    findUnique: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockResolvedValue({ ...row, status: 'active' }),
    updateMany: vi.fn().mockResolvedValue({ count: 2 }),
  };
  const prisma = {
    listing,
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'member' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  return { listing, service: new ListingsService(prisma as unknown as PrismaService) };
}
afterEach(() => vi.useRealTimers());
describe('listing lifecycle', () => {
  it.each(['active', 'reserved', 'paused', 'expired'])(
    'renews expired %s listings before worker runs',
    async (status) => {
      const { service, listing } = setup(status);
      await service.changeStatus('owner', 'listing', 'active');
      expect(listing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'listing', version: 3 },
          data: expect.objectContaining({
            status: 'active',
            version: { increment: 1 },
            publishedAt: now,
            expiresAt: expect.any(Date),
          }),
        }),
      );
      expect(listing.update.mock.calls[0][0].data.expiresAt.getTime()).toBeGreaterThan(
        now.getTime(),
      );
    },
  );
  it.each(['completed', 'removed', 'archived', 'rejected'])(
    'does not revive terminal %s listings',
    async (status) => {
      const { service, listing } = setup(status);
      await expect(service.changeStatus('owner', 'listing', 'active')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(listing.update).not.toHaveBeenCalled();
    },
  );
  it('rejects non-owners', async () => {
    const { service, listing } = setup();
    await expect(service.changeStatus('other', 'listing', 'active')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(listing.update).not.toHaveBeenCalled();
  });
  it('does not extend expiry when resuming a current listing', async () => {
    const { service, listing } = setup('paused', new Date(now.getTime() + 1000));
    await service.changeStatus('owner', 'listing', 'active');
    expect(listing.update.mock.calls[0][0].data).not.toHaveProperty('expiresAt');
  });
  it('returns conflict when another writer changes the version', async () => {
    const { service, listing } = setup();
    listing.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('stale', { code: 'P2025', clientVersion: '6' }),
    );
    await expect(service.changeStatus('owner', 'listing', 'active')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('increments versions when expiring eligible listings', async () => {
    const { service, listing } = setup();
    expect(await service.expireStale(now)).toBe(2);
    expect(listing.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['active', 'reserved', 'paused'] }, expiresAt: { lte: now } },
      data: { status: 'expired', version: { increment: 1 } },
    });
  });
});
