/**
 * Microservicio de búsqueda semántica del catálogo (HTTP/JSON, sin
 * dependencias). HTTP y no gRPC a propósito: el consumidor principal es el
 * navegador (gRPC-web exigiría un proxy) y los payloads son pequeños; la API
 * queda depurable con curl y monitorizable por cualquier plataforma.
 *
 *   npm run search:serve
 *
 * Endpoints:
 *   GET  /healthz          → estado, nº de productos, proveedor
 *   GET  /metrics          → contadores y latencias por ruta + último sync
 *   GET  /search?q=&limit= → { results: [{ id, score }] } por relevancia
 *   POST /sync             → { products: SearchProduct[] } instantánea completa
 *                            (idempotente; borra lo que no venga en la lista)
 *
 * Trazabilidad: toda petición lleva un requestId (se acepta `x-request-id`
 * entrante —el pipeline propaga el suyo— o se genera), se devuelve en la
 * cabecera de respuesta y aparece en cada línea de log de esa petición.
 *
 * Config por entorno:
 *   PORT                (8787)     puerto de escucha
 *   SEARCH_DATA_DIR     (data/search-index) carpeta persistente del índice
 *   EMBEDDINGS_PROVIDER (hashing)  'hashing' local o 'jina' multimodal cloud
 *   JINA_API_KEY                   obligatoria con EMBEDDINGS_PROVIDER=jina
 *   SEARCH_SYNC_TOKEN              si se define, POST /sync exige Bearer token
 *   LOG_LEVEL           (info)     debug | info | warn | error
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { FileSnapshotStore, defaultDataDir } from './adapters/FileSnapshotStore'
import { HashingEmbedder } from './adapters/HashingEmbedder'
import { JinaClipEmbedder } from './adapters/JinaClipEmbedder'
import { Logger, NULL_LOGGER } from './core/logger'
import { Metrics } from './core/metrics'
import { SearchIndexService } from './core/SearchIndexService'
import type { Embedder, SearchProduct } from './core/types'

const SERVICE_VERSION = '1.0.0'

function embedderFromEnv(): Embedder {
  if (process.env.EMBEDDINGS_PROVIDER === 'jina') {
    const key = process.env.JINA_API_KEY
    if (!key) throw new Error('EMBEDDINGS_PROVIDER=jina requiere JINA_API_KEY')
    return new JinaClipEmbedder(key)
  }
  return new HashingEmbedder()
}

export interface SearchServer {
  port: number
  close(): Promise<void>
}

/** Arranca el servicio; exportado para levantarlo en tests con puerto efímero. */
export async function startSearchServer(options?: {
  port?: number
  embedder?: Embedder
  dataDir?: string | null
  syncToken?: string
  logger?: Logger
}): Promise<SearchServer> {
  const embedder = options?.embedder ?? embedderFromEnv()
  const dataDir = options?.dataDir === null ? null : (options?.dataDir ?? defaultDataDir())
  const syncToken = options?.syncToken ?? process.env.SEARCH_SYNC_TOKEN
  const log = options?.logger ?? NULL_LOGGER
  const metrics = new Metrics()
  const service = new SearchIndexService(
    embedder,
    dataDir ? new FileSnapshotStore(dataDir) : null,
  )
  const restored = await service.restore()
  log.info('índice restaurado', { restored, products: service.size, provider: embedder.version })

  const server = createServer((request, response) => {
    const started = performance.now()
    const requestId = firstHeader(request.headers['x-request-id']) ?? randomUUID()
    const route = `${request.method} ${new URL(request.url ?? '/', 'http://x').pathname}`
    const requestLog = log.child({ requestId })
    response.setHeader('x-request-id', requestId)
    response.on('finish', () => {
      const durationMs = performance.now() - started
      metrics.observeRequest(route, response.statusCode, durationMs)
      requestLog.info('request', {
        route,
        status: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      })
    })
    handle(request, response, requestLog).catch((error: unknown) => {
      requestLog.error('petición fallida', { route, error: String(error) })
      if (!response.headersSent) sendJson(response, 500, { error: String(error), requestId })
      else response.end()
    })
  })

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    requestLog: Logger,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, {
        ok: true,
        version: SERVICE_VERSION,
        products: service.size,
        provider: embedder.version,
        dim: embedder.dim,
        restored,
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/metrics') {
      sendJson(response, 200, metrics.snapshot())
      return
    }

    if (request.method === 'GET' && url.pathname === '/search') {
      const query = url.searchParams.get('q')?.trim() ?? ''
      if (!query) {
        sendJson(response, 400, { error: 'Falta el parámetro q' })
        return
      }
      const limit = clampInt(url.searchParams.get('limit'), 1, 100, 20)
      const started = performance.now()
      const results = await service.search(query, limit)
      const tookMs = Math.round((performance.now() - started) * 100) / 100
      const topScore = results[0]?.score ?? null
      metrics.observeSearchQuality(topScore)
      // A nivel debug queda la consulta y su mejor resultado: es la materia
      // prima para construir un dataset de relevancia real (query → clics).
      requestLog.debug('búsqueda', {
        query,
        hits: results.length,
        topId: results[0]?.id ?? null,
        topScore,
        tookMs,
      })
      sendJson(response, 200, { results, tookMs })
      return
    }

    if (request.method === 'POST' && url.pathname === '/sync') {
      if (syncToken && request.headers.authorization !== `Bearer ${syncToken}`) {
        requestLog.warn('sync rechazado: token inválido')
        sendJson(response, 401, { error: 'Token de sync inválido' })
        return
      }
      const body = await readBody(request)
      let products: SearchProduct[]
      try {
        const parsed = JSON.parse(body) as { products?: unknown }
        if (!Array.isArray(parsed.products)) throw new Error('products debe ser una lista')
        products = parsed.products as SearchProduct[]
      } catch (error) {
        sendJson(response, 400, { error: `Cuerpo inválido: ${String(error)}` })
        return
      }
      const started = performance.now()
      try {
        const report = await service.sync(products)
        const durationMs = performance.now() - started
        metrics.observeSync(report, durationMs)
        requestLog.info('sync completado', { ...report, durationMs: Math.round(durationMs) })
        sendJson(response, 200, report)
      } catch (error) {
        metrics.observeSyncError(String(error))
        throw error
      }
      return
    }

    sendJson(response, 404, { error: 'Ruta desconocida' })
  }

  const port = options?.port ?? Number(process.env.PORT ?? 8787)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => resolve())
  })
  const address = server.address()
  const boundPort = typeof address === 'object' && address ? address.port : port
  log.info('servicio escuchando', { port: boundPort, dataDir })

  return {
    port: boundPort,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  // Cabecera controlada por el cliente: se sanea antes de entrar en los logs.
  return raw?.slice(0, 64).replace(/[^\w.-]/g, '') || undefined
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024 * 1024) {
        reject(new Error('Cuerpo demasiado grande'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

// Arranque directo (tsx services/search/server.ts); en tests solo se importa.
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const log = new Logger('catalog-search')
  const started = await startSearchServer({ logger: log })
  // Apagado limpio: Cloud Run / K8s mandan SIGTERM antes de matar el pod.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log.info('apagando', { signal })
      started.close().then(
        () => process.exit(0),
        () => process.exit(1),
      )
    })
  }
}
