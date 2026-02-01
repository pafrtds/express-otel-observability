/**
 * Default sensitive fields for log masking
 */
export const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'token',
  'authorization',
  'secret',
  'key',
  'apikey',
  'api_key',
  'api-key',
  'bearer',
  'credential',
  'private',
  'cpf',
  'cnpj',
  'ssn',
  'credit_card',
  'card_number',
]

/**
 * Default maximum body size for logging (bytes)
 */
export const DEFAULT_MAX_BODY_LOG_SIZE = 10000

/**
 * Default metrics export interval (milliseconds)
 */
export const DEFAULT_METRICS_EXPORT_INTERVAL_MS = 15000

/**
 * Disabled instrumentations by default (for performance)
 */
export const DISABLED_INSTRUMENTATIONS = [
  '@opentelemetry/instrumentation-fs',
  '@opentelemetry/instrumentation-dns',
  '@opentelemetry/instrumentation-net',
]
