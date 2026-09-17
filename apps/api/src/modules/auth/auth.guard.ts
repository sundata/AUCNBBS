import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ACCESS_COOKIE, cookieToken, csrfOk } from '../../common/cookies';
import { AccessTokenPayload, AuthService, MFA_REQUIRED_ROLES } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}

/**
 * Bearer header first (native/API clients), httpOnly cookie as the browser
 * fallback (W-1). Returns the token plus whether it came from a cookie —
 * cookie-sourced credentials additionally require the CSRF double-submit
 * header on mutating requests.
 */
function bearerOrCookie(req: Request): { token?: string; viaCookie: boolean } {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return { token: header.slice(7), viaCookie: false };
  const token = cookieToken(req, ACCESS_COOKIE);
  return { token, viaCookie: !!token };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { token, viaCookie } = bearerOrCookie(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');
    if (viaCookie && !csrfOk(req)) throw new ForbiddenException('CSRF token missing');
    req.user = await this.auth.verifyAccessToken(token);
    return true;
  }
}

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { token, viaCookie } = bearerOrCookie(req);
    if (token) {
      if (viaCookie && !csrfOk(req)) throw new ForbiddenException('CSRF token missing');
      req.user = await this.auth.verifyAccessToken(token);
    }
    return true;
  }
}

/**
 * §5.1: staff-role accounts must enrol TOTP before touching staff surfaces.
 * Applied alongside AuthGuard on admin/moderation controllers; members are
 * unaffected (the role check is a no-op for them).
 */
@Injectable()
export class StaffMfaGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user || !(MFA_REQUIRED_ROLES as readonly string[]).includes(user.role)) return true;
    const row = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { totpEnabledAt: true },
    });
    if (!row?.totpEnabledAt) {
      throw new ForbiddenException('Two-factor enrolment required for staff accounts');
    }
    return true;
  }
}
