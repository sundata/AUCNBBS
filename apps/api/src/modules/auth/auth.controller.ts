import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  mfaCompleteSchema,
  otpRequestSchema,
  otpVerifySchema,
  totpVerifySchema,
} from '@aucn/domain';
import { z } from 'zod';
import {
  clearAuthCookies,
  cookieToken,
  REFRESH_COOKIE,
  setAuthCookies,
} from '../../common/cookies';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AccessTokenPayload, AuthService, SignInResult, TokenPair } from './auth.service';

const refreshSchema = z.object({ refreshToken: z.string().min(20).optional() });

function isTokenPair(result: SignInResult): result is TokenPair & { isNewUser: boolean } {
  return 'accessToken' in result;
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(202)
  requestOtp(
    @Body(new ZodPipe(otpRequestSchema)) body: z.infer<typeof otpRequestSchema>,
  ): Promise<{ ttlSeconds: number }> {
    return this.auth.requestOtp(body.email);
  }

  @Post('otp/verify')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async verifyOtp(
    @Body(new ZodPipe(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    const result = await this.auth.verifyOtp(body.email, body.code, userAgent, ip);
    if (isTokenPair(result)) setAuthCookies(res, result);
    return result;
  }

  @Post('mfa/complete')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async mfaComplete(
    @Body(new ZodPipe(mfaCompleteSchema)) body: z.infer<typeof mfaCompleteSchema>,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPair> {
    const tokens = await this.auth.mfaComplete(body.ticket, body.code, userAgent, ip);
    setAuthCookies(res, tokens);
    return tokens;
  }

  @Post('mfa/setup')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  mfaSetup(@CurrentUser() user: AccessTokenPayload) {
    return this.auth.totpSetup(user.sub);
  }

  @Post('mfa/enable')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async mfaEnable(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(totpVerifySchema)) body: z.infer<typeof totpVerifySchema>,
  ) {
    await this.auth.totpEnable(user.sub, body.code);
    return { ok: true };
  }

  @Post('mfa/disable')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async mfaDisable(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(totpVerifySchema)) body: z.infer<typeof totpVerifySchema>,
  ) {
    await this.auth.totpDisable(user.sub, body.code);
    return { ok: true };
  }

  /** Cookie refresh (browser) or body refresh (native). Rotates either way. */
  @Post('refresh')
  async refresh(
    @Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPair> {
    const token = body.refreshToken ?? cookieToken(req, REFRESH_COOKIE);
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const pair = await this.auth.refresh(token);
    setAuthCookies(res, pair);
    return pair;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = body.refreshToken ?? cookieToken(req, REFRESH_COOKIE);
    if (token) await this.auth.logout(token);
    clearAuthCookies(res);
  }

  /** Browser session bootstrap: validates the access cookie and reports the user. */
  @Get('session')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  session(@CurrentUser() user: AccessTokenPayload) {
    return { userId: user.sub, role: user.role, sessionId: user.sid };
  }
}
