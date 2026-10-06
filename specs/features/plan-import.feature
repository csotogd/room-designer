Feature: Import a 2D floor plan image into an editable 3D room
  Una foto o dibujo de un plano 2D se convierte en un borrador editable:
  un parser de visión (VLM intercambiable, con doble determinista para tests)
  extrae el contorno y las aperturas, el dominio normaliza la geometría
  (ejes, cierres, escala, límites) y el asistente de creación existente
  permite corregirlo todo antes de generar la habitación 3D. Las medidas
  estimadas se declaran como tales hasta que el usuario confirme una longitud.

  Scenario: A floor plan image becomes an editable room draft
    Given a floor plan image and a plan parser
    When the image is imported
    Then the draft contains the detected walls and openings ready to edit
    And the user can correct them in the creation wizard before building 3D

  Scenario: Detected walls are normalized into a closed straight contour
    Given a parsed plan with slightly tilted walls and a small gap
    When the plan is normalized
    Then near-axis walls become exactly horizontal or vertical
    And the contour closes into a valid polygon within the room size limits

  Scenario: Plan measurements stay marked as estimated until confirmed
    Given a plan whose drawing carries no scale reference
    When the draft is created
    Then its measurements are presented as estimated, not verified

  Scenario: A plan the parser cannot read fails with a clear reason
    Given an image that does not contain a readable floor plan
    When the import is attempted
    Then the user gets a clear error instead of a broken room
