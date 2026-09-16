// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { AgentActivityPanel } from '../../src/ui/panels/AgentActivityPanel'

test('conserva el texto completo y los datos como texto seguro al desplegar', () => {
  const panel = new AgentActivityPanel(document)
  document.body.replaceChildren(panel.element)
  panel.append({ kind: 'thinking', agent: 'Diseñador', text: '<img src=x onerror=alert(1)> resumen' })
  panel.append({ kind: 'tool_call', agent: 'Diseñador', tool: 'move_furniture', data: { uid: 'a', x: 2 } })
  panel.append({ kind: 'tool_result', agent: 'Diseñador', tool: 'move_furniture', data: { status: 'success' } })
  expect(panel.element.querySelector('img')).toBeNull()
  expect(panel.element.textContent).toContain('<img src=x onerror=alert(1)> resumen')
  expect(panel.element.textContent).toContain('"uid": "a"')
  expect(panel.element.textContent).toContain('"status": "success"')
  panel.finish('Finalizado')
  expect(panel.element.textContent).toContain('Finalizado')
  expect(panel.element.id).toBe('')
})

test('presenta cada intervención con su agente y mantiene los datos técnicos plegados', () => {
  const panel = new AgentActivityPanel(document)
  for (const agent of ['Diseñador', 'Juez', 'Selector de muebles', 'Agente · Estudio']) {
    panel.append({ kind: 'thinking', agent, text: 'Dejo libre el paso de la puerta.' })
  }
  panel.append({ kind: 'tool_call', agent: 'Agente · Estudio', tool: 'move_furniture', data: { uid: 'a', x: 2 } })
  expect([...panel.element.querySelectorAll('.activity-agent')].map((el) => el.textContent)).toEqual([
    'Diseñador', 'Juez', 'Selector de muebles', 'Agente · Estudio', 'Agente · Estudio',
  ])
  expect(panel.element.textContent).toContain('Mover un mueble')
  const technical = panel.element.querySelector<HTMLDetailsElement>('.activity-data')!
  expect(technical.open).toBe(false)
  expect(technical.querySelector('summary')!.textContent).toBe('Ver detalles de la acción')
  expect(technical.textContent).toContain('"x": 2')
})

test.each([
  ['get_room', 'Consultar la habitación'], ['search_catalog', 'Buscar muebles'],
  ['set_room', 'Ajustar la habitación'], ['add_opening', 'Añadir una puerta o ventana'],
  ['clear_openings', 'Retirar puertas y ventanas'], ['place_furniture', 'Colocar un mueble'],
  ['replace_furniture', 'Sustituir un mueble'], ['rotate_furniture', 'Girar un mueble'],
  ['remove_furniture', 'Retirar un mueble'], ['apply_furniture_changes', 'Aplicar varios cambios'],
  ['respond_conversationally', 'Preparar una respuesta'], ['set_zones', 'Distribuir las zonas'],
  ['furnish_zones', 'Amueblar las zonas'],
])('explica %s con un nombre legible', (tool, label) => {
  const panel = new AgentActivityPanel(document)
  panel.append({ kind: 'tool_call', agent: 'Diseñador', tool, data: {} })
  expect(panel.element.querySelector('.activity-text')!.textContent).toBe(label)
})

test('la propia flecha muestra Pensando y los mensajes nunca la abren automáticamente', () => {
  const panel = new AgentActivityPanel(document)
  const details = panel.element.querySelector('details')!
  expect(details.querySelector('summary')!.textContent).toBe('Pensando…')
  panel.append({ kind: 'thinking', agent: 'Juez', text: 'Evalúo el acceso.' })
  expect(details.open).toBe(false)
  panel.finish('Finalizado')
  expect(details.querySelector('summary')!.textContent).toBe('Ver pensamiento')
  expect(details.open).toBe(false)
})

test('el estado del amueblado se actualiza dentro del desplegable sin reemplazarlo', () => {
  const panel = new AgentActivityPanel(document)
  panel.updateStatus('Amueblando dos zonas en paralelo…')
  const details = panel.element.querySelector('details')!
  expect(details.open).toBe(false)
  expect(details.textContent).toContain('Amueblando dos zonas en paralelo…')
  expect(details.querySelector('summary')!.textContent).toBe('Pensando…')
})
