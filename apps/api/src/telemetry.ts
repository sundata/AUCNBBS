import { Logger } from '@nestjs/common';

/**
 * Optional OpenTelemetry bootstrap (N-19).
 * Activated only when OTEL_ENABLED=true; otherwise this is a no-op so local
 * dev and tests never pay the instrumentation cost.
 */
export async function startTelemetry(): Promise<void> {
  if (process.env.OTEL_ENABLED !== 'true') return;
  const logger = new Logger('Telemetry');
  try {
    const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }] = await Promise.all(
      [
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/auto-instrumentations-node'),
        import('@opentelemetry/exporter-trace-otlp-http'),
      ],
    );
    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'aucn-api',
      traceExporter: new OTLPTraceExporter({
        url:
          process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
          `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/traces`,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
    process.on('SIGTERM', () => void sdk.shutdown());
    logger.log('OpenTelemetry tracing enabled');
  } catch (error) {
    logger.error(
      'OTEL_ENABLED=true but the SDK failed to start; continuing without tracing',
      error,
    );
  }
}
