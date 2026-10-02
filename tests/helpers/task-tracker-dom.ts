import { vi } from 'vitest'
import { trackerHtml } from './task-tracker'

export function openTracker() {
  localStorage.clear()
  document.documentElement.innerHTML = trackerHtml()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const source = ['tracker-core', 'tracker-ui'].map(id => document.getElementById(id)?.textContent ?? '').join('\n')
  window.eval(source)
}

export function field<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Falta el control ${id}`)
  return element as T
}

export function fill(id: string, value: string) {
  const input = field<HTMLInputElement | HTMLSelectElement>(id)
  input.value = value
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}

export function saveForm() {
  field<HTMLFormElement>('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

export async function downloadBoard(): Promise<string> {
  let downloaded: Blob | undefined
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = vi.fn((blob: Blob) => { downloaded = blob; return 'blob:tracker' })
    static override revokeObjectURL = vi.fn()
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  field<HTMLButtonElement>('download-board').click()
  if (!downloaded) throw new Error('No se ha generado la descarga')
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsText(downloaded!)
  })
}
