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
    Then the verdict carries cohesion, colors, style, adherence, correct rotation and completeness scores

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

  Scenario: The backend can answer freely without changing or evaluating the room
    Given a user message that needs advice or clarification
    When the agent chooses to respond conversationally
    Then the response and original message are remembered without changing the scene
    And the service does not request a screenshot or start the visual judge

  Scenario: A judge refinement applies multiple furniture changes before the next evaluation
    Given a furnished room with several corrections requested by the judge
    When the agent submits two moves, a rotation and a replacement in one batch
    Then one reply contains all four validated changes in their requested order
    And the next screenshot is requested only for the complete updated room

  Scenario: A rejected change does not discard the other changes in a turn
    Given a batch containing valid changes and an invalid furniture identifier
    When the agent applies the batch
    Then the valid changes are preserved in order and the rejection is reported

  Scenario: Agent thinking summaries and tool activity are visible during a turn
    Given a browser subscribed to agent activity independently of scene progress
    When a provider returns a thinking summary and calls a room tool
    Then the browser receives the complete public summary and tool arguments and results before the final reply
    And the activity is remembered with the response without provider thought signatures

  Scenario: Agent activity can be expanded and remains available after the reply
    Given an agent that is working on a chat turn
    When the user expands "Ver pensamiento"
    Then the available thinking summaries and tool activity are visible
    And each intervention identifies its agent in a readable conversation with technical details collapsed
    And the collapsed disclosure shows only "Pensando…" while the turn is running
    And incoming activity never opens the disclosure automatically
    And the completed activity remains available after the reply and when restoring the conversation

  Scenario: Stopped and superseded turns cannot update the active thinking panel
    Given a turn with visible agent activity
    When that turn is stopped or replaced by another request
    Then late progress cannot change the new turn's activity or restart its thinking indicator

  Scenario: Judge thinking remains separate from designer thinking
    Given a completed design awaiting visual judgement
    When the judge returns a public thinking summary
    Then its progress and saved summary identify the judge and the evaluated round
    And the next design round starts a separate thinking panel

  Scenario: The judge displays every rubric grade out of ten
    Given a completed judge evaluation
    When its result appears in the conversation
    Then cohesion, colors, style, brief adherence, correct rotation and completeness each show their grade out of ten
    And the judge's average and target remain visible while its thinking stays collapsed

  Scenario: Rotation and completeness count towards the judge target
    Given a room with good styling but badly oriented or missing furniture
    When the judge grades correct rotation and completeness below the target
    Then the mean includes all six equally weighted rubric dimensions
    And the designer receives both weak dimensions to improve the room
