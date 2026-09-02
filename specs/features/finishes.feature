Feature: Wall and floor finishes
  El usuario elige material y color de paredes y suelo desde un panel
  amigable (chips de material + muestras de color + selector libre).
  Los acabados son parte del proyecto: se deshacen y se guardan.

  Scenario: A project starts with sensible default finishes
    Given a new project
    Then the wall finish is white-ish paint
    And the floor finish is oak wood

  Scenario: Changing the wall finish is undoable
    Given a new project
    When I set the wall finish to sage green stripes through the command stack
    And I undo
    Then the wall finish is white-ish paint again

  Scenario: Changing the floor finish is undoable
    Given a new project
    When I set the floor finish to grey tiles through the command stack
    Then the floor finish is grey tiles

  Scenario: Finishes survive the JSON round-trip
    Given a project with brick walls and carpet floor
    When I serialize the project and load it back
    Then the loaded finishes equal the originals

  Scenario: A version 1 document loads with default finishes
    Given a serialized document with version 1 and no finishes
    Then loading it succeeds with the default finishes
