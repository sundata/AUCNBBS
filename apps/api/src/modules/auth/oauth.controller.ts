import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { phoneEnabled } from './phone.controller';
import { ZodPipe } from '../../common/zod.pipe';
import { setAuthCookies } from '../../common/cookies';
const providers = ['google', 'apple', 'wechat'] as const;
const startSchema = z.object({
  provider: z.enum(providers),
  locale: z.enum(['zh', 'en']),
  binding: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/),
});
const completeSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/),
  code: z.string().min(1).max(4096),
  binding: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/),
});
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
function config(provider: string) {
  if (provider === 'google')
    return {
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
      auth: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
    };
  if (provider === 'apple')
    return {
      id: process.env.APPLE_CLIENT_ID,
      secret: process.env.APPLE_CLIENT_SECRET,
      auth: 'https://appleid.apple.com/auth/authorize',
      token: 'https://appleid.apple.com/auth/token',
    };
  if (provider === 'wechat')
    return {
      id: process.env.WECHAT_WEB_APP_ID,
      secret: process.env.WECHAT_WEB_APP_SECRET,
      auth: 'https://open.weixin.qq.com/connect/qrconnect',
      token: 'https://api.weixin.qq.com/sns/oauth2/access_token',
    };
  throw new UnauthorizedException('Unknown provider');
}
@Controller({ path: 'auth', version: '1' })
export class OAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}
  @Get('providers')
  available() {
    return {
      oauth: providers.filter((p) => {
        const c = config(p);
        return !!(c.id && c.secret);
      }),
      phone: phoneEnabled(),
    };
  }
  private callback(provider: string) {
    return `${process.env.API_PUBLIC_URL ?? 'http://localhost:4000'}/api/v1/auth/oauth/${provider}/callback`;
  }
  @Post('oauth/start')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async start(@Body(new ZodPipe(startSchema)) input: z.infer<typeof startSchema>) {
    const c = config(input.provider);
    if (!c.id || !c.secret) throw new ServiceUnavailableException('Provider is not configured');
    const state = randomBytes(32).toString('base64url');
    const pkce = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    await this.prisma.oAuthAttempt.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.oAuthAttempt.create({
      data: {
        id: state,
        provider: input.provider,
        verifier: `${pkce}.${hash(input.binding)}`,
        nonce,
        locale: input.locale,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const params = new URLSearchParams({
      client_id: c.id,
      response_type: 'code',
      redirect_uri: this.callback(input.provider),
      state,
      nonce,
    });
    if (input.provider === 'wechat') {
      params.delete('client_id');
      params.set('appid', c.id);
      params.set('scope', 'snsapi_login');
    } else {
      params.set('scope', 'openid email');
      if (input.provider === 'google') {
        params.set('code_challenge', hash(pkce));
        params.set('code_challenge_method', 'S256');
      } else params.set('response_mode', 'form_post');
    }
    return { url: `${c.auth}?${params}${input.provider === 'wechat' ? '#wechat_redirect' : ''}` };
  }
  private async redirect(provider: string, data: Record<string, string>, res: Response) {
    const attempt =
      typeof data.state === 'string'
        ? await this.prisma.oAuthAttempt.findUnique({ where: { id: data.state } })
        : null;
    if (!attempt || attempt.provider !== provider || attempt.expiresAt <= new Date())
      throw new UnauthorizedException('Invalid login state');
    const params = new URLSearchParams(
      data.error ? { error: 'provider_denied' } : { code: data.code ?? '', state: data.state },
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(
      `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/${attempt.locale}/auth/callback#${params}`,
    );
  }
  @Get('oauth/:provider/callback')
  callbackGet(
    @Param('provider') provider: string,
    @Query() data: Record<string, string>,
    @Res() res: Response,
  ) {
    return this.redirect(provider, data, res);
  }
  @Post('oauth/:provider/callback')
  callbackPost(
    @Param('provider') provider: string,
    @Body() data: Record<string, string>,
    @Res() res: Response,
  ) {
    return this.redirect(provider, data, res);
  }
  @Post('oauth/complete')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async complete(
    @Body(new ZodPipe(completeSchema)) input: z.infer<typeof completeSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const attempt = await this.prisma.oAuthAttempt.findUnique({ where: { id: input.state } });
    if (!attempt || attempt.expiresAt <= new Date())
      throw new UnauthorizedException('Login expired');
    const [pkce, bindingHash] = attempt.verifier.split('.');
    if (bindingHash !== hash(input.binding))
      throw new UnauthorizedException('Login browser mismatch');
    const consumed = await this.prisma.oAuthAttempt.deleteMany({
      where: { id: attempt.id, expiresAt: { gt: new Date() } },
    });
    if (!consumed.count) throw new UnauthorizedException('Login already used');
    const c = config(attempt.provider);
    if (!c.id || !c.secret) throw new ServiceUnavailableException();
    const params = new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: this.callback(attempt.provider),
    });
    if (attempt.provider === 'google') params.set('code_verifier', pkce);
    let subject: string;
    try {
      if (attempt.provider === 'wechat') {
        const query = new URLSearchParams({
          appid: c.id,
          secret: c.secret,
          code: input.code,
          grant_type: 'authorization_code',
        });
        const res = await fetch(`${c.token}?${query}`, { signal: AbortSignal.timeout(15000) });
        const data = (await res.json()) as { openid?: string; errcode?: number };
        if (!res.ok || data.errcode || !data.openid) throw new Error();
        subject = data.openid;
      } else {
        const res = await fetch(c.token, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params,
          signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json()) as { id_token?: string };
        if (!res.ok || !data.id_token) throw new Error();
        const { payload } = await jwtVerify(
          data.id_token,
          attempt.provider === 'google' ? googleKeys : appleKeys,
          {
            audience: c.id,
            issuer:
              attempt.provider === 'google'
                ? ['https://accounts.google.com', 'accounts.google.com']
                : 'https://appleid.apple.com',
            algorithms: ['RS256'],
          },
        );
        if (!payload.sub || payload.nonce !== attempt.nonce) throw new Error();
        subject = payload.sub;
      }
    } catch {
      throw new UnauthorizedException('Provider verification failed');
    }
    const result = await this.auth.signInIdentity(attempt.provider, c.id, subject);
    if ('accessToken' in result) setAuthCookies(res, result);
    return result;
  }
}
