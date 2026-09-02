import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Wall } from '../../src/core/model/Wall'
import { Door } from '../../src/core/model/Door'
import { Window } from '../../src/core/model/Window'

const wall = () => new Wall(new Point2D(0, 0), new Point2D(5, 0))

feature('Doors and windows', () => {
  scenario('Place a door on a wall', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    expect(w.openings).toHaveLength(1)
    expect(w.worldCenterOf(door).equals(new Point2D(1.45, 0))).toBe(true)
  })

  scenario('Place a window with sill height', () => {
    const w = wall()
    const window = new Window(2, 1.2, 1.1, 0.9)
    w.addOpening(window)
    expect(w.openings).toHaveLength(1)
    expect(window.sillHeight).toBe(0.9)
  })

  scenario('An opening cannot extend beyond its wall', () => {
    expect(() => wall().addOpening(new Door(4.5, 0.9))).toThrow()
  })

  scenario('Openings cannot overlap on the same wall', () => {
    const w = wall()
    w.addOpening(new Door(1, 0.9))
    expect(() => w.addOpening(new Window(1.5, 1.2, 1.1, 0.9))).toThrow()
  })

  scenario('Openings follow their wall when it moves', () => {
    const w = wall()
    const door = new Door(1, 0.9)
    w.addOpening(door)
    w.moveTo(new Point2D(0, 0), new Point2D(0, 5))
    expect(w.worldCenterOf(door).equals(new Point2D(0, 1.45))).toBe(true)
  })
})
