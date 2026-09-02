Feature: Light points
  Las luces son objetos de dominio que el usuario coloca: plafones de techo,
  apliques de pared y lámparas de pie/mesa, con intensidad y temperatura de color.
  Además existe un sol con hora del día.

  Scenario: Place a ceiling light
    Given a project with a rectangular room of 5 by 4 meters
    When I place a ceiling light at (2.5, 2)
    Then the project has 1 light
    And the light elevation equals the ceiling height

  Scenario: Place a floor lamp
    Given a project with a rectangular room of 5 by 4 meters
    When I place a floor lamp at (1, 1) with height 1.5
    Then the light elevation is 1.5

  Scenario: Toggle a light on and off
    Given a project with a ceiling light at (2.5, 2)
    When I turn the light off
    Then the light is off

  Scenario: Set light intensity and color temperature
    Given a project with a ceiling light at (2.5, 2)
    When I set the light intensity to 0.4 and temperature to 2700
    Then the light intensity is 0.4
    And the light temperature is 2700 kelvin

  Scenario: Color temperature is clamped to a realistic range
    Given a project with a ceiling light at (2.5, 2)
    When I set the light temperature to 99999
    Then the light temperature is 6500 kelvin

  Scenario: The sun has a time of day
    Given a project with a rectangular room of 5 by 4 meters
    When I set the time of day to 18
    Then the sun altitude is lower than at noon
