import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

export interface TrackedTask {
  id: string
  title: string
  description: string
  owner: string
  status: 'todo' | 'progress' | 'done'
  priority: 'high' | 'medium' | 'low'
  updatedAt: string
}

export interface TrackerDocument { version: number; tasks: TrackedTask[] }
export interface Tracker {
  tasks: TrackedTask[]
  storageError: boolean
  save(task: TrackedTask): void
  snapshot(): TrackerDocument
}

export function trackerHtml(): string {
  return readFileSync('tablero.html', 'utf8')
}

export function trackerConstructor(): new (
  initial: TrackerDocument,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
) => Tracker {
  const source = trackerHtml().match(/<script id="tracker-core">([\s\S]*?)<\/script>/)![1]!
  return runInNewContext(`${source}\nTaskTracker`)
}

export function memoryStorage() {
  let value: string | null = null
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next } }
}

export function task(changes: Partial<TrackedTask> = {}): TrackedTask {
  return {
    id: 'RD-001', title: 'Crear tablero', description: 'Validar el flujo completo.',
    owner: 'Codex', status: 'todo', priority: 'high', updatedAt: '2026-09-12T10:00:00.000Z',
    ...changes,
  }
}
