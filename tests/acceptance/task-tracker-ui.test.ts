// @vitest-environment jsdom
import { afterEach, expect, vi } from 'vitest'
import { scenario } from './gherkin'
import { downloadBoard, field, fill, openTracker, saveForm } from '../helpers/task-tracker-dom'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

scenario('Manage tasks and download a portable board', async () => {
  openTracker()
  field<HTMLButtonElement>('new-task').click()
  fill('task-title', 'Revisar el catálogo')
  fill('task-description', 'Verificar las medidas del mobiliario.')
  fill('task-owner', 'Carlos')
  fill('task-priority', 'high')
  saveForm()

  const edit = [...document.querySelectorAll<HTMLButtonElement>('.card-title')]
    .find(button => button.textContent === 'Revisar el catálogo')!
  edit.click()
  fill('task-title', 'Revisar el catálogo </script><img src=x onerror=alert(1)>')
  fill('task-status', 'done')
  saveForm()
  fill('search', 'mobiliario')
  fill('priority-filter', 'high')

  expect(document.querySelectorAll('.task-card')).toHaveLength(1)
  expect(document.querySelector('[data-column="done"] .task-card')?.textContent).toContain('Carlos')
  expect(document.querySelector('.task-card img')).toBeNull()

  const html = await downloadBoard()
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const tasks = JSON.parse(parsed.getElementById('tracker-data')!.textContent!).tasks
  expect(tasks.find((item: { owner: string }) => item.owner === 'Carlos')).toMatchObject({
    title: 'Revisar el catálogo </script><img src=x onerror=alert(1)>',
    status: 'done', priority: 'high', description: 'Verificar las medidas del mobiliario.',
  })
  expect(parsed.querySelector('img')).toBeNull()
  expect(parsed.querySelectorAll('script[src], link[rel="stylesheet"]')).toHaveLength(0)
})
