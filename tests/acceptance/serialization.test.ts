import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { Door } from '../../src/core/model/Door'
import { CeilingLight } from '../../src/core/model/LightPoint'
import { DefaultCatalog } from '../../src/app/catalog/DefaultCatalog'
import {
  serializeProject,
  deserializeProject,
  UnsupportedVersionError,
  SCHEMA_VERSION,
} from '../../src/app/serialization/ProjectSerializer'

const catalog = new DefaultCatalog()

function sampleProject(): Project {
  const p = new Project(FloorPlan.rectangle(5, 4))
  p.floorPlan.walls[0]!.addOpening(new Door(1, 0.9))
  const table = p.placeFurniture(catalog.get('table'), 2, 2)
  p.placeOnTop(catalog.get('vase'), table)
  p.addLight(new CeilingLight(2.5, 2, p.ceilingHeight))
  return p
}

feature('Save and load projects', () => {
  scenario('A project round-trips through JSON', () => {
    const original = sampleProject()
    const doc = serializeProject(original)
    const loaded = deserializeProject(JSON.parse(JSON.stringify(doc)), catalog)
    expect(serializeProject(loaded)).toEqual(serializeProject(original))
  })

  scenario('Serialized documents carry a schema version', () => {
    const doc = serializeProject(sampleProject())
    expect(doc.version).toBe(SCHEMA_VERSION)
  })

  scenario('Loading a document with an unknown version fails clearly', () => {
    const doc = { ...serializeProject(sampleProject()), version: 999 }
    expect(() => deserializeProject(doc, catalog)).toThrow(UnsupportedVersionError)
  })
})
