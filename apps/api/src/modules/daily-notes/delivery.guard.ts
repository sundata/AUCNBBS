import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
@Injectable()
export class DeliveryGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const key = process.env.DAILY_NOTES_INGEST_KEY;
    if (!key || key.length < 32)
      throw new ServiceUnavailableException('Daily note delivery is not configured');
    const header = context.switchToHttp().getRequest().headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 1024)
      throw new UnauthorizedException();
    const hash = (s: string) => createHash('sha256').update(s).digest();
    if (!timingSafeEqual(hash(header.slice(7)), hash(key))) throw new UnauthorizedException();
    return true;
  }
}
