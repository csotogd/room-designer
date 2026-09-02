import { expect } from 'vitest'
import { feature, scenario } from './gherkin'
import { Point2D } from '../../src/core/geometry/Point2D'
import { Wall } from '../../src/core/model/Wall'
import { Door } from '../../src/core/model/Door'
import { FloorPlan } from '../../src/core/model/FloorPlan'

feature('Floor plan editing', () => {
  scenario('Add a wall to the plan', () => {
    // Given an empty floor plan
    const plan = new FloorPlan()
    // When I add a wall from (0,0) to (5,0)
    plan.addWall(new Wall(new Point2D(0, 0), new Point2D(5, 0)))
    // Then the plan has 1 wall with length 5
    expect(plan.walls).toHaveLength(1)
    expect(plan.walls[0]!.length()).toBe(5)
  })

  scenario('Walls connected at a corner share the endpoint', () => {
    const plan = new FloorPlan()
    plan.addWall(new Wall(new Point2D(0, 0), new Point2D(5, 0)))
    plan.addWall(new Wall(new Point2D(5, 0), new Point2D(5, 4)))
    expect(plan.walls).toHaveLength(2)
    expect(plan.walls[0]!.end.equals(plan.walls[1]!.start)).toBe(true)
  })

  scenario('A closed wall loop produces the floor polygon', () => {
    const plan = FloorPlan.rectangle(5, 4)
    const floor = plan.floorPolygon()
    expect(floor).not.toBeNull()
    expect(floor!.vertices).toHaveLength(4)
    expect(floor!.area()).toBeCloseTo(20)
  })

  scenario('Removing a wall removes its openings', () => {
    const plan = FloorPlan.rectangle(5, 4)
    const first = plan.walls[0]!
    first.addOpening(new Door(1, 0.9))
    plan.removeWall(first)
    expect(plan.walls).toHaveLength(3)
    expect(plan.openings()).toHaveLength(0)
  })

  scenario('Moving a wall endpoint updates its length', () => {
    const plan = new FloorPlan()
    const wall = new Wall(new Point2D(0, 0), new Point2D(5, 0))
    plan.addWall(wall)
    wall.moveTo(wall.start, new Point2D(10, 0))
    expect(wall.length()).toBe(10)
  })
})
