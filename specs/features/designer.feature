Feature: Conversational room designer
  Un microservicio de chat convierte un brief ("créame una oficina para 4,
  moderna") en acciones sobre el estado de la habitación, que vive en un
  fichero con los muebles, sus coordenadas 3D y el log de cambios. placeNew
  resuelve producto real vía buscador + VLM picker; los guardrails impiden
  muebles fuera de la sala, bajo el suelo, sobre el techo, tapando ventanas o colisionando; y un
  VLM juez puntúa un screenshot con un rubric.

  Scenario: An office brief becomes a furnished room with grounded products
    Given an empty room file and a catalog with desks, chairs and shelves
    When the user asks for an office for four
    Then the actions create a room and place desks and chairs for four people
    And every placed product exists in the published catalog

  Scenario: placeNew lets the picker choose among the searcher's top candidates
    Given a query that matches several products
    When the intent is resolved
    Then the picker receives the top candidates with photo, price and description
    And the chosen product is one of them

  Scenario: replace swaps the product but keeps the spot
    Given a placed desk
    When the user asks to replace it with another one
    Then the item keeps its uid and position but changes product

  Scenario: Nothing lands outside the room or colliding
    Given a room with furniture in it
    When an intent proposes an impossible position
    Then the placement is repaired to a nearby free spot or rejected with a reason

  Scenario: Furniture can be placed and moved at a chosen height
    Given a room with space above an existing desk
    When the agent places a product at a chosen base height and moves it vertically
    Then the chosen height is preserved when replacing, saving and replaying the room
    And furniture may share a footprint if their vertical volumes do not overlap
    And negative heights and positions that cross the ceiling are rejected

  Scenario: Furniture never blocks a window or a door swing
    Given a room with a window and a door
    When a tall piece is proposed in front of the window
    Then the guardrails veto or relocate it

  Scenario: The room file records the state and the full action log
    Given a chat turn that applied actions
    When the file is loaded again
    Then it contains the placed items with 3D coordinates and a log entry per action

  Scenario: The websocket serves chat, state and the judge
    Given the designer service listening with fake providers
    When a client chats and then asks for judgement with a screenshot
    Then it receives the actions, the updated state and a rubric verdict

  Scenario: The judge scores the rubric dimensions from a screenshot
    Given a rendered screenshot of the room
    When the judge evaluates it against the brief
    Then the verdict carries cohesion, colors, style and adherence scores

  Scenario: The judge's verdict becomes memory the agent can read
    Given a judged room
    When the verdict is recorded
    Then the room carries its current grades and the judge speaks in the conversation

  Scenario: The judge and the agent iterate until the mean grade reaches the target
    Given a room scored below the target
    When the judgement arrives
    Then the server relaunches the agent with the judge's notes until the mean reaches the target

  Scenario: A refinement loop continues through stagnation until the target is reached
    Given consecutive verdicts without improvement
    When the next judgement arrives
    Then refinement continues while the mean is below the target, including after repeated grades

  Scenario: Manual edits become the next agent's room state
    Given a shared room that has already been judged
    When the user moves a piece of furniture and the server confirms the edit
    Then the next agent reads its new position and the current grade is invalidated

  Scenario: Independent manual edits merge across room revisions
    Given two clients editing the same room revision
    When each moves a different piece of furniture
    Then the shared room preserves both edits

  Scenario: Conflicting manual edits wait for a user choice
    Given two clients moving the same piece of furniture differently
    When both submit their changes
    Then the second edit reports a conflict without overwriting the first
    And an explicit resolution can save the chosen position

  Scenario: A buffered broadcast cannot undo a later save acknowledgement
    Given a local edit waiting for confirmation during a mouse gesture
    When a broadcast arrives before the acknowledgement of that edit
    Then releasing the mouse preserves the acknowledged room and its revision
