import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ListingsExpiryWorker } from './listings-expiry.worker';
import { ListingsService } from './listings.service';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('expiry worker', () => {
  it('runs on startup, every minute, and stops on shutdown', async () => {
    vi.useFakeTimers();
    const expireStale = vi.fn().mockResolvedValue(0);
    const worker = new ListingsExpiryWorker({ expireStale } as unknown as ListingsService);
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireStale).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireStale).toHaveBeenCalledTimes(2);
  });
  it('skips overlapping runs and retries after failure', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    let reject!: (error: Error) => void;
    const expireStale = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(0);
    const worker = new ListingsExpiryWorker({ expireStale } as unknown as ListingsService);
    const first = worker.tick();
    await worker.tick();
    expect(expireStale).toHaveBeenCalledTimes(1);
    reject(new Error('database unavailable'));
    await first;
    await worker.tick();
    expect(expireStale).toHaveBeenCalledTimes(2);
  });
});
