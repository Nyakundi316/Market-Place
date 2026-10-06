import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpException, Logger, Param, Query, Req, Res } from '@nestjs/common';
import { type Env, type OAuthProvider, oauthProviderSchema } from '@markethub/shared';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../../common/rate-limit/rate-limit.guard';
import { InjectEnv } from '../../../config/env.validation';
import { setSessionCookies } from '../session-cookies';
import { TokenService } from '../token.service';
import { OAuthService } from './oauth.service';

const STATE_COOKIE = 'mh_oauth';
const providerPipe = new ZodValidationPipe(oauthProviderSchema);

const sameString = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

@Public()
@RateLimit('auth')
@Controller('auth/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);
  private readonly secure: boolean;

  constructor(
    private readonly oauth: OAuthService,
    private readonly tokens: TokenService,
    @InjectEnv() private readonly env: Env,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  @Get(':provider')
  start(@Param('provider', providerPipe) provider: OAuthProvider, @Res() res: Response) {
    const client = this.oauth.client(provider);
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');

    // Lax, not Strict: it must ride along on the provider's cross-site redirect back.
    res.cookie(STATE_COOKIE, `${provider}.${state}.${verifier}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secure,
      path: '/',
      maxAge: 10 * 60_000,
    });
    res.redirect(302, client.authorizationUrl(state, verifier).toString());
  }

  /** Always ends in a redirect to the web app — the user arrives here by browser navigation. */
  @Get(':provider/callback')
  async callback(
    @Param('provider', providerPipe) provider: OAuthProvider,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const client = this.oauth.client(provider);
    const cookie: unknown = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secure,
      path: '/',
    });

    const [cookieProvider, expectedState, verifier] =
      typeof cookie === 'string' ? cookie.split('.') : [];
    const valid =
      typeof code === 'string' &&
      typeof state === 'string' &&
      cookieProvider === provider &&
      !!expectedState &&
      !!verifier &&
      sameString(state, expectedState);
    if (!valid) return this.fail(res, 'oauth_failed');

    try {
      const identity = await client.exchange(code, verifier);
      const session = await this.oauth.signIn(provider, identity, {
        userAgent: req.header('user-agent'),
        ipAddress: req.ip,
      });
      setSessionCookies(res, session.refreshToken, this.tokens.refreshTtl, this.secure);
      // The web app exchanges the cookie for an access token via /auth/refresh.
      const next = session.user.hasProfile ? '/feed' : '/onboarding';
      res.redirect(302, `${this.env.WEB_URL}/auth/callback?next=${encodeURIComponent(next)}`);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 403)
        return this.fail(res, 'account_suspended');
      if (err instanceof HttpException && err.getStatus() === 400)
        return this.fail(res, 'oauth_no_verified_email');
      this.logger.error({ err, provider }, 'OAuth callback failed');
      return this.fail(res, 'oauth_failed');
    }
  }

  private fail(res: Response, reason: string) {
    res.redirect(302, `${this.env.WEB_URL}/login?error=${reason}`);
  }
}
