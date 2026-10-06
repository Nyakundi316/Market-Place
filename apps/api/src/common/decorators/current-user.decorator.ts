import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@markethub/shared';

/** Set on req.user by JwtAuthGuard — loaded from the DB, not trusted from the token. */
export interface RequestUser {
  id: string;
  role: UserRole;
  isEmailVerified: boolean;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestUser => ctx.switchToHttp().getRequest().user,
);
