import { Prisma } from '@prisma/client';
import type { PrismaService } from '../modules/prisma/prisma.service';
import { SECURITY_NOTIFICATION_KINDS, type NotificationCategory } from '@aucn/domain';

/** Map a notification kind to its preference category (§5.9). */
const KIND_CATEGORY: Record<string, NotificationCategory> = {
  message: 'interactions',
  comment: 'interactions',
  reply: 'interactions',
  favorite: 'interactions',
  follow: 'interactions',
  'listing.approved': 'system',
  'listing.rejected': 'system',
  'listing.expired': 'system',
  'event.reminder': 'system',
  'event.cancelled': 'system',
  'event.promoted_from_waitlist': 'system',
  'saved_search.match': 'system',
  'payment.paid': 'system',
  'lead.new': 'leads',
  'offer.new': 'marketing',
  'ad.report': 'marketing',
};

export function categoryForKind(kind: string): NotificationCategory {
  if ((SECURITY_NOTIFICATION_KINDS as readonly string[]).includes(kind)) return 'security';
  return KIND_CATEGORY[kind] ?? 'system';
}

type Prefs =
  | Record<string, { inapp?: boolean; email?: boolean; push?: boolean; sms?: boolean }>
  | null
  | undefined;

/** Security-critical notifications ignore user preferences. */
export function wantsInapp(prefs: Prefs, kind: string): boolean {
  if (categoryForKind(kind) === 'security') return true;
  const p = prefs?.[categoryForKind(kind)];
  return p?.inapp !== false;
}

/**
 * Fan a notification out across the channels the user enabled (§5.9):
 * in-app always honoured, email/push/sms only when the category pref is
 * explicitly on and the provider is configured. Security notifications
 * bypass preferences. Channel delivery is best-effort.
 */
export async function notify(
  prisma: PrismaService,
  userId: string,
  kind: string,
  subjectId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true, marketingOptOutAt: true },
  });
  if (!user) return;
  const category = categoryForKind(kind);
  if (category === 'marketing' && user.marketingOptOutAt) return;
  const prefs = user.notificationPrefs as Prefs;
  const p = prefs?.[category] ?? {};
  const isSecurity = category === 'security';
  if (isSecurity || p.inapp !== false) {
    await prisma.notification.create({
      data: {
        userId,
        kind,
        subjectId,
        ...(data ? { data: data as Prisma.InputJsonValue } : {}),
      },
    });
  }
  if (!isSecurity && !p.email && !p.push && !p.sms) return;
  const { deliverEmail, deliverPush, deliverSms, notificationCopy } =
    await import('./notify-channels');
  const copy = notificationCopy(kind, data);
  await Promise.all([
    isSecurity || p.email ? deliverEmail(prisma, userId, copy) : null,
    isSecurity || p.push ? deliverPush(prisma, userId, copy) : null,
    p.sms ? deliverSms(prisma, userId, copy) : null,
  ]);
}
