import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Write a domain event into the transactional outbox (§12.3). A worker
 * publishes pending rows; keeping writes atomic with the state change
 * guarantees no event is lost between commit and dispatch.
 */
export async function outbox(
  tx: Tx,
  aggregate: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.outboxEvent.create({
    data: { aggregate, eventType, payload: payload as Prisma.InputJsonValue },
  });
}
