import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  Span,
} from '@opentelemetry/api'

import { CustomSemanticAttributes, ObservabilityOptions } from '../types'
import { getMetrics } from '../metrics/metrics'
import { StructuredLogger } from '../logger/structured-logger'

// Re-export types for users who want to use them
export type { Span }

const logger = new StructuredLogger('SocketIOInterceptor')

const tracer = trace.getTracer('socket.io')

let serviceName = 'unknown-service'

// Socket.IO types (to avoid hard dependency)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SocketIOServer = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Socket = any

/**
 * Initialize Socket.IO interceptor
 *
 * Wraps Socket.IO event handlers to automatically:
 * - Create spans for each event
 * - Extract/inject trace context
 * - Record metrics
 *
 * @example
 * ```typescript
 * import { Server } from 'socket.io'
 * import { initSocketIOInterceptor } from '@anfitriao/express-otel-observability'
 *
 * const io = new Server(httpServer)
 *
 * // Initialize interceptor
 * initSocketIOInterceptor(io, { serviceName: 'my-service' })
 *
 * // Now all events will be traced automatically
 * io.on('connection', (socket) => {
 *   socket.on('message', (data) => {
 *     // This will be traced!
 *   })
 * })
 * ```
 */
export function initSocketIOInterceptor(
  io: SocketIOServer,
  options?: ObservabilityOptions,
): void {
  serviceName =
    options?.serviceName || process.env.SERVICE_NAME || 'unknown-service'

  // Wrap the connection handler
  io.on('connection', (socket: Socket) => {
    wrapSocket(socket)
  })

  logger.info('Socket.IO interceptor initialized')
}

/**
 * Wrap a socket to intercept events
 */
function wrapSocket(socket: Socket): void {
  const originalOn = socket.on.bind(socket)

  // Override the on method to wrap handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket.on = function (event: string, handler: (...args: any[]) => void) {
    // Don't wrap internal events
    if (event.startsWith('$') || event === 'disconnect' || event === 'error') {
      return originalOn(event, handler)
    }

    // Wrap the handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrappedHandler = async (...args: any[]) => {
      const startTime = Date.now()

      // Try to extract trace context from payload
      const parentContext = extractTraceContext(socket, args)

      // Create span for event
      const span = tracer.startSpan(
        `ws.${event}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'messaging.system': 'socket.io',
            'messaging.operation.type': 'receive',
            [CustomSemanticAttributes.WS_EVENT_NAME]: event,
            [CustomSemanticAttributes.WS_CLIENT_ID]: socket.id,
            'service.name': serviceName,
            'network.transport': 'websocket',
            'client.address': socket.handshake?.address,
          },
        },
        parentContext,
      )

      const activeContext = trace.setSpan(parentContext, span)

      try {
        // Execute handler within span context
        await context.with(activeContext, async () => {
          await handler(...args)
        })

        span.setStatus({ code: SpanStatusCode.OK })

        // Record success metric
        getMetrics().recordWsEvent({
          event,
          success: true,
          durationMs: Date.now() - startTime,
        })
      } catch (error) {
        // Record error on span
        if (error instanceof Error) {
          span.recordException(error)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          })
        }

        // Record error metric
        getMetrics().recordWsEvent({
          event,
          success: false,
          durationMs: Date.now() - startTime,
        })

        throw error
      } finally {
        span.end()
      }
    }

    return originalOn(event, wrappedHandler)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

/**
 * Extract trace context from socket or payload
 */
function extractTraceContext(
  socket: Socket,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
): ReturnType<typeof context.active> {
  let carrier: Record<string, string> = {}

  // 1. Handshake headers
  if (socket.handshake?.headers) {
    carrier = headersToCarrier(
      socket.handshake.headers as Record<string, string | string[] | undefined>,
    )
  }

  // 2. _trace property in payload (custom convention)
  const firstArg = args[0]
  if (firstArg && typeof firstArg === 'object' && '_trace' in firstArg) {
    carrier = { ...carrier, ...(firstArg._trace as Record<string, string>) }
  }

  // 3. Query params
  if (socket.handshake?.query?.traceparent) {
    carrier['traceparent'] = String(socket.handshake.query.traceparent)
  }

  if (socket.handshake?.query?.tracestate) {
    carrier['tracestate'] = String(socket.handshake.query.tracestate)
  }

  return propagation.extract(context.active(), carrier)
}

/**
 * Convert headers to carrier
 */
function headersToCarrier(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const carrier: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      carrier[key.toLowerCase()] = value
    } else if (Array.isArray(value) && value.length > 0) {
      carrier[key.toLowerCase()] = value[0]
    }
  }

  return carrier
}

/**
 * Wrap a single event handler for tracing
 *
 * Use this to manually wrap handlers when you can't use initSocketIOInterceptor
 *
 * @example
 * ```typescript
 * import { wrapSocketHandler } from '@anfitriao/express-otel-observability'
 *
 * socket.on('message', wrapSocketHandler('message', socket, async (data) => {
 *   // Your handler logic
 * }))
 * ```
 */
export function wrapSocketHandler<T>(
  event: string,
  socket: Socket,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => Promise<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (...args: any[]) => Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]): Promise<T> => {
    const startTime = Date.now()

    const parentContext = extractTraceContext(socket, args)

    const span = tracer.startSpan(
      `ws.${event}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'messaging.system': 'socket.io',
          [CustomSemanticAttributes.WS_EVENT_NAME]: event,
          [CustomSemanticAttributes.WS_CLIENT_ID]: socket.id,
          'service.name': serviceName,
        },
      },
      parentContext,
    )

    const activeContext = trace.setSpan(parentContext, span)

    try {
      const result = await context.with(activeContext, () => handler(...args))

      span.setStatus({ code: SpanStatusCode.OK })

      getMetrics().recordWsEvent({
        event,
        success: true,
        durationMs: Date.now() - startTime,
      })

      return result
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      }

      getMetrics().recordWsEvent({
        event,
        success: false,
        durationMs: Date.now() - startTime,
      })

      throw error
    } finally {
      span.end()
    }
  }
}

/**
 * Inject trace context into emit payload
 *
 * Use this when emitting events to include trace context for the client
 *
 * @example
 * ```typescript
 * socket.emit('response', injectTraceContext({ data: 'hello' }))
 * ```
 */
export function injectTraceContext<T extends Record<string, unknown>>(
  data: T,
): T & { _trace: Record<string, string> } {
  const carrier: Record<string, string> = {}
  propagation.inject(context.active(), carrier)

  return {
    ...data,
    _trace: carrier,
  }
}
