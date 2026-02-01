import { Request, Response, NextFunction } from 'express'
import {
  trace,
  SpanStatusCode,
  context as otelContext,
} from '@opentelemetry/api'
import { StructuredLogger } from '../logger/structured-logger'
import { getMetrics } from '../metrics/metrics'
import { ErrorType } from '../types'

const logger = new StructuredLogger('ErrorHandler')

/**
 * Check if error is an Axios error
 */
function isAxiosError(
  error: unknown,
): error is {
  isAxiosError: boolean
  response?: { status?: number }
  code?: string
} {
  return !!(
    error &&
    typeof error === 'object' &&
    'isAxiosError' in error &&
    error.isAxiosError
  )
}

/**
 * Check if error is a Prisma known error
 */
function isPrismaKnownRequestError(error: unknown): boolean {
  return !!(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'clientVersion' in error &&
    'name' in error &&
    (error as { name: string }).name === 'PrismaClientKnownRequestError'
  )
}

/**
 * Classify error type
 */
function classifyError(error: unknown): ErrorType {
  if (isAxiosError(error)) {
    return ErrorType.AXIOS
  }

  if (isPrismaKnownRequestError(error)) {
    return ErrorType.PRISMA_KNOWN
  }

  return ErrorType.GENERIC
}

/**
 * Express error handling middleware with observability
 *
 * Captures errors and records:
 * - Structured logs with trace context
 * - Span exceptions in OpenTelemetry
 * - Error metrics
 *
 * @example
 * ```typescript
 * import express from 'express'
 * import { observabilityErrorMiddleware } from '@anfitriao/express-otel-observability'
 *
 * const app = express()
 *
 * app.get('/users', (req, res) => { ... })
 *
 * // Add AFTER routes
 * app.use(observabilityErrorMiddleware)
 * ```
 */
export function observabilityErrorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): void {
  const errorType = classifyError(error)

  // Record on current span
  const span = trace.getSpan(otelContext.active())

  if (span) {
    span.recordException(error)
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    })
    span.setAttribute('error.type', errorType)
  }

  // Record error metric
  let errorCode: string | undefined

  if (isPrismaKnownRequestError(error)) {
    errorCode = (error as unknown as { code: string }).code
  } else if (isAxiosError(error)) {
    errorCode = String(error.response?.status || error.code || 'unknown')
  }

  getMetrics().recordError({
    type: errorType,
    context: 'http',
    code: errorCode,
  })

  // Log structured error
  logger.error(`Error in ${req.method} ${req.path}`, {
    error_type: errorType,
    error_name: error.name,
    error_message: error.message,
    stack_trace: error.stack,
    http: {
      method: req.method,
      url: req.url,
      path: req.path,
    },
  })

  // Determine status code
  const statusCode = (error as { status?: number }).status || 500

  // Send error response
  res.status(statusCode).json({
    error: {
      message: error.message,
      type: errorType,
    },
  })
}
