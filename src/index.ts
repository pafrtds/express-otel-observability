// =============================================================================
// Express OpenTelemetry Observability Module
// =============================================================================

// Types and Constants
export {
  ObservabilityOptions,
  CustomSemanticAttributes,
  ErrorType,
  StructuredLogEntry,
} from './types'

export {
  DEFAULT_SENSITIVE_FIELDS,
  DEFAULT_MAX_BODY_LOG_SIZE,
  DEFAULT_METRICS_EXPORT_INTERVAL_MS,
  DISABLED_INSTRUMENTATIONS,
} from './constants'

// Tracing
export {
  initTracing,
  getTracingSdk,
  shutdownTracing,
} from './tracing/tracing'

export {
  getTraceContextInfo,
  getCurrentSpan,
  getCurrentSpanContext,
  getCurrentTraceId,
  getCurrentSpanId,
  hasActiveTrace,
  TraceContextInfo,
} from './tracing/trace-context'

// Logger
export {
  StructuredLogger,
  createLogger,
  logger,
  initStructuredLogger,
} from './logger/structured-logger'

export {
  initOtelLogger,
  getOtelLogger,
  isOtelLoggerAvailable,
  markOtlpUnavailable,
  markOtlpAvailable,
  shutdownOtelLogger,
  emitOtelLog,
  LOG_SEVERITY_MAP,
  OtelLoggerOptions,
} from './logger/otel-logger'

export {
  WinstonOtelTransport,
  WinstonOtelTransportOptions,
  createWinstonLogger,
} from './logger/winston-otel-transport'

// Metrics
export { MetricsService, initMetrics, getMetrics } from './metrics/metrics'

// Middlewares
export { httpMetricsMiddleware } from './middlewares/http-metrics'

export { observabilityErrorMiddleware } from './middlewares/error-handler'

// Interceptors
export {
  initRabbitMQInterceptor,
  wrapConsumer,
  injectRabbitMQContext,
  extractRabbitMQContext,
  restoreRabbitMQ,
  ConsumeMessage,
} from './interceptors/rabbitmq-interceptor'

export {
  initSocketIOInterceptor,
  wrapSocketHandler,
  injectTraceContext,
} from './interceptors/socketio-interceptor'

// =============================================================================
// Quick Setup Function
// =============================================================================

import { initTracing } from './tracing/tracing'
import { initStructuredLogger } from './logger/structured-logger'
import { initMetrics } from './metrics/metrics'
import { ObservabilityOptions } from './types'

// Store options globally for later use by interceptors
let globalObservabilityOptions: ObservabilityOptions | null = null

/**
 * Get the global observability options
 */
export function getObservabilityOptions(): ObservabilityOptions | null {
  return globalObservabilityOptions
}

/**
 * Initialize all observability components at once
 *
 * This is a convenience function that initializes:
 * - OpenTelemetry SDK (tracing + metrics)
 * - OTLP Logger
 * - Structured Logger
 * - Metrics Service
 *
 * Note: RabbitMQ and Socket.IO interceptors must be initialized separately
 * because they require the class/server instances.
 *
 * @example
 * ```typescript
 * // At the very beginning of your server.ts, BEFORE other imports
 * import { initObservability } from '@anfitriao/express-otel-observability'
 *
 * initObservability({
 *   serviceName: 'my-express-service',
 *   serviceVersion: '1.0.0',
 *   environment: process.env.NODE_ENV,
 * })
 *
 * // Then import everything else
 * import express from 'express'
 * import { Server } from 'socket.io'
 * import { RabbitMQ } from './queue/rabbitmq'
 * import { initRabbitMQInterceptor, initSocketIOInterceptor } from '@anfitriao/express-otel-observability'
 *
 * // Initialize RabbitMQ interceptor
 * initRabbitMQInterceptor(RabbitMQ, { serviceName: 'my-express-service' })
 *
 * // Initialize Socket.IO interceptor
 * const io = new Server(httpServer)
 * initSocketIOInterceptor(io, { serviceName: 'my-express-service' })
 * ```
 */
export function initObservability(options: ObservabilityOptions): void {
  // Store options globally
  globalObservabilityOptions = options

  // Initialize tracing (includes OTLP logger)
  initTracing(options)

  // Initialize structured logger
  initStructuredLogger(options)

  // Initialize metrics
  initMetrics(options)

  console.log(
    `[Observability] All components initialized for ${options.serviceName}`,
  )
}
