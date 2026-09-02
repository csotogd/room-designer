Feature: Undo and redo
  Toda mutación pasa por comandos con execute/undo, gestionados por una pila.

  Scenario: Undo removing a placed furniture item
    Given a project with a rectangular room of 5 by 4 meters
    When I place a "sofa" at (2, 1) through the command stack
    And I undo
    Then the project has 0 furniture items

  Scenario: Redo restores the undone command
    Given a project with a rectangular room of 5 by 4 meters
    When I place a "sofa" at (2, 1) through the command stack
    And I undo
    And I redo
    Then the project has 1 furniture item

  Scenario: A new command clears the redo history
    Given a project with a rectangular room of 5 by 4 meters
    When I place a "sofa" at (2, 1) through the command stack
    And I undo
    And I place a "table" at (3, 3) through the command stack
    Then redo is not available
