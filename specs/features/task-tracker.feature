Feature: Local project task tracker
  El equipo registra cada trabajo y conserva su estado en un tablero HTML portátil.

  Scenario: Track a task from pending to done across sessions
    Given an empty project tracker
    When I register a pending task and start working on it
    And I reopen the tracker and finish the task
    Then the task is done with its description, owner and priority preserved

  Scenario: Reconcile repository updates with local task edits
    Given tasks saved locally and a newer task update in the HTML file
    When I reopen the tracker
    Then the newest revision of each task is kept without losing local tasks

  Scenario: Manage tasks and download a portable board
    Given the standalone HTML tracker
    When I create and edit a task and change its status
    Then I can find it by text and priority
    And downloading the HTML preserves the current tasks safely

  Scenario: Keep tasks usable when local storage cannot be read or written
    Given the browser cannot read or write a valid saved tracker
    When I open the tracker and register a task
    Then the embedded tasks and my new task remain available for download
    And the tracker reports that local persistence is unavailable
