Feature: 3D-first editing
  La habitación se crea desde un menú (forma + medidas) y todo se edita
  directamente en la escena 3D: pinchar para seleccionar, arrastrar para mover,
  soltar/clic fuera para fijar. Puertas y ventanas se deslizan por su pared.

  Scenario: Create a rectangular room from the menu
    Given the room creation menu
    When I create a rectangular room of 4 by 3 meters with height 2.6
    Then the plan has 4 walls of height 2.6
    And the floor area is 12 square meters

  Scenario: Create an L-shaped room from the menu
    Given the room creation menu
    When I create an L-shaped room of 5 by 4 meters with a 2 by 1.5 cut
    Then the plan has 6 walls
    And the floor area is 17 square meters

  Scenario: Dragging a window slides it along its wall
    Given a room with a window on a 5-meter wall
    When I drag the window towards the middle of the wall
    Then the window offset follows the drag position

  Scenario: A dragged window stops at the end of its wall
    Given a room with a window on a 5-meter wall
    When I drag the window past the end of the wall
    Then the window stays clamped inside the wall

  Scenario: A window cannot be dropped over a door
    Given a room with a door and a window on the same wall
    When I try to drop the window over the door
    Then the drop is marked invalid
    And the window keeps its previous position

  Scenario: Moving an opening is undoable
    Given a room with a window on a 5-meter wall
    When I move the window through the command stack
    And I undo
    Then the window returns to its original offset

  Scenario: Dropping furniture over a surface stacks it
    Given a room with a table
    When I drop a vase over the table
    Then the vase rests on top of the table

  Scenario: Dropping stacked furniture on empty floor releases it
    Given a room with a vase on a table
    When I drop the vase over empty floor
    Then the vase rests on the floor
    And the vase is not supported by anything
