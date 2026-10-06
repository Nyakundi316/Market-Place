import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env.validation';

async function main() {
  const env = loadEnv(); // throws on bad env before anything listens
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  if (env.NODE_ENV === 'production') app.getHttpAdapter().getInstance().set('trust proxy', 1);
  configureApp(app, env);
  await app.listen(env.PORT);
}

void main();
