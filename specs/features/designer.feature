Feature: Conversational room designer
  Un microservicio de chat convierte un brief ("créame una oficina para 4,
  moderna") en acciones sobre el estado de la habitación, que vive en un
  fichero con los muebles, sus coordenadas 3D y el log de cambios. placeNew
  resuelve producto real vía buscador + VLM picker; los guardrails impiden
  muebles fuera de la sala, volando, tapando ventanas o colisionando; y un
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

  Scenario: Nothing lands outside the room, floating, or colliding
    Given a room with furniture in it
    When an intent proposes an impossible position
    Then the placement is repaired to a nearby free spot or rejected with a reason

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

  Scenario: A refinement loop that stops improving is stopped honestly
    Given consecutive verdicts without improvement
    When the next judgement arrives
    Then the loop stops with the stagnation reason instead of iterating forever
