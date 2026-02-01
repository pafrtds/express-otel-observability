/**
 * Tracing Bootstrap Example
 *
 * This file should be imported as the FIRST import in your server.ts
 * to ensure OpenTelemetry is initialized before any other modules.
 *
 * Usage:
 * 1. Copy this file to your project's src/ directory
 * 2. Adjust the configuration as needed
 * 3. Import it at the very top of your server.ts
 *
 * @example
 * // server.ts
 * import './tracing.bootstrap' // MUST be first!
 * import http from 'http'
 * import { app } from './app'
 */

import { initObservability } from '@anfitriao/express-otel-observability'

initObservability({
  serviceName: process.env.SERVICE_NAME || 'my-express-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',

  // OTLP endpoints (defaults to local collector)
  otlpTraceEndpoint:
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    'http://localhost:4318/v1/traces',
  otlpMetricsEndpoint:
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    'http://localhost:4318/v1/metrics',
  otlpLogsEndpoint:
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    'http://localhost:4318/v1/logs',

  // Feature toggles
  enableMetrics: process.env.OTEL_METRICS_ENABLED !== 'false',
  enableOtlpLogs: process.env.OTEL_LOGS_ENABLED !== 'false',
  enableConsoleLogs: process.env.OTEL_CONSOLE_LOGS_ENABLED !== 'false',

  // Metrics export interval (milliseconds)
  metricsExportIntervalMs:
    Number(process.env.OTEL_METRICS_EXPORT_INTERVAL_MS) || 15000,

  // Debug mode (verbose OpenTelemetry logging)
  debug: process.env.OTEL_DEBUG === 'true',

  // Log level
  logLevel:
    (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
})
