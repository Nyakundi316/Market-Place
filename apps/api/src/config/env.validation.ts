import { Global, Inject, Module } from '@nestjs/common';
import { parseEnv, type Env } from '@markethub/shared';

export const ENV = Symbol('ENV');

/** Inject the validated env: `constructor(@InjectEnv() private env: Env)` */
export const InjectEnv = () => Inject(ENV);

// Parsed once at import time so a bad .env kills the process before Nest boots (§0).
let cached: Env | undefined;
export function loadEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadEnv }],
  exports: [ENV],
})
export class EnvModule {}
