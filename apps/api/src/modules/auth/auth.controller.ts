import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type AuthResponseDto,
  type Env,
  type ForgotPasswordInput,
  forgotPasswordSchema,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
  type VerifyEmailInput,
  verifyEmailSchema,
} from '@markethub/shared';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { InjectEnv } from '../../config/env.validation';
import { AccountLinksService } from './account-links.service';
import { AuthService, type Session } from './auth.service';
import {
  assertCsrf,
  clearSessionCookies,
  readRefreshCookie,
  setSessionCookies,
} from './session-cookies';
import { type SessionMeta, TokenService } from './token.service';

const metaOf = (req: Request): SessionMeta => ({
  userAgent: req.header('user-agent'),
  ipAddress: req.ip,
});

@Public()
@RateLimit('auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly links: AccountLinksService,
    @InjectEnv() env: Env,
  ) {
    this.secureCookies = env.NODE_ENV === 'production';
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput) {
    await this.links.verifyEmail(body.token);
    return { verified: true };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
  ) {
    await this.links.requestPasswordReset(body.email);
    return { message: 'If that email has an account, a reset link is on its way.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: Request,
  ) {
    await this.links.resetPassword(body.token, body.password, req.ip);
  }

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.register(body, metaOf(req)));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body, metaOf(req)));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrf(req);
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('No session');
    try {
      return this.respond(res, await this.auth.refresh(token, metaOf(req)));
    } catch (err) {
      clearSessionCookies(res, this.secureCookies);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrf(req);
    await this.auth.logout(readRefreshCookie(req));
    clearSessionCookies(res, this.secureCookies);
  }

  private respond(res: Response, session: Session): AuthResponseDto {
    setSessionCookies(res, session.refreshToken, this.tokens.refreshTtl, this.secureCookies);
    return {
      accessToken: session.accessToken,
      accessTokenExpiresIn: session.accessTokenExpiresIn,
      user: session.user,
    };
  }
}
