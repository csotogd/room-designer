import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Project } from '../../src/core/model/Project'
import { FloorPlan } from '../../src/core/model/FloorPlan'
import { CeilingLight, FloorLamp } from '../../src/core/model/LightPoint'

const room = () => new Project(FloorPlan.rectangle(5, 4))

feature('Light points', () => {
  scenario('Place a ceiling light', () => {
    const p = room()
    p.addLight(new CeilingLight(2.5, 2, p.ceilingHeight))
    expect(p.lights).toHaveLength(1)
    expect(p.lights[0]!.position.y).toBe(p.ceilingHeight)
  })

  scenario('Place a floor lamp', () => {
    const p = room()
    p.addLight(new FloorLamp(1, 1, 1.5))
    expect(p.lights[0]!.position.y).toBe(1.5)
  })

  scenario('Toggle a light on and off', () => {
    const p = room()
    const light = new CeilingLight(2.5, 2, p.ceilingHeight)
    p.addLight(light)
    p.toggleLight(light)
    expect(light.on).toBe(false)
  })

  scenario('Set light intensity and color temperature', () => {
    const p = room()
    const light = new CeilingLight(2.5, 2, p.ceilingHeight)
    p.addLight(light)
    light.setIntensity(0.4)
    light.setTemperature(2700)
    expect(light.intensity).toBe(0.4)
    expect(light.temperatureK).toBe(2700)
  })

  scenario('Color temperature is clamped to a realistic range', () => {
    const light = new CeilingLight(2.5, 2, 2.5)
    light.setTemperature(99999)
    expect(light.temperatureK).toBe(6500)
  })

  scenario('The sun has a time of day', () => {
    const p = room()
    p.setTimeOfDay(12)
    const noon = p.sunAltitude()
    p.setTimeOfDay(18)
    expect(p.sunAltitude()).toBeLessThan(noon)
  })
})
