Feature: Evaluate and correct during furnishing
  Scenario: Judge feedback guides the unfinished furnishing turn
    Given agents are furnishing the room and the first furniture is visible
    When the judge evaluates an intermediate screenshot
    Then the agent receives the six scores and corrections before its next decision
    And it can move or rotate furniture before finishing the initial proposal
    And intermediate scores are saved in order without declaring an incomplete room finished

  Scenario: Intermediate evaluation only accepts its matching screenshot
    Given an intermediate review is waiting for a screenshot
    When another browser or an older preview submits a screenshot
    Then that screenshot is ignored
    And stopping the turn cancels the review without saving provisional furniture

  Scenario: The conversation shows the real score evolution while furnishing
    Given the designer is still furnishing the room
    When intermediate judge scores arrive
    Then each evaluation appears with its six rubric grades and its position in the history
    And the conversation stays at the users reading position
    And the designer activity remains available separately from the displayed grades
    And stopping restores the saved room scores or marks its evaluation as pending
