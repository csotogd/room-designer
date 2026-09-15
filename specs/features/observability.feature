Feature: Request observability
  El backend permite seguir una operación desde el cliente hasta sus logs sin
  exponer el contenido sensible de la petición.

  Scenario: An HTTP request propagates trace context into structured logs
    Given a request with a W3C trace context and a client request ID
    When the health endpoint completes
    Then the response preserves both correlation identifiers
    And the completion log contains the route, status and duration

  Scenario: A generated trace context is returned when the client sends none
    Given a request without correlation headers
    When the health endpoint completes
    Then the response contains safe generated correlation identifiers

  Scenario: A WebSocket operation keeps trace context in its structured log
    Given a designer session with a client trace context
    When the client sends an operation with its own request ID
    Then the operation log contains both correlation identifiers
