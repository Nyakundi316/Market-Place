import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PrismaInstrumentation } from '@prisma/instrumentation';

/**
 * Just the libraries we use, instead of the 40-odd in the auto bundle:
 * inbound/outbound HTTP (incl. gateway calls), Express routing, Nest handlers,
 * Redis (cache, rate limits, BullMQ) and Prisma queries.
 */
export const instrumentations = () => [
  new HttpInstrumentation({
    // Health checks every few seconds would drown everything else.
    ignoreIncomingRequestHook: (req) => req.url === '/health',
  }),
  new ExpressInstrumentation(),
  new NestInstrumentation(),
  new IORedisInstrumentation(),
  new PrismaInstrumentation(),
];
