import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { DesignerClient, type DesignerReply } from '../../src/app/designer/DesignerClient'
import { SearchClient } from '../../src/app/search/SearchClient'
import type { DesignerJudgement, DesignerRoomState, EditResult } from '../../src/app/designer/actions'
import { sceneFromState } from '../../src/app/designer/scene'

const directory = mkdtempSync(join(tmpdir(), 'python-designer-'))
let server: ChildProcess
let ports: { searchPort: number; designerPort: number }
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function pythonExecutable(): string {
  if (process.env.PYTHON) return process.env.PYTHON
  // Stryker runs from a sandbox under the repo; the venv stays at the repo root.
  let directory = process.cwd()
  for (;;) {
    const candidate = join(directory, '.venv/bin/python')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) throw new Error('Create the Python .venv before running integration tests')
    directory = parent
  }
}

beforeAll(async () => {
  server = spawn(pythonExecutable(), ['-u', 'backend/tests/serve_fixture.py', directory])
  let output = ''
  let errors = ''
  server.stderr!.on('data', (data) => { errors += String(data) })
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.on('exit', (code) => { if (!ports) reject(new Error(`Python fixture exited ${code}: ${errors}`)) })
    server.stdout!.on('data', (data) => {
      output += String(data)
      if (output.includes('\n') && !ports) {
        try { ports = JSON.parse(output.split('\n')[0]!); resolve() } catch (error) { reject(error) }
      }
    })
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const health = await fetch(`http://127.0.0.1:${ports.designerPort}/healthz`)
      if (health.ok) return
    } catch { /* wait for ASGI startup */ }
    await delay(30)
  }
  throw new Error(`Python fixture failed to start: ${errors}`)
}, 15000)

afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
    server.kill('SIGTERM')
    await exited
  }
  rmSync(directory, { recursive: true, force: true })
})

describe('TypeScript clients against Python + real ADK tools', () => {
  test('manual edits persist over the socket and reach the next real ADK turn', async () => {
    let state: DesignerRoomState | undefined
    let ack: EditResult | undefined
    let reply: DesignerReply | undefined
    const errors: string[] = []
    const client = new DesignerClient({
      onState: (value) => { state = value }, onEdit: (value) => { ack = value },
      onReply: (value) => { reply = value }, onJudgement: () => {},
      onError: (error) => errors.push(error), onConnection: () => {},
    }, `ws://127.0.0.1:${ports.designerPort}/ws`)
    async function until(condition: () => boolean) {
      for (let i = 0; i < 200 && !condition() && !errors.length; i++) await delay(20)
      expect(errors).toEqual([])
      expect(condition()).toBe(true)
    }
    try {
      await until(() => !!state)
      const base = sceneFromState(state!)
      const room = sceneFromState({ room: { shape: 'rect', w: 5, d: 4, h: 2.6 },
        openings: [], items: [{ uid: 'manual-chair', productId: 'chair-1', x: 1, y: 0, z: 1, rotDeg: 0 }] })
      client.edit({ requestId: 'manual-create', baseRevision: state!.revision ?? null, base, desired: room })
      await until(() => ack?.requestId === 'manual-create')
      expect(ack!.type).toBe('edit.result')
      const desired = structuredClone(room)
      desired.items[0]!.x = 2.25
      desired.items[0]!.y = .4
      desired.items[0]!.rotDeg = 45
      desired.environment.timeOfDay = 18
      client.edit({ requestId: 'manual-drag', baseRevision: ack!.state.revision!, base: room, desired })
      await until(() => ack?.requestId === 'manual-drag')
      expect(ack!.type).toBe('edit.result')
      expect(sceneFromState(ack!.state)).toEqual(desired)
      const revision = ack!.state.revision!
      client.chat('Describe la habitación actual', revision)
      await until(() => !!reply)
      expect(sceneFromState(reply!.state)).toEqual(desired)
      expect(reply!.actions).toEqual([])
      const saved = await fetch(`http://127.0.0.1:${ports.designerPort}/state`).then((r) => r.json())
      expect(sceneFromState(saved)).toEqual(desired)
    } finally { client.close() }
  })

  test('the complete judge-agent loop crosses a score plateau and stops at the mean target', async () => {
    const replies: DesignerReply[] = []
    const grades: DesignerJudgement[] = []
    const errors: string[] = []
    let ready = false
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toBuffer()
    const image = `data:image/png;base64,${png.toString('base64')}`
    const client = new DesignerClient({
      onState: () => { ready = true },
      onReply: (value) => { replies.push(value); client.judge(image, value.evaluation) },
      onJudgement: (value) => grades.push(value), onError: (error) => errors.push(error), onConnection: () => {},
    }, `ws://127.0.0.1:${ports.designerPort}/ws`)
    try {
      for (let i = 0; i < 100 && !ready; i++) await delay(20)
      expect(ready).toBe(true)
      client.chat('añade una silla — prueba del bucle')
      for (let i = 0; i < 300 && grades.at(-1)?.refining !== false && !errors.length; i++) await delay(20)
      expect(errors).toEqual([])
      expect(grades.map((grade) => grade.mean)).toEqual([5, 5, 5, 7.5])
      expect(replies.map((reply) => reply.round)).toEqual([0, 1, 2, 3])
      expect(new Set(replies.map((reply) => reply.runId)).size).toBe(1)
      expect(new Set(replies.map((reply) => reply.evaluation.revision)).size).toBe(4)
      expect(grades.at(-1)?.stopReason).toContain('objetivo alcanzado')
      const saved = await fetch(`http://127.0.0.1:${ports.designerPort}/state`).then((r) => r.json())
      expect(saved.verdict.mean).toBe(7.5)
      expect(saved.conversation.some((turn: { role: string }) => turn.role === 'judge')).toBe(true)
    } finally { client.close() }
  })

  test('SearchClient consumes the Python HTTP contract and degrades on unavailable service', async () => {
    const scores = await new SearchClient(`http://127.0.0.1:${ports.searchPort}`).rank('office chair')
    expect(scores?.get('chair-1')).toBeGreaterThan(0)
    expect(await new SearchClient('http://127.0.0.1:9').rank('chair')).toBeNull()
  })

  test('DesignerClient receives state, tool actions, a real PNG verdict and persisted state', async () => {
    let state: DesignerRoomState | undefined
    let reply: DesignerReply | undefined
    let judgement: DesignerJudgement | undefined
    const errors: string[] = []
    const client = new DesignerClient({
      onState: (value) => { state = value }, onReply: (value) => { reply = value },
      onJudgement: (value) => { judgement = value }, onError: (error) => errors.push(error), onConnection: () => {},
    }, `ws://127.0.0.1:${ports.designerPort}/ws`)
    async function until(condition: () => boolean) {
      for (let i = 0; i < 200 && !condition(); i++) await delay(20)
      expect(errors).toEqual([])
      expect(condition()).toBe(true)
    }
    try {
      await until(() => state !== undefined)
      const requestId = client.chat('añade una silla')
      await until(() => reply !== undefined)
      expect(reply!.requestId).toBe(requestId)
      expect(reply!.actions.some((action) => action.kind === 'placeNew')).toBe(true)
      const sharp = (await import('sharp')).default
      const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toBuffer()
      client.judge(`data:image/png;base64,${png.toString('base64')}`, reply!.evaluation)
      await until(() => judgement !== undefined)
      expect(judgement!.verdict.overall).toBe(7)
      expect(judgement!.mean).toBe(7)
      // ConstantJudge da 7 = objetivo: el bucle para por nota alcanzada.
      expect(judgement!.refining).toBe(false)
      expect(judgement!.stopReason).toContain('objetivo')
      const saved = await fetch(`http://127.0.0.1:${ports.designerPort}/state`).then((r) => r.json())
      expect(saved.items).toEqual(reply!.state.items)
    } finally {
      client.close()
    }
  })
})
