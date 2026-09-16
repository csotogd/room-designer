Feature: Deploy isolated environments from protected branches
  Changes reach only their intended environment after the quality gates pass.

  Scenario: Merges deploy only to their matching environment
    Given separate cloud projects for dev, stage and prod
    When an environment branch receives a push
    Then the deployment uses only that environment's project and state
    And pull requests and other branches cannot deploy

  Scenario: Failed quality gates prevent deployment
    Given the required CI tests, coverage, mutation and infrastructure validation
    When any required check fails or is skipped
    Then no cloud deployment is allowed

  Scenario: Cloud Build in the target project must pass before deployment
    Given a merged commit whose CI quality gates passed
    When CI starts Cloud Build in the matching environment project
    And Cloud Build builds and checks both frontend and Python backend images
    Then Cloud Build builds and smoke tests the containers
    And only a successful build of that commit may supply the deployment image digest
    And a failed, cancelled or unfinished build cannot deploy

  Scenario: Destructive infrastructure changes require manual review
    Given a saved infrastructure plan for an environment
    When a resource would be deleted or replaced
    Then automatic application is refused

  Scenario: An unverified release cannot be reported as healthy
    Given an immutable image built from the merged commit
    When the deployed revision differs or a resource check fails
    Then the deployment fails instead of reporting success

  Scenario: The deployed editor serves the tested commit
    Given the editor image built from the merged commit
    When its smoke test runs
    Then the page, its JavaScript and its release identifier must be available
    And a stale release or a broken asset fails the deployment

  Scenario: The private editor is verified with an audience-bound identity token
    Given a ready private editor and a deploy identity allowed to mint only its own ID token
    When the deployment verifies the editor
    Then it requests an ID token for that editor without impersonating another access token
    And it sends that token only to the private editor
