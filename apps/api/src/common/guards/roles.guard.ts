import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@markethub/shared';
import type { Request } from 'express';
import { ROLES, VERIFIED } from '../decorators/roles.decorator';

/** Roles + Verified in one pass; both read req.user set by JwtAuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    const needsVerified = this.reflector.getAllAndOverride<boolean | undefined>(VERIFIED, targets);
    if (!roles?.length && !needsVerified) return true;

    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) throw new ForbiddenException(); // @Roles on a @Public route is a programming error

    if (roles?.length) {
      const effective: UserRole[] =
        user.role === 'both' ? ['both', 'buyer', 'seller'] : [user.role];
      if (!roles.some((r) => effective.includes(r)))
        throw new ForbiddenException('Insufficient role');
    }
    if (needsVerified && !user.isEmailVerified) {
      throw new ForbiddenException('Verify your email address first');
    }
    return true;
  }
}
