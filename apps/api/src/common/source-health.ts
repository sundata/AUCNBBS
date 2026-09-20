/**
 * Liveness derived purely from schedule bookkeeping, so a collector that never
 * initialised (bad env JSON, DB down at boot) shows up as `stalled` — its
 * nextRunAt drifts further and further into the past.
 */
export type SourceHealth = 'ok' | 'late' | 'stalled' | 'failing' | 'disabled' | 'never';

export function sourceHealth(
  s: {
    enabled: boolean;
    failures: number;
    intervalMinutes: number;
    lastRunAt: Date | null;
    nextRunAt: Date | null;
  },
  now = new Date(),
): SourceHealth {
  if (!s.enabled) return 'disabled';
  if (!s.lastRunAt) return 'never';
  const overdueMs = s.nextRunAt ? now.getTime() - s.nextRunAt.getTime() : 0;
  if (overdueMs > s.intervalMinutes * 60000) return 'stalled';
  if (s.failures > 0) return 'failing';
  if (overdueMs > 0) return 'late';
  return 'ok';
}
