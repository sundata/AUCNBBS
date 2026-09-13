import nodemailer from 'nodemailer';
import {
  Injectable,
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

async function sendResendEmail({
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
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend API rejected the email: ${response.status} ${detail}`);
  }
}

export interface AccessTokenPayload {
  sub: string;
  role: string;
  sid: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const OTP_MAX_ATTEMPTS = 5;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseTtlSeconds(ttl: string, fallback: number): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return fallback;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86_400 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private get otpTtlSeconds(): number {
    return Number(process.env.OTP_TTL_SECONDS ?? 600);
  }

  private get refreshTtlSeconds(): number {
    return parseTtlSeconds(process.env.JWT_REFRESH_TTL ?? '30d', 30 * 86_400);
  }

  private get accessTtlSeconds(): number {
    return parseTtlSeconds(process.env.JWT_ACCESS_TTL ?? '15m', 900);
  }

  async requestOtp(rawEmail: string): Promise<{ ttlSeconds: number }> {
    const delivery = process.env.OTP_DELIVERY ?? 'log';
    if (
      !(delivery === 'log' && process.env.NODE_ENV !== 'production') &&
      !(delivery === 'smtp' && process.env.SMTP_URL && process.env.SMTP_FROM)
    )
      throw new ServiceUnavailableException('Email delivery is not configured');
    const email = rawEmail.trim().toLowerCase();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpChallenge.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.otpChallenge.create({
      data: {
        email,
        codeHash: sha256(`${email}:${code}`),
        expiresAt: new Date(Date.now() + this.otpTtlSeconds * 1000),
      },
    });
    if (delivery === 'log' && process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV OTP] ${email} -> ${code}`);
    } else {
      try {
        const messageText = `Your verification code is ${code}. It expires in ${Math.ceil(this.otpTtlSeconds / 60)} minutes.`;
        const smtpFrom = process.env.SMTP_FROM!;
        const smtpUrl = process.env.SMTP_URL!;

        await nodemailer.createTransport(smtpUrl).sendMail({
          from: smtpFrom,
          to: email,
          subject: 'AUCN Hub sign-in code',
          text: messageText,
        });
      } catch (smtpError) {
        const resendApiKey = process.env.RESEND_API_KEY;
        const resendFrom = process.env.SMTP_FROM;
        const resendRecipient = email;

        if (resendApiKey && resendFrom && resendRecipient) {
          try {
            await sendResendEmail({
              apiKey: resendApiKey,
              from: resendFrom,
              to: resendRecipient,
              subject: 'AUCN Hub sign-in code',
              text: `Your verification code is ${code}. It expires in ${Math.ceil(this.otpTtlSeconds / 60)} minutes.`,
            });
          } catch (resendError) {
            this.logger.error('SMTP failed and Resend fallback failed', {
              smtpError,
              resendError,
              email,
            });
            await this.prisma.otpChallenge.updateMany({
              where: { email, codeHash: sha256(`${email}:${code}`), consumedAt: null },
              data: { consumedAt: new Date() },
            });
            throw new ServiceUnavailableException('Email delivery failed; please retry');
          }
        } else {
          this.logger.error('SMTP delivery failed', { smtpError, email });
          await this.prisma.otpChallenge.updateMany({
            where: { email, codeHash: sha256(`${email}:${code}`), consumedAt: null },
            data: { consumedAt: new Date() },
          });
          throw new ServiceUnavailableException('Email delivery failed; please retry');
        }
      }
    }
    return { ttlSeconds: this.otpTtlSeconds };
  }

  async verifyOtp(
    rawEmail: string,
    code: string,
    userAgent?: string,
  ): Promise<TokenPair & { isNewUser: boolean }> {
    const email = rawEmail.trim().toLowerCase();
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new UnauthorizedException('OTP expired or not requested');
    if (challenge.attempts >= OTP_MAX_ATTEMPTS)
      throw new UnauthorizedException('Too many attempts');
    if (challenge.codeHash !== sha256(`${email}:${code}`)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid code');
    }
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        attempts: { lt: OTP_MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('Code already used or expired');
    return this.signInIdentity('email_otp', '', email, userAgent);
  }

  async signInIdentity(
    provider: string,
    providerAppId: string,
    providerSubject: string,
    userAgent?: string,
  ): Promise<TokenPair & { isNewUser: boolean }> {
    const where = {
      provider_providerAppId_providerSubject: { provider, providerAppId, providerSubject },
    };
    const existing = await this.prisma.identity.findUnique({ where });
    const identity = await this.prisma.identity.upsert({
      where,
      update: {},
      create: {
        provider,
        providerAppId,
        providerSubject,
        verifiedAt: new Date(),
        user: { create: { displayName: `User ${randomBytes(3).toString('hex')}` } },
      },
      include: { user: true },
    });
    if (identity.revokedAt || identity.user.status !== 'active')
      throw new UnauthorizedException('Account unavailable');
    const userId = identity.userId;
    const role = identity.user.role;
    const isNewUser = !existing;
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const tokens = await this.issueTokens(userId, role, userAgent);
    return { ...tokens, isNewUser };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const session = await this.prisma.session.findUnique({
      where: { tokenFamilyHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'active'
    ) {
      throw new UnauthorizedException('Refresh token invalid');
    }
    // Rotate: revoke old session, issue a new one.
    const revoked = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new UnauthorizedException('Refresh token already used');
    return this.issueTokens(session.userId, session.user.role, session.userAgent ?? undefined);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenFamilyHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      const session = await this.prisma.session.findFirst({
        where: {
          id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: 'active' },
        },
        include: { user: { select: { role: true } } },
      });
      if (!session) throw new UnauthorizedException('Session unavailable');
      return { ...payload, role: session.user.role };
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private async issueTokens(userId: string, role: string, userAgent?: string): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenFamilyHash: sha256(refreshToken),
        userAgent,
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
      },
    });
    const payload: AccessTokenPayload = { sub: userId, role, sid: session.id };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds };
  }
}
