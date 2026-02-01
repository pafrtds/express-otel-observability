import { Request, Response, NextFunction } from 'express'
import { getMetrics } from '../metrics/metrics'

/**
 * Express middleware to collect HTTP metrics
 *
 * Automatically collects:
 * - Request count by method/route/status
 * - Request duration
 * - Error count
 *
 * @example
 * ```typescript
 * import express from 'express'
 * import { httpMetricsMiddleware } from '@anfitriao/express-otel-observability'
 *
 * const app = express()
 *
 * // Add before routes
 * app.use(httpMetricsMiddleware)
 *
 * app.get('/users', (req, res) => { ... })
 * ```
 */
export function httpMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Ignore health check routes
  if (shouldIgnore(req.path)) {
    return next()
  }

  const startTime = Date.now()

  // Capture response finish to record metrics
  res.on('finish', () => {
    const durationMs = Date.now() - startTime
    const route = getRoute(req)

    getMetrics().recordHttpRequest({
      method: req.method,
      route,
      statusCode: res.statusCode,
      durationMs,
    })
  })

  next()
}

/**
 * Get normalized route
 */
function getRoute(req: Request): string {
  // Try to get route from Express (with parameters)
  if (req.route?.path) {
    return req.route.path
  }

  // Try baseUrl + route path
  if (req.baseUrl && req.route?.path) {
    return `${req.baseUrl}${req.route.path}`
  }

  // Fallback to path, normalizing IDs
  return req.path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    )
    .replace(/\/\d+/g, '/:id')
}

/**
 * Check if route should be ignored
 */
function shouldIgnore(path: string): boolean {
  const ignoredPaths = [
    '/health',
    '/healthz',
    '/ready',
    '/metrics',
    '/favicon.ico',
  ]

  return ignoredPaths.some(ignored => path.startsWith(ignored))
}
