import {
  Body,
  Controller,
  Headers,
  Ip,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { setAuthCookies } from '../../common/cookies';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';
const phone = z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) });
const check = phone.extend({ code: z.string().regex(/^\d{6}$/) });
export function phoneEnabled() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}
@Controller({ path: 'auth/phone', version: '1' })
export class PhoneController {
  constructor(private readonly auth: AuthService) {}
  private async call(path: string, body: URLSearchParams) {
    if (!phoneEnabled()) throw new ServiceUnavailableException('SMS provider is not configured');
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/${path}`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) throw new UnauthorizedException('SMS verification failed');
    return res.json() as Promise<{ status: string }>;
  }
  @Post('request')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async request(@Body(new ZodPipe(phone)) input: z.infer<typeof phone>) {
    await this.call('Verifications', new URLSearchParams({ To: input.phone, Channel: 'sms' }));
    return { ttlSeconds: 600 };
  }
  @Post('verify')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async verify(
    @Body(new ZodPipe(check)) input: z.infer<typeof check>,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.call(
      'VerificationCheck',
      new URLSearchParams({ To: input.phone, Code: input.code }),
    );
    if (result.status !== 'approved') throw new UnauthorizedException('Invalid code');
    const signIn = await this.auth.signInIdentity('phone_otp', '', input.phone, userAgent, ip);
    if ('accessToken' in signIn) setAuthCookies(res, signIn);
    return signIn;
  }
}
