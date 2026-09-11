/**
 * Logger estructurado sin dependencias: una línea JSON por evento en stdout
 * (stderr para `error`), como esperan los recolectores de Cloud Run / K8s /
 * Datadog. Cada log lleva servicio, nivel, timestamp y los campos de contexto
 * heredados (p. ej. requestId), así una traza se sigue con un solo filtro.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
export type LogFields = Record<string, unknown>

const WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }

export class Logger {
  constructor(
    private readonly service: string,
    private readonly context: LogFields = {},
    private readonly threshold: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info',
  ) {}

  /** Sub-logger con contexto extra (p. ej. el requestId de una petición). */
  child(fields: LogFields): Logger {
    return new Logger(this.service, { ...this.context, ...fields }, this.threshold)
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields)
  }

  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields)
  }

  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields)
  }

  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields)
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (WEIGHT[level] < WEIGHT[this.threshold]) return
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: this.service,
      msg: message,
      ...this.context,
      ...fields,
    })
    if (level === 'error') process.stderr.write(line + '\n')
    else process.stdout.write(line + '\n')
  }
}

/** Logger silencioso para tests. */
export const NULL_LOGGER = new Logger('null', {}, 'silent')
