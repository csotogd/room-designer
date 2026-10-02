import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { memoryStorage, task, trackerConstructor } from '../helpers/task-tracker'

feature('Local project task tracker', () => {
  scenario('Keep tasks usable when local storage cannot be read or written', () => {
    const Tracker = trackerConstructor()
    const storage = {
      getItem: () => { throw new Error('Storage denied') },
      setItem: () => { throw new Error('Storage denied') },
    }
    const tracker = new Tracker({ version: 1, tasks: [task()] }, storage)
    tracker.save(task({ id: 'RD-002' }))
    expect(tracker.snapshot().tasks.map(item => item.id)).toEqual(['RD-001', 'RD-002'])
    expect(tracker.storageError).toBe(true)
  })

  scenario('Track a task from pending to done across sessions', () => {
    const Tracker = trackerConstructor()
    const storage = memoryStorage()
    const tracker = new Tracker({ version: 1, tasks: [] }, storage)
    tracker.save(task())
    tracker.save(task({ status: 'progress', updatedAt: '2026-09-12T11:00:00.000Z' }))

    const reopened = new Tracker({ version: 1, tasks: [] }, storage)
    expect(reopened.tasks[0]?.status).toBe('progress')
    reopened.save({ ...reopened.tasks[0]!, status: 'done', updatedAt: '2026-09-12T12:00:00.000Z' })

    expect(new Tracker({ version: 1, tasks: [] }, storage).tasks).toEqual([
      task({ status: 'done', updatedAt: '2026-09-12T12:00:00.000Z' }),
    ])
  })

  scenario('Reconcile repository updates with local task edits', () => {
    const Tracker = trackerConstructor()
    const storage = memoryStorage()
    const tracker = new Tracker({ version: 1, tasks: [task()] }, storage)
    tracker.save(task({ status: 'progress', updatedAt: '2026-09-12T11:00:00.000Z' }))
    tracker.save(task({ id: 'RD-LOCAL', title: 'Revisar accesibilidad' }))

    const latest = task({ status: 'done', updatedAt: '2026-09-12T12:00:00.000Z' })
    const reopened = new Tracker({ version: 1, tasks: [latest] }, storage)
    expect(reopened.tasks).toEqual([latest, task({ id: 'RD-LOCAL', title: 'Revisar accesibilidad' })])
  })
})
