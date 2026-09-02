Feature: Doors and windows
  Las aperturas viven paramétricamente en su pared: offset a lo largo de la pared,
  ancho, alto y altura de antepecho. Se mueven con la pared.

  Scenario: Place a door on a wall
    Given a wall from (0,0) to (5,0)
    When I place a door at offset 1 with width 0.9
    Then the wall has 1 opening
    And the door world position is at (1.45, 0)

  Scenario: Place a window with sill height
    Given a wall from (0,0) to (5,0)
    When I place a window at offset 2 with width 1.2 and sill 0.9
    Then the wall has 1 opening
    And the window sill height is 0.9

  Scenario: An opening cannot extend beyond its wall
    Given a wall from (0,0) to (5,0)
    Then placing a door at offset 4.5 with width 0.9 is rejected

  Scenario: Openings cannot overlap on the same wall
    Given a wall from (0,0) to (5,0)
    And a door at offset 1 with width 0.9
    Then placing a window at offset 1.5 with width 1.2 is rejected

  Scenario: Openings follow their wall when it moves
    Given a wall from (0,0) to (5,0)
    And a door at offset 1 with width 0.9
    When I move the wall to run from (0,0) to (0,5)
    Then the door world position is at (0, 1.45)
