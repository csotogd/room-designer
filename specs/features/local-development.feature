Feature: Local development with real Gemini from Secret Manager
  The local editor uses the existing dev secret without storing API keys in files.

  Scenario: Local startup reads the dev secret for every Gemini agent
    Given the developer can access the configured dev secret with Google credentials
    When the local designer starts
    Then designer, furniture picker and judge use real Gemini with the secret in memory
    And local environment values cannot redirect the secret to another API endpoint
    And no secret is written to environment files or printed

  Scenario: Local startup stops when the secret cannot be accessed
    Given Google authentication or secret access is unavailable
    When the local designer starts
    Then startup stops with an actionable message without revealing credentials
    And it does not fall back to fake agents or start a server
