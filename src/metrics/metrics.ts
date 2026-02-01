import {
  metrics,
  Meter,
  Counter,
  Histogram,
  Attributes,
} from '@opentelemetry/api'
import { ObservabilityOptions } from '../types'

// Global metrics instance
let metricsInstance: MetricsService | null = null

/**
 * OpenTelemetry Metrics Service
 *
 * Provides pre-defined metrics for:
 * - HTTP requests
 * - RabbitMQ processing
 * - WebSocket events
 * - Errors
 *
 * Also allows creating custom metrics.
 */
export class MetricsService {
  private meter: Meter

  private readonly serviceName: string

  // Counters
  private httpRequestsTotal: Counter

  private httpErrorsTotal: Counter

  private rabbitMessagesTotal: Counter

  private rabbitErrorsTotal: Counter

  private wsEventsTotal: Counter

  private wsErrorsTotal: Counter

  private errorsTotal: Counter

  // Histograms
  private httpRequestDuration: Histogram

  private rabbitProcessingDuration: Histogram

  private wsEventDuration: Histogram

  constructor(options?: ObservabilityOptions) {
    this.serviceName =
      options?.serviceName || process.env.SERVICE_NAME || 'unknown-service'
    this.initializeMetrics()
  }

  private initializeMetrics(): void {
    this.meter = metrics.getMeter(this.serviceName)

    // === HTTP Metrics ===
    this.httpRequestsTotal = this.meter.createCounter('http_requests_total', {
      description: 'Total number of HTTP requests',
    })

    this.httpErrorsTotal = this.meter.createCounter('http_errors_total', {
      description: 'Total number of HTTP errors',
    })

    this.httpRequestDuration = this.meter.createHistogram(
      'http_request_duration_seconds',
      {
        description: 'HTTP request duration in seconds',
        unit: 's',
      },
    )

    // === RabbitMQ Metrics ===
    this.rabbitMessagesTotal = this.meter.createCounter(
      'rabbitmq_messages_total',
      {
        description: 'Total number of RabbitMQ messages processed',
      },
    )

    this.rabbitErrorsTotal = this.meter.createCounter('rabbitmq_errors_total', {
      description: 'Total number of RabbitMQ processing errors',
    })

    this.rabbitProcessingDuration = this.meter.createHistogram(
      'rabbitmq_processing_duration_seconds',
      {
        description: 'RabbitMQ message processing duration in seconds',
        unit: 's',
      },
    )

    // === WebSocket Metrics ===
    this.wsEventsTotal = this.meter.createCounter('websocket_events_total', {
      description: 'Total number of WebSocket events',
    })

    this.wsErrorsTotal = this.meter.createCounter('websocket_errors_total', {
      description: 'Total number of WebSocket errors',
    })

    this.wsEventDuration = this.meter.createHistogram(
      'websocket_event_duration_seconds',
      {
        description: 'WebSocket event processing duration in seconds',
        unit: 's',
      },
    )

    // === Error Metrics ===
    this.errorsTotal = this.meter.createCounter('errors_total', {
      description: 'Total number of errors by type',
    })
  }

  // === HTTP Methods ===

  /**
   * Record an HTTP request
   */
  recordHttpRequest(attributes: {
    method: string
    route: string
    statusCode: number
    durationMs: number
  }): void {
    const labels: Attributes = {
      method: attributes.method,
      route: this.normalizeRoute(attributes.route),
      status_code: String(attributes.statusCode),
    }

    this.httpRequestsTotal.add(1, labels)
    this.httpRequestDuration.record(attributes.durationMs / 1000, labels)

    if (attributes.statusCode >= 400) {
      this.httpErrorsTotal.add(1, labels)
    }
  }

  // === RabbitMQ Methods ===

  /**
   * Record RabbitMQ message processing
   */
  recordRabbitMessage(attributes: {
    exchange?: string
    queue?: string
    routingKey?: string
    operation: 'publish' | 'consume'
    success: boolean
    durationMs?: number
  }): void {
    const labels: Attributes = {
      exchange: attributes.exchange || 'unknown',
      queue: attributes.queue || 'unknown',
      routing_key: this.normalizeRoutingKey(attributes.routingKey || ''),
      operation: attributes.operation,
    }

    this.rabbitMessagesTotal.add(1, labels)

    if (!attributes.success) {
      this.rabbitErrorsTotal.add(1, labels)
    }

    if (attributes.durationMs !== undefined) {
      this.rabbitProcessingDuration.record(attributes.durationMs / 1000, labels)
    }
  }

  // === WebSocket Methods ===

  /**
   * Record WebSocket event
   */
  recordWsEvent(attributes: {
    event: string
    success: boolean
    durationMs?: number
  }): void {
    const labels: Attributes = {
      event: attributes.event,
    }

    this.wsEventsTotal.add(1, labels)

    if (!attributes.success) {
      this.wsErrorsTotal.add(1, labels)
    }

    if (attributes.durationMs !== undefined) {
      this.wsEventDuration.record(attributes.durationMs / 1000, labels)
    }
  }

  // === Error Methods ===

  /**
   * Record an error
   */
  recordError(attributes: {
    type: string
    context: 'http' | 'rabbitmq' | 'websocket' | 'other'
    code?: string
  }): void {
    this.errorsTotal.add(1, {
      error_type: attributes.type,
      context: attributes.context,
      error_code: attributes.code || 'unknown',
    })
  }

  // === Custom Metrics ===

  /**
   * Create a custom counter
   */
  createCounter(name: string, description: string): Counter {
    return this.meter.createCounter(name, { description })
  }

  /**
   * Create a custom histogram
   */
  createHistogram(name: string, description: string, unit?: string): Histogram {
    return this.meter.createHistogram(name, { description, unit })
  }

  /**
   * Get the meter for creating custom metrics
   */
  getMeter(): Meter {
    return this.meter
  }

  // === Helpers ===

  /**
   * Normalize routes to avoid high cardinality
   */
  private normalizeRoute(route: string): string {
    return route
      // UUIDs
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ':id',
      )
      // Numeric IDs
      .replace(/\/\d+/g, '/:id')
      // Limit size
      .substring(0, 100)
  }

  /**
   * Normalize routing keys to avoid high cardinality
   */
  private normalizeRoutingKey(routingKey: string): string {
    return routingKey
      // UUIDs
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '*',
      )
      // Long numeric IDs
      .replace(/\.\d{10,}\./g, '.*.')
      // Limit size
      .substring(0, 100)
  }
}

/**
 * Initialize metrics service
 */
export function initMetrics(options?: ObservabilityOptions): MetricsService {
  if (!metricsInstance) {
    metricsInstance = new MetricsService(options)
  }
  return metricsInstance
}

/**
 * Get metrics service instance
 */
export function getMetrics(): MetricsService {
  if (!metricsInstance) {
    metricsInstance = new MetricsService()
  }
  return metricsInstance
}
