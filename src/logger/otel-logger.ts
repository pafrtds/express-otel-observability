import { logs, Logger, SeverityNumber } from '@opentelemetry/api-logs'
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
  ConsoleLogRecordExporter,
} from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { Resource } from '@opentelemetry/resources'

export interface OtelLoggerOptions {
  serviceName: string
  serviceVersion?: string
  environment?: string
  otlpLogsEndpoint?: string
  enableOtlpLogs?: boolean
  enableConsoleLogs?: boolean
}

let loggerProvider: LoggerProvider | null = null
let otelLogger: Logger | null = null
let isOtlpAvailable = true

/**
 * Maps log levels to OpenTelemetry SeverityNumber
 */
export const LOG_SEVERITY_MAP: Record<string, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
}

/**
 * Initialize the OpenTelemetry LoggerProvider
 *
 * Features:
 * - OTLP support for sending to Collector
 * - Console fallback for development
 * - Resilience: won't crash the app if Collector is offline
 */
export function initOtelLogger(
  resource: Resource,
  options: OtelLoggerOptions,
): Logger | null {
  const {
    otlpLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
      'http://localhost:4318/v1/logs',
    enableOtlpLogs = true,
    enableConsoleLogs = true,
  } = options

  try {
    // Build processors array
    const processors: (SimpleLogRecordProcessor | BatchLogRecordProcessor)[] =
      []

    // Add console processor if enabled (development)
    if (enableConsoleLogs) {
      processors.push(
        new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()),
      )
    }

    // Add OTLP processor if enabled (production)
    if (enableOtlpLogs) {
      const otlpExporter = new OTLPLogExporter({
        url: otlpLogsEndpoint,
        // Short timeout to not block the application
        timeoutMillis: 5000,
      })

      // Use BatchLogRecordProcessor with resilience settings
      processors.push(
        new BatchLogRecordProcessor(otlpExporter, {
          maxQueueSize: 2048,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 5000,
          exportTimeoutMillis: 30000,
        }),
      )
    }

    // Create LoggerProvider with processors
    loggerProvider = new LoggerProvider({
      resource,
      processors,
    })

    // Register globally
    logs.setGlobalLoggerProvider(loggerProvider)

    // Create logger
    otelLogger = logs.getLogger('app-logger')

    console.log(
      `[Observability] OTLP Logger initialized (otlp: ${enableOtlpLogs}, console: ${enableConsoleLogs})`,
    )

    return otelLogger
  } catch (error) {
    console.error('[Observability] Failed to initialize OTLP Logger:', error)
    isOtlpAvailable = false
    return null
  }
}

/**
 * Get the global OTLP logger
 */
export function getOtelLogger(): Logger | null {
  return otelLogger
}

/**
 * Check if OTLP is available
 */
export function isOtelLoggerAvailable(): boolean {
  return isOtlpAvailable && otelLogger !== null
}

/**
 * Mark OTLP as unavailable (used in case of export errors)
 */
export function markOtlpUnavailable(): void {
  isOtlpAvailable = false
}

/**
 * Attempt to reconnect to OTLP
 */
export function markOtlpAvailable(): void {
  isOtlpAvailable = true
}

/**
 * Shutdown the LoggerProvider safely
 */
export async function shutdownOtelLogger(): Promise<void> {
  if (loggerProvider) {
    try {
      await loggerProvider.shutdown()
    } catch (error) {
      console.error(
        '[Observability] Error shutting down LoggerProvider:',
        error,
      )
    }
    loggerProvider = null
    otelLogger = null
  }
}

/**
 * Emit a log via OpenTelemetry safely
 *
 * @param level - Log level
 * @param message - Message
 * @param attributes - Additional attributes
 */
export function emitOtelLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  attributes: Record<string, unknown> = {},
): boolean {
  if (!otelLogger || !isOtlpAvailable) {
    return false
  }

  try {
    otelLogger.emit({
      severityNumber: LOG_SEVERITY_MAP[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: sanitizeAttributes(attributes),
    })
    return true
  } catch (error) {
    // In case of error, don't crash the application
    // Just mark as temporarily unavailable
    console.error('[Observability] Error emitting OTLP log:', error)
    return false
  }
}

/**
 * Sanitize attributes for OpenTelemetry
 * OTLP only accepts primitive types as attribute values
 */
function sanitizeAttributes(
  obj: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = value
    } else if (typeof value === 'object') {
      // Convert objects to JSON string
      try {
        result[key] = JSON.stringify(value)
      } catch {
        result[key] = '[SERIALIZATION_ERROR]'
      }
    } else {
      result[key] = String(value)
    }
  }

  return result
}
