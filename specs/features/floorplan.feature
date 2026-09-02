Feature: Floor plan editing
  El plano 2D es la fuente de verdad: paredes como segmentos con grosor y altura,
  de las que se deriva el suelo.

  Scenario: Add a wall to the plan
    Given an empty floor plan
    When I add a wall from (0,0) to (5,0)
    Then the plan has 1 wall
    And that wall has length 5

  Scenario: Walls connected at a corner share the endpoint
    Given an empty floor plan
    When I add a wall from (0,0) to (5,0)
    And I add a wall from (5,0) to (5,4)
    Then the plan has 2 walls
    And the walls are connected at (5,0)

  Scenario: A closed wall loop produces the floor polygon
    Given a rectangular room of 5 by 4 meters
    Then the floor polygon has 4 vertices
    And the floor area is 20 square meters

  Scenario: Removing a wall removes its openings
    Given a rectangular room of 5 by 4 meters
    And a door on the first wall at offset 1
    When I remove the first wall
    Then the plan has 3 walls
    And the plan has no openings

  Scenario: Moving a wall endpoint updates its length
    Given an empty floor plan
    And a wall from (0,0) to (5,0)
    When I move the wall end to (10,0)
    Then that wall has length 10
