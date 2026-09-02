Feature: Room bounds, creation wizard and shopping cart
  Los muebles no pueden salir de la habitación; el asistente de creación
  permite colocar puertas y ventanas antes de entrar en la escena; y todo lo
  colocado alimenta un carrito de la compra con precios.

  Scenario: Furniture cannot sit outside the room
    Given a 5 by 4 room
    Then a sofa at the center fits in the room
    And a sofa at (10, 10) does not fit in the room

  Scenario: A sofa against the wall must fit entirely, rotation included
    Given a 5 by 4 room
    Then a sofa at (2.5, 0.6) parallel to the wall fits in the room
    And the same sofa rotated 90 degrees does not fit

  Scenario: Dropping furniture outside the room keeps it where it was
    Given a 5 by 4 room with a sofa at (2, 2)
    When I drop the sofa at (9, 9)
    Then the sofa stays at (2, 2)

  Scenario: The wizard places a door on a wall before creating the room
    Given a wizard plan of 5 by 4
    When the wizard adds a door on wall 0 at 1.5 meters
    Then wall 0 has 1 opening

  Scenario: The wizard rejects an opening over another one
    Given a wizard plan of 5 by 4
    When the wizard adds a door on wall 0 at 1.5 meters
    Then adding a window on wall 0 at 1.6 meters is rejected

  Scenario: The wizard clamps openings to the wall ends
    Given a wizard plan of 5 by 4
    When the wizard adds a window on wall 0 at 99 meters
    Then that window ends exactly at the wall end

  Scenario: Placed items appear in the cart grouped with prices
    Given a 5 by 4 room
    When I place 2 chairs and 1 table
    Then the cart has 2 lines
    And the chairs line has quantity 2 and subtotal twice the chair price

  Scenario: The cart total sums furniture and lights
    Given a 5 by 4 room with a table and a ceiling light
    Then the cart total is the table price plus the ceiling light price

  Scenario: Removing an item updates the cart
    Given a 5 by 4 room with a table and a ceiling light
    When I remove the table
    Then the cart has 1 line

  Scenario: Projects persist through the repository port
    Given a repository backed by an in-memory storage
    When I save a project with a table and load it back
    Then the loaded document equals the saved one
