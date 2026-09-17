import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { setAuthCookies } from '../../common/cookies';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from './auth.guard';
import { AccessTokenPayload, AuthService, MFA_REQUIRED_ROLES } from './auth.service';
import { CurrentUser } from './current-user.decorator';

const rpId = () => process.env.WEBAUTHN_RP_ID ?? 'localhost';
const rpName = () => process.env.WEBAUTHN_RP_NAME ?? 'AUCN Hub';
const origins = () =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim());

const registerSchema = z.object({
  ticket: z.string().min(20),
  name: z.string().trim().min(1).max(80).optional(),
  response: z.record(z.unknown()),
});
const loginOptionsSchema = z.object({ email: z.string().email().optional() });
const loginVerifySchema = z.object({
  ticket: z.string().min(20),
  response: z.record(z.unknown()),
});

interface TicketPayload {
  typ: 'pkreg' | 'pkauth';
  ch: string;
}

/**
 * WebAuthn/passkey sign-in and credential management (§5.1).
 * The ceremony challenge rides in a 5-minute signed ticket instead of
 * server-side state so the flow works across instances. A passkey assertion
 * is itself a phishing-resistant factor, so passkey login does not require
 * an additional TOTP step.
 */
@ApiTags('auth')
@Controller({ path: 'auth/passkey', version: '1' })
export class PasskeyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  private ticket(payload: TicketPayload): string {
    return this.jwt.sign(payload, { expiresIn: '5m' });
  }

  private readTicket(raw: string, typ: TicketPayload['typ']): string {
    try {
      const p = this.jwt.verify<TicketPayload>(raw);
      if (p.typ !== typ) throw new Error('type');
      return p.ch;
    } catch {
      throw new UnauthorizedException('Passkey challenge expired');
    }
  }

  // ---------- Registration (signed-in user adds a passkey) ----------

  @Post('register/options')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async registerOptions(@CurrentUser() user: AccessTokenPayload) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: { id: true, displayName: true, passkeys: { select: { credentialId: true } } },
    });
    const email = await this.prisma.identity.findFirst({
      where: { userId: user.sub, provider: 'email_otp', revokedAt: null },
      select: { providerSubject: true },
    });
    const options = await generateRegistrationOptions({
      rpName: rpName(),
      rpID: rpId(),
      userName: email?.providerSubject ?? account.displayName,
      userDisplayName: account.displayName,
      userID: Buffer.from(user.sub, 'utf8'),
      excludeCredentials: account.passkeys.map((p) => ({ id: p.credentialId })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    return { options, ticket: this.ticket({ typ: 'pkreg', ch: options.challenge }) };
  }

  @Post('register')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async register(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>,
  ) {
    const challenge = this.readTicket(body.ticket, 'pkreg');
    const result = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: challenge,
      expectedOrigin: origins(),
      expectedRPID: rpId(),
    });
    if (!result.verified || !result.registrationInfo)
      throw new ForbiddenException('Passkey verification failed');
    const { credential } = result.registrationInfo;
    await this.prisma.passkeyCredential.create({
      data: {
        userId: user.sub,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports?.join(',') ?? null,
        name: body.name ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'passkey.register', subject: `user:${user.sub}` },
    });
    return { ok: true };
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async list(@CurrentUser() user: AccessTokenPayload) {
    return {
      items: await this.prisma.passkeyCredential.findMany({
        where: { userId: user.sub },
        select: {
          id: true,
          name: true,
          transports: true,
          lastUsedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    };
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async remove(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.prisma.passkeyCredential.deleteMany({
      where: { id, userId: user.sub },
    });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }

  // ---------- Authentication (passwordless sign-in) ----------

  @Post('login/options')
  async loginOptions(@Body(new ZodPipe(loginOptionsSchema)) body: { email?: string }) {
    let allowCredentials: { id: string; transports?: never[] }[] | undefined;
    if (body.email) {
      const identity = await this.prisma.identity.findUnique({
        where: {
          provider_providerAppId_providerSubject: {
            provider: 'email_otp',
            providerAppId: '',
            providerSubject: body.email.trim().toLowerCase(),
          },
        },
        include: { user: { select: { passkeys: true } } },
      });
      if (identity) {
        allowCredentials = identity.user.passkeys.map((p) => ({
          id: p.credentialId,
          transports: p.transports?.split(',') as never[],
        }));
      }
    }
    const options = await generateAuthenticationOptions({
      rpID: rpId(),
      allowCredentials,
      userVerification: 'preferred',
    });
    return { options, ticket: this.ticket({ typ: 'pkauth', ch: options.challenge }) };
  }

  @Post('login/verify')
  async loginVerify(
    @Body(new ZodPipe(loginVerifySchema)) body: z.infer<typeof loginVerifySchema>,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const challenge = this.readTicket(body.ticket, 'pkauth');
    const response = body.response as { id?: string };
    const stored = response.id
      ? await this.prisma.passkeyCredential.findUnique({
          where: { credentialId: response.id },
          include: { user: true },
        })
      : null;
    if (!stored || stored.user.status !== 'active')
      throw new UnauthorizedException('Unknown passkey');
    const result = await verifyAuthenticationResponse({
      response: body.response as never,
      expectedChallenge: challenge,
      expectedOrigin: origins(),
      expectedRPID: rpId(),
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports?.split(',') as never,
      },
    });
    if (!result.verified) throw new UnauthorizedException('Passkey verification failed');
    await this.prisma.passkeyCredential.update({
      where: { id: stored.id },
      data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });
    const tokens = await this.auth.issueSession(stored.userId, stored.user.role, userAgent, ip);
    setAuthCookies(res, tokens);
    return {
      ...tokens,
      isNewUser: false,
      mfaSetupRequired: MFA_REQUIRED_ROLES.includes(stored.user.role),
    };
  }
}
