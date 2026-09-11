/**
 * Microservicio de diseño conversacional (WebSocket + HTTP).
 *
 *   npm run designer:serve
 *
 * WebSocket (path /ws):
 *   → { type: 'chat',  requestId, text }
 *   ← { type: 'reply', requestId, reply, actions, state, rejected }
 *   → { type: 'judge', requestId, brief, image }   // image: dataURL o base64
 *   ← { type: 'judge.result', requestId, verdict }
 *   ← { type: 'state', state }                     // al conectar
 *   ← { type: 'error', requestId?, error }
 *
 * HTTP: GET /healthz · GET /metrics · GET /state
 *
 * Config por entorno:
 *   DESIGNER_PORT      (8790)
 *   DESIGNER_PROVIDER  (auto)  'anthropic' | 'fake' | 'auto' (anthropic si hay key)
 *   ANTHROPIC_API_KEY          para el proveedor anthropic
 *   DESIGNER_MODEL     (claude-opus-5)
 *   DESIGNER_TOKEN             si se define, el WS exige ?token=
 *   SEARCH_URL         (http://localhost:8787) microservicio de búsqueda
 *   CATALOG_SITE, DESIGNER_ROOM_FILE, LOG_LEVEL
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { Logger, NULL_LOGGER } from '../search/core/logger'
import { Metrics } from '../search/core/metrics'
import { AnthropicBrain, AnthropicJudge, AnthropicPicker } from './adapters/anthropic'
import { ConstantJudge, DeterministicPicker, TemplateBrain } from './adapters/fakes'
import { screenshotStoreFromEnv, type ScreenshotStore } from './adapters/screenshotStore'
import { FileCatalogSource, defaultCatalogIndexPath } from './core/catalogSource'
import { DesignSession } from './core/DesignSession'
import { defaultRoomFilePath } from './core/roomFile'
import { DesignerSearchClient } from './core/searchClient'
import type { DesignerBrain, ProductPicker, RoomJudge } from './core/types'

interface Providers {
  brain: DesignerBrain
  picker: ProductPicker
  judge: RoomJudge
}

function providersFromEnv(log: Logger): Providers {
  const mode = process.env.DESIGNER_PROVIDER ?? 'auto'
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY)
  const useAnthropic = mode === 'anthropic' || (mode === 'auto' && hasKey)
  if (useAnthropic && !hasKey) {
    throw new Error('DESIGNER_PROVIDER=anthropic requiere ANTHROPIC_API_KEY')
  }
  if (useAnthropic) {
    log.info('proveedor LLM/VLM: anthropic', { model: process.env.DESIGNER_MODEL ?? 'claude-opus-5' })
    return { brain: new AnthropicBrain(), picker: new AnthropicPicker(), judge: new AnthropicJudge() }
  }
  log.warn('proveedor LLM/VLM: fake determinista (sin ANTHROPIC_API_KEY)')
  return { brain: new TemplateBrain(), picker: new DeterministicPicker(), judge: new ConstantJudge() }
}

export interface DesignerServer {
  port: number
  close(): Promise<void>
}

/** Arranca el servicio; exportado para tests con puerto efímero y fakes. */
export async function startDesignerServer(options?: {
  port?: number
  providers?: Providers
  roomFile?: string
  catalogIndex?: string
  searchUrl?: string
  token?: string
  logger?: Logger
  screenshots?: ScreenshotStore
}): Promise<DesignerServer> {
  const log = options?.logger ?? NULL_LOGGER
  const metrics = new Metrics()
  const providers = options?.providers ?? providersFromEnv(log)
  const screenshots = options?.screenshots ?? screenshotStoreFromEnv()
  const catalog = new FileCatalogSource(options?.catalogIndex ?? defaultCatalogIndexPath())
  const session = new DesignSession({
    ...providers,
    search: new DesignerSearchClient(options?.searchUrl, catalog),
    catalog,
    filePath: options?.roomFile ?? defaultRoomFilePath(),
    logger: log,
  })
  const token = options?.token ?? process.env.DESIGNER_TOKEN

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const send = (status: number, payload: unknown): void => {
      const body = JSON.stringify(payload)
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      })
      response.end(body)
    }
    // Si hay token configurado, protege también el estado por HTTP: el room
    // file entero (muebles + log) no debe filtrarse por un GET anónimo.
    if (token && url.pathname === '/state' && url.searchParams.get('token') !== token) {
      send(401, { error: 'token inválido' })
      return
    }
    if (url.pathname === '/healthz') {
      send(200, {
        ok: true,
        brain: providers.brain.version,
        picker: providers.picker.version,
        judge: providers.judge.version,
        catalog: catalog.count(),
      })
      return
    }
    if (url.pathname === '/metrics') {
      send(200, metrics.snapshot())
      return
    }
    if (url.pathname === '/state') {
      void session.state().then(
        (state) => send(200, state),
        (error: unknown) => send(500, { error: String(error) }),
      )
      return
    }
    send(404, { error: 'Ruta desconocida' })
  })

  // maxPayload acota el mensaje del juez (screenshot base64): 16 MiB frente
  // a los 100 MiB por defecto de ws.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 * 1024 })
  wss.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (token && url.searchParams.get('token') !== token) {
      socket.close(4401, 'token inválido')
      return
    }
    // Sin token, solo orígenes locales (o los de DESIGNER_ALLOWED_ORIGINS):
    // cualquier web abierta en el navegador podría si no hablar con el WS.
    if (!token && !originAllowed(request.headers.origin)) {
      log.warn('conexión rechazada por origin', { origin: request.headers.origin })
      socket.close(4403, 'origin no permitido')
      return
    }
    const connectionId = randomUUID().slice(0, 8)
    const connectionLog = log.child({ connectionId })
    connectionLog.info('cliente conectado')

    session.state().then(
      (state) => sendJson(socket, { type: 'state', state }),
      // Un room file corrupto no puede tirar el proceso entero al conectar.
      (error: unknown) => {
        connectionLog.error('estado inicial ilegible', { error: String(error) })
        sendJson(socket, { type: 'error', error: `estado ilegible: ${String(error)}` })
      },
    )

    socket.on('message', (raw: Buffer) => {
      void handleMessage(raw).catch((error: unknown) => {
        connectionLog.error('mensaje fallido', { error: String(error) })
      })
    })

    async function handleMessage(raw: Buffer): Promise<void> {
      let message: { type?: string; requestId?: string; text?: string; brief?: string; image?: string }
      try {
        const parsed: unknown = JSON.parse(raw.toString('utf8'))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('el mensaje debe ser un objeto')
        }
        message = parsed as typeof message
      } catch (error) {
        sendJson(socket, { type: 'error', error: `mensaje inválido: ${String(error)}` })
        return
      }
      const requestId = sanitize(message.requestId) ?? randomUUID()
      const requestLog = connectionLog.child({ requestId })
      const started = performance.now()

      try {
        if (message.type === 'chat' && typeof message.text === 'string') {
          const result = await session.chat(message.text, requestId)
          metrics.observeRequest('ws chat', 200, performance.now() - started)
          sendJson(socket, { type: 'reply', requestId, ...result })
          // El resto de clientes conectados reciben el estado nuevo: dos
          // pestañas no divergen tras un turno que mutó la habitación.
          if (result.actions.length > 0) {
            for (const client of wss.clients) {
              if (client !== socket) sendJson(client as WebSocket, { type: 'state', state: result.state })
            }
          }
          return
        }
        if (message.type === 'judge' && typeof message.image === 'string') {
          const base64 = message.image.replace(/^data:image\/\w+;base64,/, '')
          // La evidencia se persiste ANTES de juzgar: local en carpeta,
          // en cloud al bucket GCS — cada veredicto es auditable.
          let evidence = 'no-guardado'
          try {
            evidence = await screenshots.save(requestId, Buffer.from(base64, 'base64'))
          } catch (error) {
            requestLog.warn('screenshot no persistido', { error: String(error) })
          }
          const verdict = await session.judge(message.brief ?? '', base64)
          metrics.observeRequest('ws judge', 200, performance.now() - started)
          requestLog.info('veredicto del juez', { ...verdict, notes: undefined, evidence })
          sendJson(socket, { type: 'judge.result', requestId, verdict, evidence })
          return
        }
        sendJson(socket, { type: 'error', requestId, error: `tipo de mensaje desconocido: ${message.type}` })
      } catch (error) {
        metrics.observeRequest(`ws ${message.type}`, 500, performance.now() - started)
        requestLog.error('turno fallido', { error: String(error) })
        sendJson(socket, { type: 'error', requestId, error: String(error) })
      }
    }
  })

  const port = options?.port ?? Number(process.env.DESIGNER_PORT ?? 8790)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => resolve())
  })
  const address = server.address()
  const boundPort = typeof address === 'object' && address ? address.port : port
  log.info('designer escuchando', { port: boundPort, catalog: catalog.count() })

  return {
    port: boundPort,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of wss.clients) client.terminate()
        wss.close(() => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }),
  }
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

/** Sin token: solo orígenes locales o los listados en DESIGNER_ALLOWED_ORIGINS. */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true // clientes no-navegador (tests, curl, wscat)
  const extra = (process.env.DESIGNER_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim())
  if (extra.includes(origin)) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

function sanitize(value: string | undefined): string | undefined {
  return value?.slice(0, 64).replace(/[^\w.-]/g, '') || undefined
}

// Arranque directo; en tests solo se importa.
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const log = new Logger('catalog-designer')
  const started = await startDesignerServer({ logger: log })
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
