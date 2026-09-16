Feature: Live furniture progress
  El editor muestra las decisiones aceptadas mientras los agentes siguen trabajando.

  Scenario: Furniture changes appear before the agent finishes its turn
    Given a connected browser and a furnished room
    When an agent places, moves, rotates, replaces and removes furniture
    Then each accepted change is visible before the next decision
    And the final reply confirms the scene without applying changes twice

  Scenario: Independent agents share a combined live preview
    Given agents working on separate copies of the same room
    When their furniture decisions arrive interleaved
    Then each preview keeps the other agents furniture and latest corrections
    And the saved room stays unchanged until the complete turn succeeds
    And other browsers only receive the confirmed room

  Scenario: Interrupted previews restore the saved room
    Given furniture changes visible during an unfinished turn
    When the turn fails or is cancelled
    Then the editor restores the last saved room
    And late preview messages cannot change the restored scene

  Scenario: Local furnishing has time to complete and explains timeouts
    Given the local backend connected to real providers
    When a furnishing turn takes more than three minutes
    Then its default time budget allows up to ten minutes
    And an exhausted budget explains that provisional changes were not saved
