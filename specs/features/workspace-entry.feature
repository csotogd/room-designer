Feature: Start designing from a quiet workspace
  Scenario: A first idea opens the assistant from the floating composer
    Given I enter the editor
    Then the room is visible without a setup dialog or open side panels
    And a floating composer asks what I want to build
    When I submit my first idea
    Then the assistant opens on the right and receives that idea once
    And the composer moves into the assistant
    When I close the assistant with an unfinished draft
    Then the floating composer returns with that draft
    And I can reopen the conversation without losing my messages
