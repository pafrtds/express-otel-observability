import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  Span,
} from '@opentelemetry/api'
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_OPERATION,
  SEMATTRS_MESSAGING_DESTINATION,
  MESSAGINGOPERATIONVALUES_PROCESS,
} from '@opentelemetry/semantic-conventions'

import { CustomSemanticAttributes, ObservabilityOptions } from '../types'
import { getMetrics } from '../metrics/metrics'
import { StructuredLogger } from '../logger/structured-logger'

const logger = new StructuredLogger('RabbitMQInterceptor')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RabbitMQClass = any

// Flag to prevent applying the patch multiple times
let isPatched = false

// Store original methods
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalSend: ((...args: any[]) => Promise<boolean>) | null = null

const tracer = trace.getTracer('rabbitmq')

let serviceName = 'unknown-service'

/**
 * Initialize RabbitMQ interceptor by patching an existing RabbitMQ class
 *
 * This applies monkey-patching to the RabbitMQ class to automatically:
 * - Inject trace context into message headers when publishing
 * - Create spans for publish operations
 * - Record metrics
 *
 * @example
 * ```typescript
 * import { RabbitMQ } from './queue/rabbitmq'
 * import { initRabbitMQInterceptor } from '@anfitriao/express-otel-observability'
 *
 * // Patch the RabbitMQ class
 * initRabbitMQInterceptor(RabbitMQ, { serviceName: 'my-service' })
 *
 * // Now all sends will be traced automatically
 * const rabbit = RabbitMQ.getInstance()
 * await rabbit.send('my-queue', { data: 'test' })
 * ```
 */
export function initRabbitMQInterceptor(
  RabbitMQClass: RabbitMQClass,
  options?: ObservabilityOptions,
): void {
  if (isPatched) {
    return
  }

  serviceName =
    options?.serviceName || process.env.SERVICE_NAME || 'unknown-service'

  try {
    patchRabbitMQ(RabbitMQClass)
  } catch (error) {
    logger.warn('Failed to patch RabbitMQ class', { error: String(error) })
  }
}

/**
 * Apply monkey-patch to RabbitMQ class
 */
function patchRabbitMQ(RabbitMQClass: RabbitMQClass): void {
  // Get the prototype
  const proto = RabbitMQClass.prototype

  // Patch send method
  if (proto.send && !originalSend) {
    originalSend = proto.send

    proto.send = async function (
      queue: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      msg: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options?: any,
    ): Promise<boolean> {
      const startTime = Date.now()

      // Prepare headers
      const headers: Record<string, string> = { ...(options?.headers || {}) }

      // Create span for publish operation
      const span = tracer.startSpan(`${queue} send`, {
        kind: SpanKind.PRODUCER,
        attributes: {
          [SEMATTRS_MESSAGING_SYSTEM]: 'rabbitmq',
          [SEMATTRS_MESSAGING_OPERATION]: 'publish',
          [SEMATTRS_MESSAGING_DESTINATION]: queue,
          [CustomSemanticAttributes.MESSAGING_RABBITMQ_QUEUE]: queue,
          'service.name': serviceName,
        },
      })

      try {
        // Inject trace context into headers
        const activeContext = trace.setSpan(context.active(), span)

        propagation.inject(activeContext, headers)

        // Call original method with enriched headers
        const result = await originalSend!.call(this, queue, msg, {
          ...options,
          headers,
        })

        span.setStatus({ code: SpanStatusCode.OK })

        // Record success metric
        getMetrics().recordRabbitMessage({
          queue,
          operation: 'publish',
          success: true,
          durationMs: Date.now() - startTime,
        })

        return result
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
        getMetrics().recordRabbitMessage({
          queue,
          operation: 'publish',
          success: false,
          durationMs: Date.now() - startTime,
        })

        throw error
      } finally {
        span.end()
      }
    }
  }

  isPatched = true
  logger.info('RabbitMQ interceptor applied successfully')
}

/**
 * Message type for consumer wrapper (compatible with amqplib)
 */
export interface ConsumeMessage {
  fields: {
    exchange: string
    routingKey: string
    deliveryTag: number
  }
  properties: {
    headers?: Record<string, unknown>
    correlationId?: string
    replyTo?: string
  }
  content: Buffer
}

/**
 * Create a consumer span wrapper
 *
 * Use this to wrap your message handlers to create spans for consume operations
 *
 * @example
 * ```typescript
 * import { wrapConsumer } from '@anfitriao/express-otel-observability'
 *
 * await rabbit.subscribe(queue, async ({ msg, ack, nack }) => {
 *   await wrapConsumer(msg, queue, async (span) => {
 *     // Your handler logic here
 *     // The span is automatically enriched with trace context
 *     ack(msg)
 *   })
 * })
 * ```
 */
export async function wrapConsumer<T>(
  msg: ConsumeMessage,
  queue: string,
  handler: (span: Span) => Promise<T>,
): Promise<T> {
  const startTime = Date.now()

  // Extract trace context from headers
  const headers = (msg.properties.headers || {}) as Record<string, string>
  const parentContext = propagation.extract(context.active(), headers)

  // Extract message info
  const exchange = msg.fields.exchange || 'default'
  const routingKey = msg.fields.routingKey || queue

  // Create consumer span
  const span = tracer.startSpan(
    `${queue} process`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        [SEMATTRS_MESSAGING_SYSTEM]: 'rabbitmq',
        [SEMATTRS_MESSAGING_OPERATION]: MESSAGINGOPERATIONVALUES_PROCESS,
        [SEMATTRS_MESSAGING_DESTINATION]: exchange,
        [CustomSemanticAttributes.MESSAGING_RABBITMQ_EXCHANGE]: exchange,
        [CustomSemanticAttributes.MESSAGING_RABBITMQ_ROUTING_KEY]: routingKey,
        [CustomSemanticAttributes.MESSAGING_RABBITMQ_QUEUE]: queue,
        'service.name': serviceName,
      },
    },
    parentContext,
  )

  const activeContext = trace.setSpan(parentContext, span)

  try {
    // Execute handler within span context
    const result = await context.with(activeContext, () => handler(span))

    span.setStatus({ code: SpanStatusCode.OK })

    // Record success metric
    getMetrics().recordRabbitMessage({
      queue,
      exchange,
      routingKey,
      operation: 'consume',
      success: true,
      durationMs: Date.now() - startTime,
    })

    return result
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
    getMetrics().recordRabbitMessage({
      queue,
      exchange,
      routingKey,
      operation: 'consume',
      success: false,
      durationMs: Date.now() - startTime,
    })

    throw error
  } finally {
    span.end()
  }
}

/**
 * Inject trace context into message headers
 *
 * Use this to manually inject trace context when sending messages
 *
 * @example
 * ```typescript
 * const headers = injectRabbitMQContext({})
 * await channel.sendToQueue(queue, msg, { headers })
 * ```
 */
export function injectRabbitMQContext(
  headers: Record<string, string> = {},
): Record<string, string> {
  const enrichedHeaders = { ...headers }
  propagation.inject(context.active(), enrichedHeaders)
  return enrichedHeaders
}

/**
 * Extract trace context from message headers
 *
 * Use this to manually extract trace context when consuming messages
 *
 * @example
 * ```typescript
 * const parentContext = extractRabbitMQContext(msg.properties.headers)
 * context.with(parentContext, () => {
 *   // Your handler logic
 * })
 * ```
 */
export function extractRabbitMQContext(
  headers: Record<string, unknown> = {},
): ReturnType<typeof context.active> {
  return propagation.extract(context.active(), headers as Record<string, string>)
}

/**
 * Restore original methods (useful for testing)
 */
export function restoreRabbitMQ(RabbitMQClass: RabbitMQClass): void {
  if (!isPatched) return

  const proto = RabbitMQClass.prototype

  if (originalSend) {
    proto.send = originalSend
    originalSend = null
  }

  isPatched = false
}
