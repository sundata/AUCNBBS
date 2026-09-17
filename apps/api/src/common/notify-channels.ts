import { Logger } from '@nestjs/common';
import webpush from 'web-push';
import type { PrismaService } from '../modules/prisma/prisma.service';
import { sendMail } from './mail';

const logger = new Logger('NotifyChannels');

const SITE = () => process.env.PUBLIC_SITE_URL ?? 'https://aucnhub.example';

/** Human-readable copy per notification kind for out-of-app channels. */
export function notificationCopy(
  kind: string,
  data?: Record<string, unknown>,
): {
  title: string;
  body: string;
  url: string;
} {
  const d = data ?? {};
  switch (kind) {
    case 'message':
      return { title: 'AUCN Hub', body: 'You have a new message', url: '/messages' };
    case 'event.reminder':
      return {
        title: 'Event starting soon',
        body: String(d.title ?? 'Your event starts within 24 hours'),
        url: `/events/${d.eventId ?? ''}`,
      };
    case 'saved_search.match':
      return {
        title: 'New results',
        body: `${d.count ?? 'New'} matches for "${d.name ?? 'your saved search'}"`,
        url: '/me',
      };
    case 'listing.approved':
      return { title: 'AUCN Hub', body: 'Your listing was approved', url: '/me' };
    case 'listing.rejected':
      return {
        title: 'AUCN Hub',
        body: `Your listing needs changes: ${d.reason ?? 'see review'}`,
        url: '/me',
      };
    case 'event.promoted_from_waitlist':
      return { title: 'AUCN Hub', body: 'A spot opened up — you are going!', url: '/events' };
    case 'lead.new':
      return { title: 'AUCN Hub', body: 'New enquiry for your business', url: '/me' };
    default:
      return { title: 'AUCN Hub', body: `Notification: ${kind}`, url: '/me' };
  }
}

/** Look up the user's verified email (email_otp identity). */
async function emailFor(prisma: PrismaService, userId: string): Promise<string | null> {
  const identity = await prisma.identity.findFirst({
    where: { userId, provider: 'email_otp', revokedAt: null },
    select: { providerSubject: true },
  });
  return identity?.providerSubject ?? null;
}

export async function deliverEmail(
  prisma: PrismaService,
  userId: string,
  copy: { title: string; body: string; url: string },
): Promise<void> {
  const to = await emailFor(prisma, userId);
  if (!to) return;
  await sendMail(to, copy.title, `${copy.body}\n\n${SITE()}${copy.url}`);
}

/** Twilio Messages API (Verify service is OTP-only). Off unless TWILIO_* is set. */
export async function deliverSms(
  prisma: PrismaService,
  userId: string,
  copy: { title: string; body: string },
): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return;
  const identity = await prisma.identity.findFirst({
    where: { userId, provider: 'phone_otp', revokedAt: null },
    select: { providerSubject: true },
  });
  if (!identity) return;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: from,
        To: identity.providerSubject,
        Body: `${copy.title}: ${copy.body}`,
      }),
    });
    if (!res.ok) logger.error(`Twilio rejected the SMS: ${res.status} ${await res.text()}`);
  } catch (error) {
    logger.error('SMS delivery failed', error);
  }
}

let vapidReady: boolean | null = null;
function vapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  vapidReady = !!(pub && priv);
  if (vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? `mailto:${process.env.SMTP_FROM ?? 'ops@example.com'}`,
      pub!,
      priv!,
    );
  }
  return vapidReady;
}

export async function deliverPush(
  prisma: PrismaService,
  userId: string,
  copy: { title: string; body: string; url: string },
): Promise<void> {
  if (!vapid()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: copy.title, body: copy.body, url: `${SITE()}${copy.url}` }),
      );
      await prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { lastSeenAt: new Date() },
      });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
      } else {
        logger.error('Push delivery failed', error);
      }
    }
  }
}
