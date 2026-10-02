Feature: Rooms with custom shapes and sizes
  El asistente permite partir de distintos tamaños y ajustar plantas con
  entrantes o paredes diagonales, mostrando la superficie antes de crear.

  Scenario: Create rooms with rectangular, L, U, T and beveled floor plans
    Given room dimensions of 8 by 6 meters and a height of 3 meters
    When I choose each available shape with a 2 by 2 meter detail
    Then each plan forms a closed floor with the chosen shape and height

  Scenario: Create small and large rooms with exact dimensions
    When I create rooms measuring 1 by 2 and 30 by 20 meters
    Then their floor areas are 2 and 600 square meters

  Scenario: Reject invalid room dimensions and cutouts
    When room dimensions are outside the supported range or a cutout consumes the room
    Then the wizard rejects the plan with an explanation

  Scenario: Preview a room size and shape before continuing
    Given the room creation dialog
    When I choose the large size and the U shape
    Then the dimensions and interactive draft plan update before I continue

  Scenario: Keep openings when returning to unchanged room dimensions
    Given a wizard room with a door
    When I go back to the dimensions and continue without changing them
    Then the door is still in the plan

  Scenario: Furniture cannot bridge the recess of a concave room
    Given a U-shaped room with a central recess
    When a wide piece of furniture has corners in both arms but crosses the recess
    Then placement is rejected
