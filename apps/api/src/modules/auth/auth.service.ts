import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

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
    const delivery = process.env.OTP_DELIVERY ?? 'log';
    if (delivery === 'log' && process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV OTP] ${email} -> ${code}`);
    } else {
      // SMTP / provider delivery is wired in a later increment; do not leak codes in production logs.
      this.logger.warn(`OTP delivery '${delivery}' not configured; code for ${email} was not sent`);
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
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const identity = await this.prisma.identity.findUnique({
      where: {
        provider_providerAppId_providerSubject: {
          provider: 'email_otp',
          providerAppId: '',
          providerSubject: email,
        },
      },
      include: { user: true },
    });
    let userId: string;
    let role: string;
    let isNewUser = false;
    if (identity) {
      if (identity.user.status === 'banned' || identity.user.status === 'deleted') {
        throw new UnauthorizedException('Account unavailable');
      }
      userId = identity.userId;
      role = identity.user.role;
    } else {
      const user = await this.prisma.user.create({
        data: {
          displayName: `用户${randomBytes(3).toString('hex')}`,
          identities: {
            create: { provider: 'email_otp', providerSubject: email, verifiedAt: new Date() },
          },
        },
      });
      userId = user.id;
      role = user.role;
      isNewUser = true;
    }
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const tokens = await this.issueTokens(userId, role, userAgent);
    return { ...tokens, isNewUser };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const session = await this.prisma.session.findUnique({
      where: { tokenFamilyHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid');
    }
    // Rotate: revoke old session, issue a new one.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
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
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
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
