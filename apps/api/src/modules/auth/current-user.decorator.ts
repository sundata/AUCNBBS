import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessTokenPayload } from './auth.service';
import type { AuthenticatedRequest } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload | undefined => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
