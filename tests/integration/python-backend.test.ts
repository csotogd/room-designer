import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { DesignerClient, type DesignerReply } from '../../src/app/designer/DesignerClient'
import { SearchClient } from '../../src/app/search/SearchClient'
import type { DesignerRoomState, DesignerVerdict } from '../../src/app/designer/actions'

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
  test('SearchClient consumes the Python HTTP contract and degrades on unavailable service', async () => {
    const scores = await new SearchClient(`http://127.0.0.1:${ports.searchPort}`).rank('office chair')
    expect(scores?.get('chair-1')).toBeGreaterThan(0)
    expect(await new SearchClient('http://127.0.0.1:9').rank('chair')).toBeNull()
  })

  test('DesignerClient receives state, tool actions, a real PNG verdict and persisted state', async () => {
    let state: DesignerRoomState | undefined
    let reply: DesignerReply | undefined
    let verdict: DesignerVerdict | undefined
    const errors: string[] = []
    const client = new DesignerClient({
      onState: (value) => { state = value }, onReply: (value) => { reply = value },
      onVerdict: (_id, value) => { verdict = value }, onError: (error) => errors.push(error), onConnection: () => {},
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
      client.judge('silla', `data:image/png;base64,${png.toString('base64')}`)
      await until(() => verdict !== undefined)
      expect(verdict!.overall).toBe(7)
      const saved = await fetch(`http://127.0.0.1:${ports.designerPort}/state`).then((r) => r.json())
      expect(saved.items).toEqual(reply!.state.items)
    } finally {
      client.close()
    }
  })
})
