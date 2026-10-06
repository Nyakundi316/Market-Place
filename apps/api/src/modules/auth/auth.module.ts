import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '@markethub/shared';
import { ENV } from '../../config/env.validation';
import { AccountLinksService } from './account-links.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  GitHubClient,
  GoogleClient,
  OAUTH_CLIENTS,
  type OAuthClients,
} from './oauth/oauth-clients';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { TokenService } from './token.service';

// Callback goes through the web app's /api proxy so session cookies are first-party.
const callbackUrl = (env: Env, provider: string) =>
  `${env.WEB_URL}/api/auth/oauth/${provider}/callback`;

@Module({
  imports: [JwtModule.register({})], // secrets passed per call from validated env
  controllers: [AuthController, OAuthController],
  providers: [
    AuthService,
    TokenService,
    AccountLinksService,
    OAuthService,
    {
      provide: OAUTH_CLIENTS,
      inject: [ENV],
      // A provider is enabled only when both its id and secret are set (env schema enforces pairs).
      useFactory: (env: Env): OAuthClients => ({
        ...(env.GOOGLE_CLIENT_ID &&
          env.GOOGLE_CLIENT_SECRET && {
            google: new GoogleClient({
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              redirectUri: callbackUrl(env, 'google'),
            }),
          }),
        ...(env.GITHUB_CLIENT_ID &&
          env.GITHUB_CLIENT_SECRET && {
            github: new GitHubClient({
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
              redirectUri: callbackUrl(env, 'github'),
            }),
          }),
      }),
    },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
