// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { evaluationHistory } from '../../src/ui/panels/EvaluationHistory'

test('muestra las notas reales en orden y distingue avances de evaluaciones finales', () => {
  const base = { cohesion: 5, colors: 5, style: 5, adherence: 5, overall: 5, mean: 5,
    target: 7, round: 0, at: '2026-09-16T10:00:00Z', notes: 'Faltan asientos.' }
  const history = evaluationHistory(document, [{ ...base, preview: true, step: 1 },
    { ...base, mean: 8, round: 1, notes: 'Mejor distribución.' }], () => {})
  expect(history.textContent).toContain('Avance 1 · 5/10')
  expect(history.textContent).toContain('Ronda 2 · 8/10')
  expect(history.querySelector('svg')!.getAttribute('aria-label')).toContain('5/10 → 8/10')
})
