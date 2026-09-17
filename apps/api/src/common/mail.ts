import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

const logger = new Logger('Mailer');

export async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  text,
}: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend API rejected the email: ${response.status} ${detail}`);
  }
}

/** Best-effort transactional email: SMTP first, Resend fallback. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const from = process.env.SMTP_FROM;
  const smtpUrl = process.env.SMTP_URL;
  if (smtpUrl && from) {
    try {
      await nodemailer.createTransport(smtpUrl).sendMail({ from, to, subject, text });
      return true;
    } catch (error) {
      logger.error('SMTP delivery failed, trying Resend', error);
    }
  }
  if (process.env.RESEND_API_KEY && from) {
    try {
      await sendResendEmail({ apiKey: process.env.RESEND_API_KEY, from, to, subject, text });
      return true;
    } catch (error) {
      logger.error('Resend delivery failed', error);
    }
  }
  return false;
}
