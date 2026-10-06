import { describe, expect, test, vi } from 'vitest'
import { planFromDraft, planParseEndpoint, parsePlanImage, type ParsedPlanDraft } from '../../src/app/importers/PlanImport'

const draft = (overrides: Partial<ParsedPlanDraft> = {}): ParsedPlanDraft => ({
  corners: [[0, 0], [6, 0], [6, 4.5], [3.5, 4.5], [3.5, 3], [0, 3]],
  height: 2.5,
  openings: [
    { wall: 5, offset: 1.1, width: 0.9, kind: 'door' },
    { wall: 0, offset: 2.4, width: 1.4, kind: 'window' },
  ],
  scaleEstimated: true,
  confidence: 0.9,
  notes: 'Parser determinista de test, sin VLM.',
  dropped: [],
  ...overrides,
})

describe('planFromDraft', () => {
  test('builds the same editable FloorPlan the wizard produces', () => {
    const imported = planFromDraft(draft())
    expect(imported.plan.walls).toHaveLength(6)
    expect(imported.plan.openings()).toHaveLength(2)
    expect(imported.plan.openings().map((o) => o.kind).sort()).toEqual(['door', 'window'])
    expect(imported.estimated).toBe(true)
    expect(imported.skipped).toHaveLength(0)
  })

  test('an opening that does not fit is skipped with its reason, not fatal', () => {
    const colliding = draft({
      openings: [
        { wall: 0, offset: 2.4, width: 1.4, kind: 'window' },
        { wall: 0, offset: 2.5, width: 1.4, kind: 'window' },
      ],
    })
    const imported = planFromDraft(colliding)
    expect(imported.plan.openings()).toHaveLength(1)
    expect(imported.skipped.join(' ')).toContain('pared 1')
  })

  test('backend drop notes travel with the draft', () => {
    const imported = planFromDraft(draft({ dropped: ['Apertura en una pared inexistente (9), descartada'] }))
    expect(imported.skipped[0]).toContain('pared inexistente')
  })
})

describe('planParseEndpoint', () => {
  test('derives the http endpoint from the designer websocket url', () => {
    expect(planParseEndpoint('ws://localhost:8790/ws?localPage=abc')).toBe('http://localhost:8790/plan/parse')
    expect(planParseEndpoint('wss://designer.example.com/ws')).toBe('https://designer.example.com/plan/parse')
  })
})

describe('parsePlanImage', () => {
  const ok = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as Response

  test('posts the image and returns the parsed draft', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(draft()))
    const result = await parsePlanImage('http://x/plan/parse', 'data:image/png;base64,AA==', fetchFn)
    expect(result.corners).toHaveLength(6)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('http://x/plan/parse')
    expect(JSON.parse((init as RequestInit).body as string).image).toContain('data:image/png')
  })

  test('surfaces the backend reason when the plan is unreadable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'La imagen no contiene un plano reconocible' }),
    } as Response)
    await expect(parsePlanImage('http://x', 'data:,', fetchFn)).rejects.toThrow('plano reconocible')
  })

  test('a dead service fails with a human message, not a TypeError', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(parsePlanImage('http://x', 'data:,', fetchFn)).rejects.toThrow('no está disponible')
  })
})
