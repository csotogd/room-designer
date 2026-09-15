Feature: Resilient operations
  El backend tolera reintentos, protege la capacidad y permite recuperar datos
  locales sin repetir efectos ni perder el último estado válido.

  Scenario: A retried chat request is applied only once
    Given a room session that receives the same chat request twice
    When both requests are processed
    Then the second request is acknowledged as a duplicate without running the agent again

  Scenario: Transient dependency failures are retried with bounded backoff
    Given a dependency that fails temporarily
    When the operation is executed with the retry policy
    Then it eventually succeeds without exceeding the attempt limit

  Scenario: Room state keeps a restorable rotating backup
    Given a room repository with a previously saved state
    When a newer state is saved
    Then the previous state can be restored from its backup

  Scenario: A client over the request budget receives a retry hint
    Given a search service limited to two requests per window
    When the same client makes three requests
    Then the third request is rejected with a retry hint

  Scenario: A WebSocket client over the message budget receives a retry hint
    Given a designer session limited to one message per window
    When the client sends two invalid messages
    Then the second message is rejected with a retry hint
