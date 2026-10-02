Feature: Read agent activity without interruptions
  Scenario: New agent messages preserve the readers position
    Given the user has scrolled to earlier agent activity
    When new activity and replies arrive
    Then the conversation keeps the current reading position
    And scrolling back to the bottom resumes following new messages
