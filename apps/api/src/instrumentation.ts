/**
 * Observability bootstrap (§10 Phase 7). Imported first in main.ts, before
 * Nest, Express, Prisma or ioredis load, because OpenTelemetry instruments by
 * patching modules as they're required. Reads process.env directly: the zod
 * env validation runs later, and both pieces are optional.
 *
 *  - Traces: OpenTelemetry over OTLP/HTTP, only when OTEL_EXPORTER_OTLP_ENDPOINT
 *    is set (Honeycomb, Grafana Tempo, Jaeger… any OTLP collector).
 *  - Errors: Sentry, only when SENTRY_DSN is set. It doesn't register a tracer
 *    provider of its own, so it never competes with ours.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import * as Sentry from '@sentry/node';
import { instrumentations } from './observability/instrumentations';
import { SENTRY_DATA_COLLECTION } from './observability/sentry-privacy';

const env = process.env;

const tracing = env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME ?? 'markethub-api',
      traceExporter: new OTLPTraceExporter(), // endpoint + headers from OTEL_EXPORTER_OTLP_*
      instrumentations: instrumentations(),
    })
  : null;
tracing?.start();

export const sentryEnabled = Boolean(env.SENTRY_DSN);
if (sentryEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.GIT_SHA,
    enableOpenTelemetrySetup: false, // our NodeSDK owns tracing
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}

/** Flush on shutdown so the last spans and errors before a deploy aren't lost. */
export async function shutdownTelemetry() {
  await tracing?.shutdown().catch(() => undefined);
  if (sentryEnabled) await Sentry.flush(2000);
}
