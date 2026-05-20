/**
 * OpenTelemetry SDK bootstrap for remi-backend.
 *
 * IMPORTANT: This module must be imported BEFORE all other modules in index.ts
 * so that auto-instrumentation patches Express and http before they are loaded.
 *
 * Reads configuration from environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP HTTP base URL (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            — service name reported in traces (default: remi-backend)
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { resourceFromAttributes } from '@opentelemetry/resources';

const _base = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(/\/$/, '');
// Normalise: accept both base URL and full URL with /v1/traces already appended.
const endpoint = _base.endsWith('/v1/traces') ? _base : `${_base}/v1/traces`;

const exporter = new OTLPTraceExporter({ url: endpoint });

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME ?? 'remi-backend',
  }),
  traceExporter: exporter,
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
});

sdk.start();

export async function shutdownTelemetry(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch (err: unknown) {
    console.error('OTel SDK shutdown error', err);
  }
}
