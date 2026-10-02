// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest'
import { field, fill, openTracker, saveForm } from '../helpers/task-tracker-dom'

beforeEach(openTracker)

test('the task form saves a record and the card status control persists a move', () => {
  field<HTMLButtonElement>('new-task').click()
  fill('task-title', 'Comprobar el plano')
  saveForm()
  const card = [...document.querySelectorAll<HTMLElement>('.task-card')]
    .find(element => element.textContent?.includes('Comprobar el plano'))!
  const status = card.querySelector('select')!
  status.value = 'progress'
  status.dispatchEvent(new Event('change', { bubbles: true }))
  expect(document.querySelector('[data-column="progress"] .cards')!.textContent).toContain('Comprobar el plano')
  const saved = JSON.parse(localStorage.getItem('room-designer-tracker-v1')!)
  expect(saved.tasks.find((item: { title: string }) => item.title === 'Comprobar el plano').status).toBe('progress')
})

test('blank titles keep the form open without adding a task', () => {
  const count = document.querySelectorAll('.task-card').length
  field<HTMLButtonElement>('new-task').click()
  fill('task-title', '   ')
  saveForm()
  expect(document.querySelectorAll('.task-card')).toHaveLength(count)
  expect(field<HTMLDialogElement>('task-dialog').open).toBe(true)
  expect(field('form-error').textContent).not.toBe('')
})

test('dropping a task changes its column while unrelated drops are ignored', () => {
  const card = document.querySelector<HTMLElement>('.task-card')!
  const target = document.querySelector<HTMLElement>('[data-column="todo"]')!
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => card.dataset.id } })
  target.dispatchEvent(drop)
  expect(target.querySelector(`[data-id="${card.dataset.id}"]`)).not.toBeNull()
  const count = document.querySelectorAll('.task-card').length
  const unrelated = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(unrelated, 'dataTransfer', { value: { getData: () => 'unknown' } })
  target.dispatchEvent(unrelated)
  expect(document.querySelectorAll('.task-card')).toHaveLength(count)
})
