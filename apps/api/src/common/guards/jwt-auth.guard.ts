import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../../modules/auth/token.service';
import { PrismaService } from '../../prisma/prisma.module';
import { IS_PUBLIC } from '../decorators/public.decorator';

/**
 * Global (§0: JWT on every request). Verifies the bearer token, then loads the
 * user so bans and role changes apply immediately instead of after token expiry.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // sockets authenticate in the gateway (§5)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<Request>();
    if (isPublic) {
      // Public reads still personalise (isFavorited, isOwner) when a valid token comes along.
      await this.authenticate(req).catch(() => undefined);
      return true;
    }
    await this.authenticate(req);
    return true;
  }

  private async authenticate(req: Request) {
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    const { sub } = this.tokens.verifyAccess(token);
    const user = await this.db.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true, isEmailVerified: true, isBanned: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid or expired token');
    if (user.isBanned) throw new ForbiddenException('This account has been suspended');

    req.user = { id: user.id, role: user.role, isEmailVerified: user.isEmailVerified };
  }
}
