import { expect, test } from 'vitest'
import { memoryStorage, task, trackerConstructor } from '../helpers/task-tracker'

test.each(['{broken', '{"version":2,"tasks":[]}', '{"version":1,"tasks":[{}]}'])(
  'unreadable or incompatible local data keeps embedded tasks intact: %s', (value) => {
    const Tracker = trackerConstructor()
    const tracker = new Tracker({ version: 1, tasks: [task()] }, { getItem: () => value, setItem: () => {} })
    expect(tracker.tasks).toEqual([task()])
    expect(tracker.storageError).toBe(true)
  },
)

test('failed writes retain the current task in memory and report the storage failure', () => {
  const Tracker = trackerConstructor()
  const tracker = new Tracker({ version: 1, tasks: [] }, {
    getItem: () => null, setItem: () => { throw new Error('Quota exceeded') },
  })
  tracker.save(task())
  expect(tracker.tasks).toEqual([task()])
  expect(tracker.storageError).toBe(true)
})

test.each([
  { title: '   ' }, { status: 'unknown' }, { priority: 'urgent' },
  { updatedAt: 'tomorrow' }, { owner: null }, { id: '' }, { description: 123 },
])('invalid task records never overwrite the previous revision: %j', (changes) => {
  const Tracker = trackerConstructor()
  const tracker = new Tracker({ version: 1, tasks: [task()] }, memoryStorage())
  expect(() => tracker.save({ ...task(), ...changes } as ReturnType<typeof task>)).toThrow()
  expect(tracker.tasks).toEqual([task()])
})

test('saving a task persists its complete record and replaces its previous revision', () => {
  const Tracker = trackerConstructor()
  const storage = memoryStorage()
  const tracker = new Tracker({ version: 1, tasks: [] }, storage)
  tracker.save(task())
  tracker.save(task({ title: 'Terminar tablero', status: 'done' }))
  expect(tracker.tasks).toEqual([task({ title: 'Terminar tablero', status: 'done' })])
  expect(JSON.parse(storage.getItem()!)).toEqual(tracker.snapshot())
})

test('opening a tracker keeps the newest revision regardless of its source', () => {
  const Tracker = trackerConstructor()
  const storage = memoryStorage()
  const newer = task({ title: 'Edición local', updatedAt: '2026-09-12T12:00:00.000Z' })
  storage.setItem('', JSON.stringify({ version: 1, tasks: [newer] }))
  expect(new Tracker({ version: 1, tasks: [task()] }, storage).tasks).toEqual([newer])
  expect(new Tracker({ version: 1, tasks: [task({ updatedAt: '2026-09-12T13:00:00.000Z' })] }, storage).tasks)
    .toEqual([task({ updatedAt: '2026-09-12T13:00:00.000Z' })])
})
