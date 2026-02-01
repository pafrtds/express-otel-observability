/**
 * Express Server Example with Full Observability
 *
 * This example shows how to integrate the observability module
 * with an Express application, including:
 * - HTTP metrics and tracing
 * - Structured logging
 * - Error handling
 * - RabbitMQ tracing
 * - Socket.IO tracing
 */

// ============================================================================
// IMPORTANT: Import tracing BEFORE any other imports
// ============================================================================
import './tracing.bootstrap'

import http from 'http'
import express from 'express'
import { Server as SocketIOServer } from 'socket.io'

import {
  httpMetricsMiddleware,
  observabilityErrorMiddleware,
  logger,
  createLogger,
  initSocketIOInterceptor,
  initRabbitMQInterceptor,
  wrapConsumer,
} from '@anfitriao/express-otel-observability'

// Import your RabbitMQ class
// import { RabbitMQ } from './queue/rabbitmq'

// ============================================================================
// Create Express App
// ============================================================================

const app = express()

// Add metrics middleware BEFORE routes
app.use(httpMetricsMiddleware)

// Body parsing
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ============================================================================
// Routes
// ============================================================================

// Health check (excluded from metrics)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Example route with logging
app.get('/users', (req, res) => {
  const userLogger = createLogger('UsersController')

  userLogger.info('Fetching users', { query: req.query })

  // Simulate some work
  const users = [
    { id: 1, name: 'John' },
    { id: 2, name: 'Jane' },
  ]

  userLogger.debug('Found users', { count: users.length })

  res.json(users)
})

// Example route that throws an error
app.get('/error', () => {
  throw new Error('Something went wrong!')
})

// ============================================================================
// Error Handling
// ============================================================================

// Add observability error middleware AFTER routes
app.use(observabilityErrorMiddleware)

// ============================================================================
// Start Server
// ============================================================================

async function start() {
  const server = http.createServer(app)

  // ========================================================================
  // Socket.IO Setup
  // ========================================================================

  const io = new SocketIOServer(server, {
    transports: ['websocket'],
    cors: { origin: '*' },
  })

  // Initialize Socket.IO interceptor
  initSocketIOInterceptor(io, { serviceName: 'my-express-service' })

  io.on('connection', socket => {
    logger.info('Client connected', { socketId: socket.id })

    // All events will be automatically traced!
    socket.on('message', data => {
      logger.info('Message received', { data })
      socket.emit('response', { received: true })
    })

    socket.on('disconnect', () => {
      logger.info('Client disconnected', { socketId: socket.id })
    })
  })

  // ========================================================================
  // RabbitMQ Setup (uncomment if using RabbitMQ)
  // ========================================================================

  // Initialize RabbitMQ interceptor
  // initRabbitMQInterceptor(RabbitMQ, { serviceName: 'my-express-service' })

  // const rabbit = RabbitMQ.getInstance()
  // await rabbit.init()

  // Example: Wrap consumer for tracing
  // await rabbit.subscribe('my-queue', async ({ msg, ack, nack }) => {
  //   await wrapConsumer(msg, 'my-queue', async (span) => {
  //     // Your handler logic here
  //     // The span is automatically enriched with trace context
  //     const content = JSON.parse(msg.content.toString())
  //     logger.info('Processing message', { content })
  //
  //     ack(msg)
  //   })
  // })

  // ========================================================================
  // Start Listening
  // ========================================================================

  const PORT = process.env.PORT || 3000

  server.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`)
  })

  // Graceful shutdown
  process.once('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...')

    server.close(() => {
      logger.info('HTTP server closed')
      process.exit(0)
    })
  })
}

start().catch(error => {
  logger.error('Failed to start server', { error: String(error) })
  process.exit(1)
})
