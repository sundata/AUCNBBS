import nodemailer from 'nodemailer';
import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { sendResendEmail } from '../../common/mail';
import { generateTotpSecret, totpUri, verifyTotp } from '../../common/totp';

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

/** Returned instead of a token pair when the account requires a second factor. */
export interface MfaRequired {
  mfaRequired: true;
  ticket: string;
}

export type SignInResult =
  (TokenPair & { isNewUser: boolean; mfaSetupRequired?: boolean }) | MfaRequired;

/** Roles that must enrol in TOTP before using staff surfaces (§5.1). */
export const MFA_REQUIRED_ROLES = [
  'moderator',
  'editor',
  'support',
  'compliance',
  'admin',
  'super_admin',
];

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
    ip?: string,
  ): Promise<SignInResult> {
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
    return this.signInIdentity('email_otp', '', email, userAgent, ip);
  }

  async signInIdentity(
    provider: string,
    providerAppId: string,
    providerSubject: string,
    userAgent?: string,
    ip?: string,
  ): Promise<SignInResult> {
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
    if (identity.user.totpEnabledAt && identity.user.totpSecret) {
      const ticket = randomBytes(32).toString('base64url');
      await this.prisma.mfaChallenge.create({
        data: {
          userId,
          token: ticket,
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      });
      return { mfaRequired: true, ticket };
    }
    const tokens = await this.issueTokens(userId, role, userAgent, ip);
    const mfaSetupRequired = MFA_REQUIRED_ROLES.includes(role);
    return { ...tokens, isNewUser, mfaSetupRequired };
  }

  // ---------- TOTP / MFA (§5.1) ----------

  async totpSetup(userId: string): Promise<{ secret: string; uri: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.totpEnabledAt) throw new ForbiddenException('MFA already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    const account = `user-${userId.slice(0, 8)}`;
    return { secret, uri: totpUri(secret, account) };
  }

  async totpEnable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) throw new UnauthorizedException('Run MFA setup first');
    if (!verifyTotp(user.totpSecret, code)) throw new UnauthorizedException('Invalid code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: 'mfa.enable', subject: `user:${userId}` },
    });
  }

  async totpDisable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabledAt) throw new ForbiddenException('MFA not enabled');
    if (MFA_REQUIRED_ROLES.includes(user.role))
      throw new ForbiddenException('Staff accounts cannot disable MFA');
    if (!verifyTotp(user.totpSecret, code)) throw new UnauthorizedException('Invalid code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null },
    });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: 'mfa.disable', subject: `user:${userId}` },
    });
  }

  async mfaComplete(
    ticket: string,
    code: string,
    userAgent?: string,
    ip?: string,
  ): Promise<TokenPair> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { token: ticket },
      include: { user: true },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date())
      throw new UnauthorizedException('MFA challenge expired');
    const consumed = await this.prisma.mfaChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('MFA challenge already used');
    const { user } = challenge;
    if (!user.totpSecret || !verifyTotp(user.totpSecret, code))
      throw new UnauthorizedException('Invalid code');
    return this.issueTokens(user.id, user.role, userAgent, ip);
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
    // Rotate: revoke old session, issue a new one carrying the same device context.
    const revoked = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new UnauthorizedException('Refresh token already used');
    return this.issueTokens(
      session.userId,
      session.user.role,
      session.userAgent ?? undefined,
      session.ipHash ?? undefined,
    );
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
      // Opportunistic last-seen touch for the device list (§5.1 会话管理).
      void this.prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
      return { ...payload, role: session.user.role };
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  /** Public token issuance for verified non-OTP flows (passkey sign-in). */
  async issueSession(
    userId: string,
    role: string,
    userAgent?: string,
    ip?: string,
  ): Promise<TokenPair> {
    return this.issueTokens(userId, role, userAgent, ip);
  }

  private async issueTokens(
    userId: string,
    role: string,
    userAgent?: string,
    ip?: string,
  ): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenFamilyHash: sha256(refreshToken),
        userAgent,
        ipHash: ip ? sha256(ip) : undefined,
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
      },
    });
    const payload: AccessTokenPayload = { sub: userId, role, sid: session.id };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds };
  }
}
