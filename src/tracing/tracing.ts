import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  resourceFromAttributes,
  defaultResource,
  Resource,
} from '@opentelemetry/resources'
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'

import { initOtelLogger, shutdownOtelLogger } from '../logger/otel-logger'
import { DEFAULT_METRICS_EXPORT_INTERVAL_MS } from '../constants'
import { ObservabilityOptions } from '../types'

let sdk: NodeSDK | null = null

/**
 * Initialize the OpenTelemetry SDK
 *
 * IMPORTANT: This MUST be called BEFORE any imports of modules that will be instrumented.
 * Typically, this should be the first thing in your server.ts file.
 *
 * @example
 * ```typescript
 * // At the very beginning of server.ts, BEFORE any other imports
 * import { initTracing } from '@anfitriao/express-otel-observability'
 *
 * initTracing({
 *   serviceName: 'my-express-service',
 *   serviceVersion: '1.0.0',
 *   environment: 'production',
 * })
 *
 * // After that, import the rest
 * import express from 'express'
 * ```
 */
export function initTracing(options: ObservabilityOptions): NodeSDK {
  const {
    serviceName,
    serviceVersion = '1.0.0',
    environment = 'development',
    otlpTraceEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
      'http://localhost:4318/v1/traces',
    otlpMetricsEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
      'http://localhost:4318/v1/metrics',
    otlpLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
      'http://localhost:4318/v1/logs',
    enableMetrics = true,
    enableOtlpLogs = process.env.OTEL_LOGS_ENABLED !== 'false',
    enableConsoleLogs = process.env.OTEL_CONSOLE_LOGS_ENABLED !== 'false',
    metricsExportIntervalMs = DEFAULT_METRICS_EXPORT_INTERVAL_MS,
    debug = false,
  } = options

  // Enable diagnostic logging if debug is active
  if (debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
  }

  // Create resource with service attributes
  const resource = defaultResource().merge(
    resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
    }),
  )

  // Initialize OTLP Logger (with resilience - won't crash the app if it fails)
  try {
    initOtelLogger(resource as Resource, {
      serviceName,
      serviceVersion,
      environment,
      otlpLogsEndpoint,
      enableOtlpLogs,
      enableConsoleLogs,
    })
  } catch (error) {
    console.warn(
      '[Observability] OTLP Logger not initialized, using console only:',
      error,
    )
  }

  // Configure trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: otlpTraceEndpoint,
  })

  // Configure span processor
  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  })

  // Prepare SDK configuration
  const sdkConfig: ConstructorParameters<typeof NodeSDK>[0] = {
    resource,
    spanProcessor,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable unnecessary instrumentations
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Enable and configure useful instrumentations
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          ignoreIncomingRequestHook: request => {
            const ignoredPaths = ['/health', '/healthz', '/ready', '/metrics']
            return ignoredPaths.some(path => request.url?.startsWith(path))
          },
        },
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
      }),
    ],
  }

  // Add metrics if enabled
  if (enableMetrics) {
    const metricExporter = new OTLPMetricExporter({
      url: otlpMetricsEndpoint,
    })

    sdkConfig.metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: metricsExportIntervalMs,
    })
  }

  // Create and start SDK
  sdk = new NodeSDK(sdkConfig)
  sdk.start()

  // Register graceful shutdown
  const shutdownHandler = async () => {
    try {
      // Shutdown logger first to ensure all logs are sent
      await shutdownOtelLogger()

      // Then shutdown the SDK
      await sdk?.shutdown()

      console.log('[Observability] OpenTelemetry SDK shutdown successfully')
    } catch (error) {
      console.error(
        '[Observability] Error shutting down OpenTelemetry SDK:',
        error,
      )
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGTERM', shutdownHandler)
  process.on('SIGINT', shutdownHandler)

  console.log(
    `[Observability] OpenTelemetry initialized for ${serviceName} (${environment})`,
  )

  return sdk
}

/**
 * Get the SDK instance
 */
export function getTracingSdk(): NodeSDK | null {
  return sdk
}

/**
 * Shutdown the SDK safely
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await shutdownOtelLogger()
    await sdk.shutdown()
    sdk = null
  }
}
