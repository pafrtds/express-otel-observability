import { context, trace, Span, SpanContext } from '@opentelemetry/api'

/**
 * Current trace context information
 */
export interface TraceContextInfo {
  traceId: string | undefined
  spanId: string | undefined
  traceFlags: number | undefined
}

/**
 * Get the current span from the OpenTelemetry context
 */
export function getCurrentSpan(): Span | undefined {
  return trace.getSpan(context.active())
}

/**
 * Get the current span context
 */
export function getCurrentSpanContext(): SpanContext | undefined {
  const span = getCurrentSpan()
  return span?.spanContext()
}

/**
 * Get trace information from the current context
 * Useful for enriching logs with trace_id and span_id
 */
export function getTraceContextInfo(): TraceContextInfo {
  const spanContext = getCurrentSpanContext()

  return {
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
    traceFlags: spanContext?.traceFlags,
  }
}

/**
 * Check if there is an active trace context
 */
export function hasActiveTrace(): boolean {
  const spanContext = getCurrentSpanContext()
  return !!spanContext?.traceId
}

/**
 * Get only the current trace ID
 */
export function getCurrentTraceId(): string | undefined {
  return getCurrentSpanContext()?.traceId
}

/**
 * Get only the current span ID
 */
export function getCurrentSpanId(): string | undefined {
  return getCurrentSpanContext()?.spanId
}
