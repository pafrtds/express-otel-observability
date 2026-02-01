import Transport from 'winston-transport'
import { LEVEL, MESSAGE } from 'triple-beam'

import { getTraceContextInfo } from '../tracing/trace-context'
import { emitOtelLog, isOtelLoggerAvailable } from './otel-logger'
import { DEFAULT_SENSITIVE_FIELDS } from '../constants'

export interface WinstonOtelTransportOptions
  extends Transport.TransportStreamOptions {
  /**
   * Service name for telemetry
   */
  serviceName?: string

  /**
   * Environment name
   */
  environment?: string

  /**
   * Sensitive fields to mask in logs
   */
  sensitiveFields?: string[]

  /**
   * Enable OTLP export
   * @default true
   */
  enableOtlp?: boolean

  /**
   * Enable console output (structured JSON in production, formatted in development)
   * @default true
   */
  enableConsole?: boolean
}

/**
 * Winston Transport that integrates with OpenTelemetry
 *
 * Features:
 * - Automatically enriches logs with trace_id and span_id
 * - Exports logs to OTLP (OpenTelemetry Collector)
 * - Masks sensitive data
 * - Outputs structured JSON in production
 *
 * @example
 * ```typescript
 * import { createLogger, format } from 'winston'
 * import { WinstonOtelTransport } from '@anfitriao/express-otel-observability'
 *
 * export const logger = createLogger({
 *   level: 'info',
 *   format: format.combine(
 *     format.timestamp(),
 *     format.errors({ stack: true }),
 *   ),
 *   transports: [
 *     new WinstonOtelTransport({
 *       serviceName: 'my-service',
 *       environment: 'production',
 *     }),
 *   ],
 * })
 * ```
 */
export class WinstonOtelTransport extends Transport {
  private readonly serviceName: string

  private readonly environment: string

  private readonly sensitiveFields: string[]

  private readonly enableOtlp: boolean

  private readonly enableConsole: boolean

  constructor(opts: WinstonOtelTransportOptions = {}) {
    super(opts)

    this.serviceName =
      opts.serviceName || process.env.SERVICE_NAME || 'unknown-service'
    this.environment =
      opts.environment || process.env.NODE_ENV || 'development'
    this.sensitiveFields = opts.sensitiveFields || DEFAULT_SENSITIVE_FIELDS
    this.enableOtlp =
      opts.enableOtlp ?? process.env.OTEL_LOGS_ENABLED !== 'false'
    this.enableConsole =
      opts.enableConsole ?? process.env.OTEL_CONSOLE_LOGS_ENABLED !== 'false'
  }

  log(
    info: { level: string; message: string; [key: string | symbol]: unknown },
    callback: () => void,
  ): void {
    setImmediate(() => this.emit('logged', info))

    // Extract log info
    const level = (info[LEVEL] as string) || info.level || 'info'
    const message =
      typeof info[MESSAGE] === 'string'
        ? info[MESSAGE]
        : (info.message as string) || ''

    // Get trace context
    const traceContext = getTraceContextInfo()

    // Build structured log entry
    const logEntry: Record<string, unknown> = {
      timestamp: info.timestamp || new Date().toISOString(),
      level,
      message: this.extractMessage(message, info),
      service: this.serviceName,
      environment: this.environment,
    }

    // Add trace context if available
    if (traceContext.traceId) {
      logEntry.trace_id = traceContext.traceId
    }

    if (traceContext.spanId) {
      logEntry.span_id = traceContext.spanId
    }

    // Add additional metadata (excluding internal Winston fields)
    const meta = this.extractMeta(info)
    if (Object.keys(meta).length > 0) {
      const maskedMeta = this.maskSensitiveData(meta)
      Object.assign(logEntry, maskedMeta)
    }

    // Send to OTLP if enabled
    if (this.enableOtlp && isOtelLoggerAvailable()) {
      this.sendToOtlp(level, logEntry)
    }

    // Output to console if enabled
    if (this.enableConsole) {
      this.outputToConsole(level, logEntry)
    }

    callback()
  }

  /**
   * Extract the actual message from Winston info
   */
  private extractMessage(
    message: string,
    info: Record<string, unknown>,
  ): string {
    // Winston sometimes wraps the message
    if (message && !message.includes('[object Object]')) {
      return message
    }

    // Fallback to info.message
    if (typeof info.message === 'string') {
      return info.message
    }

    return 'No message'
  }

  /**
   * Extract metadata from Winston info (excluding internal fields)
   */
  private extractMeta(
    info: Record<string | symbol, unknown>,
  ): Record<string, unknown> {
    const internalStringFields = ['level', 'message', 'timestamp', 'splat']
    const internalSymbolFields = [LEVEL, MESSAGE, Symbol.for('splat')]

    const meta: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(info)) {
      if (typeof key === 'string' && !internalStringFields.includes(key)) {
        meta[key] = value
      }
    }

    // Remove symbol keys from result (they won't appear in Object.entries anyway)
    // But ensure we don't include them if they somehow appear
    for (const sym of internalSymbolFields) {
      if (sym in info) {
        // Symbol keys are not iterable via Object.entries, so this is just for safety
      }
    }

    return meta
  }

  /**
   * Send log to OTLP
   */
  private sendToOtlp(level: string, entry: Record<string, unknown>): void {
    const otelLevel = this.mapToOtelLevel(level)

    emitOtelLog(otelLevel, entry.message as string, {
      ...entry,
      // Remove fields that are already part of the log record
      timestamp: undefined,
      level: undefined,
      message: undefined,
    })
  }

  /**
   * Output to console
   */
  private outputToConsole(level: string, entry: Record<string, unknown>): void {
    if (this.environment === 'development') {
      // Formatted output for development
      const { timestamp, level: logLevel, message, trace_id, ...rest } = entry

      const traceStr = trace_id
        ? ` (trace: ${String(trace_id).substring(0, 8)}...)`
        : ''
      const metaStr =
        Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''

      const formattedMessage = `${timestamp} ${String(logLevel).toUpperCase().padEnd(5)} ${message}${traceStr}${metaStr}`

      this.consoleLog(level, formattedMessage)
    } else {
      // Structured JSON for production (Loki compatible)
      const output = JSON.stringify(entry)
      this.consoleLog(level, output)
    }
  }

  /**
   * Log to console with appropriate method
   */
  private consoleLog(level: string, message: string): void {
    switch (level) {
      case 'error':
        console.error(message)
        break
      case 'warn':
      case 'warning':
        console.warn(message)
        break
      case 'debug':
        console.debug(message)
        break
      default:
        console.log(message)
    }
  }

  /**
   * Map Winston level to OTLP level
   */
  private mapToOtelLevel(level: string): 'debug' | 'info' | 'warn' | 'error' {
    switch (level.toLowerCase()) {
      case 'error':
      case 'crit':
      case 'alert':
      case 'emerg':
        return 'error'
      case 'warn':
      case 'warning':
        return 'warn'
      case 'debug':
      case 'silly':
      case 'verbose':
        return 'debug'
      default:
        return 'info'
    }
  }

  /**
   * Mask sensitive data in objects
   */
  private maskSensitiveData(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const masked: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase()

      // Check if it's a sensitive field
      const isSensitive = this.sensitiveFields.some(field =>
        lowerKey.includes(field.toLowerCase()),
      )

      if (isSensitive) {
        masked[key] = '[REDACTED]'
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively mask nested objects
        masked[key] = this.maskSensitiveData(value as Record<string, unknown>)
      } else if (Array.isArray(value)) {
        // Mask arrays of objects
        masked[key] = value.map(item =>
          typeof item === 'object' && item !== null
            ? this.maskSensitiveData(item as Record<string, unknown>)
            : item,
        )
      } else {
        masked[key] = value
      }
    }

    return masked
  }
}

/**
 * Create a Winston logger with OTLP transport
 *
 * This is a convenience function to create a logger with the OTLP transport
 * pre-configured.
 *
 * @example
 * ```typescript
 * import { createWinstonLogger } from '@anfitriao/express-otel-observability'
 *
 * export const logger = createWinstonLogger({
 *   serviceName: 'my-service',
 *   level: 'info',
 * })
 * ```
 */
export function createWinstonLogger(
  options: WinstonOtelTransportOptions & { level?: string },
): ReturnType<typeof import('winston').createLogger> {
  // Dynamically import winston to avoid hard dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const winston = require('winston')

  return winston.createLogger({
    level: options.level || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
    ),
    transports: [new WinstonOtelTransport(options)],
  })
}
