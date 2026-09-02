Feature: Furniture placement and stacking
  Los muebles tienen posición 3D (x, z en planta, y = elevación), rotación sobre el
  eje vertical, y pueden apoyarse unos sobre otros (supportedBy).

  Scenario: Place furniture on the floor
    Given a project with a rectangular room of 5 by 4 meters
    When I place a "sofa" at (2, 1)
    Then the project has 1 furniture item
    And the "sofa" elevation is 0

  Scenario: Rotate a furniture item
    Given a project with a "sofa" at (2, 1)
    When I rotate the "sofa" to 90 degrees
    Then the "sofa" rotation is 90 degrees

  Scenario: Place a vase on top of a table
    Given a project with a "table" at (2, 2)
    When I place a "vase" on top of the "table"
    Then the "vase" elevation equals the "table" height
    And the "vase" is supported by the "table"

  Scenario: Moving the table moves the vase with it
    Given a project with a "vase" on a "table" at (2, 2)
    When I move the "table" to (4, 3)
    Then the "vase" position in plan is (4, 3)

  Scenario: Deleting the table drops the vase to the floor
    Given a project with a "vase" on a "table" at (2, 2)
    When I remove the "table"
    Then the "vase" elevation is 0
    And the "vase" is not supported by anything

  Scenario: Only surfaces accept items on top
    Given a project with a "rug" at (1, 1)
    Then placing a "vase" on top of the "rug" is rejected
