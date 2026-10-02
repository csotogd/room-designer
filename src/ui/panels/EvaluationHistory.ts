import type { DesignerScore } from '../../app/designer/actions'

export function evaluationHistory(root: Document, scores: readonly DesignerScore[],
  details: (parent: HTMLElement, score: DesignerScore) => void): HTMLElement {
  const section = root.createElement('section')
  section.className = 'evaluation-history'
  const title = root.createElement('strong')
  title.textContent = 'Evolución de las notas'
  section.append(title)
  const grade = (value: number) => String(Math.round(value * 1000) / 1000)
  const svg = root.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 280 72')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Evolución: ${scores.map(s => `${grade(s.mean)}/10`).join(' → ')}`)
  const positions = scores.map((score, index) => ({
    x: scores.length === 1 ? 140 : 12 + index * 256 / (scores.length - 1), y: 64 - score.mean * 5.6,
  }))
  const line = root.createElementNS(svg.namespaceURI, 'polyline')
  line.setAttribute('points', positions.map(p => `${p.x},${p.y}`).join(' '))
  line.setAttribute('fill', 'none')
  line.setAttribute('stroke', 'currentColor')
  line.setAttribute('stroke-width', '2')
  svg.append(line)
  for (const point of positions) {
    const dot = root.createElementNS(svg.namespaceURI, 'circle')
    dot.setAttribute('cx', String(point.x)); dot.setAttribute('cy', String(point.y))
    dot.setAttribute('r', '3.5'); dot.setAttribute('fill', 'currentColor')
    svg.append(dot)
  }
  section.append(svg)
  const history = root.createElement('details')
  const summary = root.createElement('summary')
  summary.textContent = `Ver ${scores.length} evaluaciones`
  history.append(summary)
  for (const score of scores) {
    const row = root.createElement('div')
    row.className = 'evaluation-row'
    const label = root.createElement('strong')
    label.textContent = `${score.preview ? `Avance ${score.step}` : `Ronda ${(score.round ?? 0) + 1}`} · ${grade(score.mean)}/10`
    const notes = root.createElement('p')
    notes.textContent = score.notes
    row.append(label)
    details(row, score)
    row.append(notes)
    history.append(row)
  }
  section.append(history)
  return section
}
