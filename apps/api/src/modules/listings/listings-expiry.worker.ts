import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ListingsService } from './listings.service';

/** Conditional database updates make concurrent API instances safe. */
@Injectable()
export class ListingsExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ListingsExpiryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly listings: ListingsService) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.listings.expireStale();
    } catch (error) {
      this.logger.error('Listing expiry failed; retrying on next interval', error);
    } finally {
      this.running = false;
    }
  }
}
