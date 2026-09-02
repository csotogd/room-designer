Feature: Save and load projects
  El proyecto completo (plano, muebles, luces, hora del día) se serializa a JSON
  versionado y se recupera idéntico.

  Scenario: A project round-trips through JSON
    Given a project with a rectangular room of 5 by 4 meters
    And a door on the first wall at offset 1
    And a "table" at (2, 2) with a "vase" on top
    And a ceiling light at (2.5, 2)
    When I serialize the project and load it back
    Then the loaded project equals the original

  Scenario: Serialized documents carry a schema version
    Given a project with a rectangular room of 5 by 4 meters
    When I serialize the project
    Then the document has a schema version

  Scenario: Loading a document with an unknown version fails clearly
    Given a serialized document with version 999
    Then loading it is rejected with an unsupported version error
