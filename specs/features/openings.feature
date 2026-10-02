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

  Scenario: Resize a door dynamically and undo the gesture
    Given a door with width 0.9 on a room wall
    When I preview widths of 1.2 and 1.8 meters and finish resizing
    Then the door has width 1.8 and keeps its position and identity
    And one undo restores width 0.9 and redo restores width 1.8

  Scenario: Resizing an opening respects its neighbors and wall ends
    Given a door followed by a window on the same wall
    When I widen the door beyond the available space
    Then the door stops at the window without overlap
    And without the window it stops at the wall end

  Scenario: Custom opening widths survive saving and loading
    Given a room with a resized door and window
    When I save and reload the project
    Then both openings keep their widths and positions

  Scenario: Resize a selected wizard opening without deleting it
    Given a wizard room with a door
    When I select the door and adjust its width control
    Then the preview and created room contain the wider door
