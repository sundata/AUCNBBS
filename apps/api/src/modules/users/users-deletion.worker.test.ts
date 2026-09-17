import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersDeletionWorker } from './users-deletion.worker';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('users deletion worker', () => {
  it('polls hourly for due deletions and stops on shutdown', async () => {
    vi.useFakeTimers();
    const findMany = vi.fn().mockResolvedValue([]);
    const worker = new UsersDeletionWorker({
      user: { findMany },
    } as unknown as PrismaService);
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(findMany).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('skips overlapping runs and retries after failure', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    let reject!: (error: Error) => void;
    const findMany = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue([]);
    const worker = new UsersDeletionWorker({
      user: { findMany },
    } as unknown as PrismaService);
    const first = worker.tick();
    await worker.tick();
    expect(findMany).toHaveBeenCalledTimes(1);
    reject(new Error('database unavailable'));
    await first;
    await worker.tick();
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
