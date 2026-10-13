import type { INestApplication } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ChatIoAdapter } from './modules/chat/chat-io.adapter';

export function configureApp(app: INestApplication, env: Env) {
  app.useLogger(app.get(Logger));
  app.use(
    helmet({
      // §7: HSTS only makes sense over https; dev runs on plain http.
      hsts:
        env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
          : false,
    }),
  );
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_URL, credentials: true }); // §9: web origin only
  app.useWebSocketAdapter(new ChatIoAdapter(app, env));
  app.enableShutdownHooks();
  return app;
}
