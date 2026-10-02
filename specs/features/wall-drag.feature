Feature: Direct wall editing
  La habitación se modifica arrastrando sus paredes y esquinas; el contorno
  permanece cerrado y las aperturas siguen perteneciendo a sus paredes.

  Scenario: Drag a wall to expand the room directly
    Given a rectangular room of 5 by 4 meters with a door
    When I drag its right wall outwards by 2 meters
    Then the room is 7 by 4 meters and stays closed
    And the door keeps its identity and width

  Scenario: Drag a wall endpoint to change its length
    Given a rectangular room of 5 by 4 meters
    When I drag the end of the first wall to (6, 0)
    Then that wall is 6 meters long
    And the next wall remains connected to the dragged corner

  Scenario: A wall drag is one undoable gesture
    Given a rectangular room of 5 by 4 meters
    When I preview multiple wall positions and release the pointer
    Then one undo restores the original room and redo restores the final room

  Scenario: Invalid wall drags preserve the last valid room
    Given a room with a door and furniture
    When I drag walls across other walls or make a door or furniture no longer fit
    Then the invalid position is rejected without changing the room

  Scenario: Canceling a wall drag restores the original room
    Given a rectangular room of 5 by 4 meters
    When I start dragging a wall and cancel the gesture
    Then the original room is restored without a history entry

  Scenario: Shape a new room in the top-down creation step
    Given the initial room creation step
    When I drag a wall in the top-down draft plan
    Then the selected wall has visible corner handles and an updated length panel above the shape templates
    And entering an exact length updates the selected wall
    And creating the room opens that floor plan in 3D
    And the workspace has no Edit room action
