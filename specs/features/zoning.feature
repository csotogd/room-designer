Feature: Functional room zones
  El agente distribuye los usos antes de amueblar y trabaja cada zona por separado.

  Scenario: A zoning agent divides the room before furnishing each zone independently
    Given an empty rectangular room and a brief requesting study and sleep areas
    When the agent plans the functional zones
    Then all furnishing agents start automatically in parallel without user confirmation
    And the named non-overlapping zones are saved before any furniture action
    And each furnishing agent receives only one active zone and the shared room context
    And every furniture footprint stays inside its assigned zone

  Scenario: Invalid zoning leaves the previous plan intact
    Given a room with a valid zone plan
    When an agent proposes overlapping zones or zones outside the room
    Then the proposal is rejected without changing the previous zones or furniture

  Scenario: The frontend displays the saved functional zones
    Given a shared room with named functional zones
    When the frontend receives or restores its state
    Then dashed outlines and names are drawn on the 3D room floor
    And the outlines have a readable thickness at normal zoom
    And no furnishing button or confirmation is required

  Scenario: Provider tool calls furnish only the assigned zone
    Given a furnishing agent with an active zone
    When a provider requests a catalog furniture placement
    Then the placement executes through the provider adapter inside that zone
    And room planning tools are not exposed to the furnishing agent

  Scenario: Zone boundaries are visible while independent agents are furnishing
    Given a connected browser that supports design progress
    When the planner defines the zones
    Then the browser receives the zone outlines before the furniture is ready
    And subsequent previews show each accepted furniture change from every zone
    And all zone agents work from independent copies of the same room
    And a failure or cancellation restores the last saved room
