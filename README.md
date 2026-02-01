# Express OpenTelemetry Observability

A comprehensive OpenTelemetry observability module for Express applications with automatic tracing, structured logging, metrics, and error handling.

## Features

- **Automatic Tracing**: HTTP, Express, Axios auto-instrumentation via OpenTelemetry
- **Distributed Tracing**: Context propagation across HTTP, RabbitMQ, and WebSocket
- **Structured Logging**: JSON logs with automatic trace_id/span_id enrichment, compatible with Loki
- **Winston Transport**: Drop-in Winston transport for existing codebases (zero code changes!)
- **Metrics Collection**: HTTP requests, RabbitMQ messages, WebSocket events, and errors
- **Error Handling**: Global error middleware with structured logging and span recording
- **RabbitMQ Support**: Trace context injection/extraction for message queues (amqplib/amqp-connection-manager)
- **WebSocket Support**: Socket.IO event tracing with context propagation
- **OTLP Export**: Traces, metrics, and logs exported to OpenTelemetry Collector
- **Resilience**: Application won't crash if Collector is unavailable

## Requirements

- Node.js >= 18.0.0
- Express >= 4.0.0

## Installation

```bash
npm install @pafrtds/express-otel-observability
```

## Quick Start

### 1. Create Tracing Bootstrap File

Create a file `src/tracing.bootstrap.ts`:

```typescript
import { initObservability } from '@pafrtds/express-otel-observability'

initObservability({
  serviceName: process.env.SERVICE_NAME || 'my-express-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
})
```

### 2. Import Bootstrap FIRST in Server

```typescript
// server.ts
import './tracing.bootstrap' // MUST be first!

import http from 'http'
import express from 'express'
import {
  httpMetricsMiddleware,
  observabilityErrorMiddleware,
  logger,
} from '@pafrtds/express-otel-observability'

const app = express()

// Add metrics middleware BEFORE routes
app.use(httpMetricsMiddleware)

app.use(express.json())

// Your routes
app.get('/users', (req, res) => {
  logger.info('Fetching users')
  res.json([{ id: 1, name: 'John' }])
})

// Add error middleware AFTER routes
app.use(observabilityErrorMiddleware)

const server = http.createServer(app)
server.listen(3000, () => {
  logger.info('Server started on port 3000')
})
```

## Configuration Options

```typescript
interface ObservabilityOptions {
  // Required
  serviceName: string

  // Optional (with defaults)
  serviceVersion?: string           // Default: '1.0.0'
  environment?: string              // Default: 'development'
  
  // OTLP Endpoints
  otlpTraceEndpoint?: string        // Default: 'http://localhost:4318/v1/traces'
  otlpMetricsEndpoint?: string      // Default: 'http://localhost:4318/v1/metrics'
  otlpLogsEndpoint?: string         // Default: 'http://localhost:4318/v1/logs'
  
  // Feature Toggles
  enableMetrics?: boolean           // Default: true
  enableOtlpLogs?: boolean          // Default: true
  enableConsoleLogs?: boolean       // Default: true
  
  // Other Options
  logLevel?: 'debug' | 'info' | 'warn' | 'error'  // Default: 'info'
  sensitiveFields?: string[]        // Fields to mask in logs
  maxBodyLogSize?: number           // Default: 10000 bytes
  metricsExportIntervalMs?: number  // Default: 15000
  debug?: boolean                   // Default: false
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVICE_NAME` | Service name for telemetry | - |
| `SERVICE_VERSION` | Service version | `1.0.0` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | OTLP traces endpoint | `http://localhost:4318/v1/traces` |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | OTLP metrics endpoint | `http://localhost:4318/v1/metrics` |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | OTLP logs endpoint | `http://localhost:4318/v1/logs` |
| `OTEL_METRICS_ENABLED` | Enable metrics | `true` |
| `OTEL_LOGS_ENABLED` | Enable OTLP logs | `true` |
| `OTEL_CONSOLE_LOGS_ENABLED` | Enable console logs | `true` |
| `OTEL_METRICS_EXPORT_INTERVAL_MS` | Metrics export interval | `15000` |
| `OTEL_DEBUG` | Enable debug mode | `false` |
| `LOG_LEVEL` | Log level | `info` |

## Structured Logging

### Using the Default Logger

```typescript
import { logger } from '@pafrtds/express-otel-observability'

logger.info('User created', { userId: '123' })
logger.error('Failed to process request', { error: err.message })
```

### Creating Context-Specific Loggers

```typescript
import { createLogger } from '@pafrtds/express-otel-observability'

const userLogger = createLogger('UserService')
userLogger.info('Processing user') // Logs with context: "UserService"
```

### Log Output

**Development (readable format):**
```
2024-01-15T10:30:00.000Z INFO  [UserService] User created (trace: a1b2c3d4...)
```

**Production (JSON for Loki):**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "User created",
  "service": "my-express-service",
  "environment": "production",
  "trace_id": "a1b2c3d4e5f6...",
  "span_id": "1234abcd...",
  "context": "UserService",
  "userId": "123"
}
```

## Winston Transport Integration

If your project already uses Winston, you can integrate observability with **zero code changes** by simply replacing your transport:

### Minimal Change (Recommended)

Just update your existing logger file:

```typescript
// Before
import { createLogger, format, transports } from 'winston'

export const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
  ),
  transports: [new transports.Console()],
})

// After
import { createLogger, format } from 'winston'
import { WinstonOtelTransport } from '@pafrtds/express-otel-observability'

export const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
  ),
  transports: [
    new WinstonOtelTransport({
      serviceName: 'my-service',
      environment: process.env.NODE_ENV,
    }),
  ],
})
```

Now all your existing `logger.info()`, `logger.error()`, etc. calls will automatically:
- Include `trace_id` and `span_id`
- Export to OTLP (OpenTelemetry Collector)
- Output structured JSON in production
- Mask sensitive data

### Using the Convenience Function

```typescript
import { createWinstonLogger } from '@pafrtds/express-otel-observability'

export const logger = createWinstonLogger({
  serviceName: 'my-service',
  environment: 'production',
  level: 'info',
})
```

### Transport Options

```typescript
interface WinstonOtelTransportOptions {
  serviceName?: string       // Service name for telemetry
  environment?: string       // Environment (development/production)
  sensitiveFields?: string[] // Fields to mask (password, token, etc.)
  enableOtlp?: boolean       // Enable OTLP export (default: true)
  enableConsole?: boolean    // Enable console output (default: true)
}
```

## RabbitMQ Integration

### Patch Your RabbitMQ Class

```typescript
import { RabbitMQ } from './queue/rabbitmq'
import { initRabbitMQInterceptor, wrapConsumer } from '@pafrtds/express-otel-observability'

// Patch the class (after initObservability)
initRabbitMQInterceptor(RabbitMQ, { serviceName: 'my-service' })

// Now all sends are automatically traced
const rabbit = RabbitMQ.getInstance()
await rabbit.send('my-queue', { data: 'test' }) // Traced!
```

### Wrap Consumers for Trace Continuity

```typescript
import { wrapConsumer } from '@pafrtds/express-otel-observability'

await rabbit.subscribe('my-queue', async ({ msg, ack, nack }) => {
  await wrapConsumer(msg, 'my-queue', async (span) => {
    // Handler executes within the trace context
    // Logs will automatically include trace_id from the producer
    logger.info('Processing message')
    
    ack(msg)
  })
})
```

### Manual Context Injection/Extraction

```typescript
import { injectRabbitMQContext, extractRabbitMQContext } from '@pafrtds/express-otel-observability'
import { context } from '@opentelemetry/api'

// When publishing manually
const headers = injectRabbitMQContext({})
await channel.sendToQueue(queue, msg, { headers })

// When consuming manually
const parentContext = extractRabbitMQContext(msg.properties.headers)
context.with(parentContext, () => {
  // Handler logic with trace context
})
```

## Socket.IO Integration

### Initialize Interceptor

```typescript
import { Server } from 'socket.io'
import { initSocketIOInterceptor } from '@pafrtds/express-otel-observability'

const io = new Server(httpServer)

// Initialize interceptor (after initObservability)
initSocketIOInterceptor(io, { serviceName: 'my-service' })

// Now all events are automatically traced
io.on('connection', (socket) => {
  socket.on('message', (data) => {
    // This handler is traced!
    logger.info('Message received')
  })
})
```

### Manual Handler Wrapping

```typescript
import { wrapSocketHandler } from '@pafrtds/express-otel-observability'

socket.on('message', wrapSocketHandler('message', socket, async (data) => {
  // Handler logic with tracing
}))
```

### Inject Trace Context in Emits

```typescript
import { injectTraceContext } from '@pafrtds/express-otel-observability'

// Include trace context for clients
socket.emit('response', injectTraceContext({ data: 'hello' }))
```

## OpenTelemetry Collector Configuration

Example `otel-collector.yaml`:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 512

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true

  prometheusremotewrite:
    endpoint: http://prometheus:9090/api/v1/write
    tls:
      insecure: true

  loki:
    endpoint: http://loki:3100/loki/api/v1/push
    labels:
      resource:
        service.name: "service"
        service.version: "version"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo]

    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheusremotewrite]

    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [loki]
```

## Collected Metrics

### HTTP Metrics
- `http_requests_total` - Total HTTP requests (labels: method, route, status_code)
- `http_errors_total` - Total HTTP errors (labels: method, route, status_code)
- `http_request_duration_seconds` - Request duration histogram

### RabbitMQ Metrics
- `rabbitmq_messages_total` - Total messages (labels: exchange, queue, routing_key, operation)
- `rabbitmq_errors_total` - Total errors (labels: exchange, queue, routing_key, operation)
- `rabbitmq_processing_duration_seconds` - Processing duration histogram

### WebSocket Metrics
- `websocket_events_total` - Total events (labels: event)
- `websocket_errors_total` - Total errors (labels: event)
- `websocket_event_duration_seconds` - Event duration histogram

### Error Metrics
- `errors_total` - Total errors (labels: error_type, context, error_code)

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `initObservability(options)` | Initialize all observability components |
| `initTracing(options)` | Initialize OpenTelemetry SDK |
| `shutdownTracing()` | Gracefully shutdown SDK |

### Logger

| Function | Description |
|----------|-------------|
| `logger` | Default logger instance |
| `createLogger(context)` | Create context-specific logger |
| `logger.info(message, meta?)` | Log info level |
| `logger.debug(message, meta?)` | Log debug level |
| `logger.warn(message, meta?)` | Log warn level |
| `logger.error(message, meta?)` | Log error level |
| `logger.logError(error, meta?)` | Log error object |

### Metrics

| Function | Description |
|----------|-------------|
| `getMetrics()` | Get metrics service instance |
| `metrics.recordHttpRequest(attrs)` | Record HTTP request |
| `metrics.recordRabbitMessage(attrs)` | Record RabbitMQ message |
| `metrics.recordWsEvent(attrs)` | Record WebSocket event |
| `metrics.recordError(attrs)` | Record error |

### Trace Context

| Function | Description |
|----------|-------------|
| `getCurrentTraceId()` | Get current trace ID |
| `getCurrentSpanId()` | Get current span ID |
| `hasActiveTrace()` | Check if trace is active |
| `getTraceContextInfo()` | Get full trace context |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Express Application                          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Observability Module                      │   │
│  │                                                            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │   │
│  │  │   Tracing   │  │   Metrics   │  │   Logger    │       │   │
│  │  │  (OTel SDK) │  │  (Counters/ │  │ (Structured │       │   │
│  │  │             │  │  Histograms)│  │    JSON)    │       │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘       │   │
│  │         │                │                │               │   │
│  │  ┌──────┴────────────────┴────────────────┴──────┐       │   │
│  │  │              OTLP Exporters                    │       │   │
│  │  └───────────────────────┬───────────────────────┘       │   │
│  │                          │                                │   │
│  └──────────────────────────┼────────────────────────────────┘   │
│                             │                                     │
└─────────────────────────────┼─────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  OpenTelemetry Collector                         │
│                                                                   │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                    │
│  │  Traces   │  │  Metrics  │  │   Logs    │                    │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘                    │
│        │              │              │                           │
└────────┼──────────────┼──────────────┼───────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌───────────┐   ┌─────────┐
    │  Tempo  │   │Prometheus │   │  Loki   │
    │(traces) │   │ (metrics) │   │ (logs)  │
    └─────────┘   └───────────┘   └─────────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
                        ▼
                  ┌───────────┐
                  │  Grafana  │
                  │(dashboard)│
                  └───────────┘
```

## Security Considerations

- Sensitive fields are automatically masked in logs (password, token, etc.)
- Configure additional sensitive fields via `sensitiveFields` option
- Request/response bodies are truncated to prevent large log entries
- OTLP endpoints should be secured in production

## License

MIT
