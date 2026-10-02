Feature: Fresh local room on page reload
  Scenario: Reloading the local editor starts a fresh room
    Given the local backend contains furniture, conversation and previous scores
    When a new page session connects to the local editor
    Then it starts with an empty room and no previous conversation or scores
    And reconnecting that same page keeps its current work
    And remote deployments keep their persisted room
