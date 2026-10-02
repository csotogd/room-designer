// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, vi } from 'vitest'
import { scenario } from './gherkin'
import type { DesignerEvents } from '../../src/app/designer/DesignerClient'
import { App } from '../../src/ui/App'
import { mockCanvas } from '../helpers/canvas'

const connection = vi.hoisted(() => ({ events: null as DesignerEvents | null, chat: vi.fn(() => 'idea-1') }))
vi.mock('../../src/app/designer/DesignerClient', () => ({ DesignerClient: class {
  connected = true
  endpoint = 'workspace-entry'
  constructor(events: DesignerEvents) { connection.events = events }
  chat = connection.chat
} }))
vi.mock('../../src/ui/view3d/View3D', () => ({ View3D: class { resize() {} setProject() {} setPlacement() {} clearSelection() {} setZones() {} } }))
afterEach(() => { vi.unstubAllGlobals() })

scenario('A first idea opens the assistant from the floating composer', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }))
  document.body.innerHTML = readFileSync('index.html', 'utf8')
  mockCanvas()
  new App(document, { items: () => [], get: () => { throw new Error('Sin productos') } })
  document.querySelector<HTMLButtonElement>('#wizard-next')!.click()
  document.querySelector<HTMLButtonElement>('#create-room')!.click()
  connection.events!.onConnection(true)
  connection.events!.onState({ version: 1, revision: 'initial',
    room: { shape: 'rect', w: 4.5, d: 3.5, h: 2.5 }, items: [], openings: [] })
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!

  expect(el('#modal-backdrop').hidden).toBe(true)
  expect(el('#catalog').inert).toBe(true)
  expect(el('#chat').inert).toBe(true)
  expect(el('#prompt-dock').hidden).toBe(false)
  expect(el<HTMLTextAreaElement>('#chat-input').placeholder).toBe('¿Qué quieres construir?')
  el<HTMLTextAreaElement>('#chat-input').value = 'Un salón con madera natural'
  el<HTMLFormElement>('#chat-form').requestSubmit()
  await Promise.resolve()
  expect(connection.chat).toHaveBeenCalledExactlyOnceWith('Un salón con madera natural', 'initial')
  expect(el('#chat').inert).toBe(false)
  expect(el('#chat').contains(el('#chat-input'))).toBe(true)
  expect(el('#prompt-dock').hidden).toBe(true)
  expect(el('#chat-messages').textContent).toContain('Un salón con madera natural')
  el<HTMLTextAreaElement>('#chat-input').value = 'Añade una lámpara'
  el('#chat-toggle').click()
  expect(el('#prompt-dock').contains(el('#chat-input'))).toBe(true)
  expect(el<HTMLTextAreaElement>('#chat-input').value).toBe('Añade una lámpara')
  el('#chat-reopen').click()
  expect(el('#chat-messages').textContent).toContain('Un salón con madera natural')
  expect(document.activeElement).toBe(el('#chat-input'))
})
