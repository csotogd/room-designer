Feature: Durable cloud designer
  The private conversational service preserves rooms across instances without losing concurrent changes.

  Scenario: A new designer instance resumes the saved conversation
    Given a conversation saved by one cloud designer instance
    When another instance resumes the room
    Then it sees the conversation and its revision

  Scenario: Concurrent designer instances cannot overwrite each other
    Given two instances that read the same room revision
    When both try to save different conversations
    Then only one succeeds and the other reports a conflict

  Scenario: Cloud chat uses private same-origin endpoints and real credentials
    Given the cloud chat is enabled with a versioned Gemini secret
    When the editor is deployed
    Then the browser uses same-origin chat and search endpoints without receiving the key
    And the Python services use durable storage and a read-only catalog
    And the static catalog route exposes only the catalog prefix, never room snapshots
