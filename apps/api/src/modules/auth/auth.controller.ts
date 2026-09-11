import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { otpRequestSchema, otpVerifySchema } from '@aucn/domain';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService, TokenPair } from './auth.service';

const refreshSchema = z.object({ refreshToken: z.string().min(20) });

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
  verifyOtp(
    @Body(new ZodPipe(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPair & { isNewUser: boolean }> {
    return this.auth.verifyOtp(body.email, body.code, userAgent);
  }

  @Post('refresh')
  refresh(
    @Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
  ): Promise<TokenPair> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }
}
