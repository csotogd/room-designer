Feature: Semantic catalog search
  Un microservicio indexa un embedding por producto (foto + descripción +
  precio) y responde búsquedas por relevancia. El refresco diario del catálogo
  dispara la sincronización: altas, cambios y bajas quedan reflejados en la
  base de vectores, que siempre está alineada con el catálogo publicado.

  Scenario: A product is indexed as one embedding of photo, description and price
    Given a product with name, description, price and photo url
    When it is synced into the search index
    Then the index holds exactly one vector for it with the embedder dimension

  Scenario: Catalog sync is idempotent
    Given a catalog snapshot already synced
    When the same snapshot is synced again
    Then no product is re-embedded and the report counts everything as unchanged

  Scenario: Catalog refresh adds new embeddings and removes stale ones
    Given an index built from a catalog snapshot
    When a refreshed snapshot arrives with a product added and another gone
    Then the new product becomes searchable and the removed one disappears

  Scenario: Unchanged products are not re-embedded on refresh
    Given a synced catalog where one product later changes its price
    When the refreshed snapshot is synced
    Then only the changed product goes through the embedder again

  Scenario: Search ranks the most relevant products first
    Given an index with clearly distinct products
    When searching for words of one of them
    Then that product comes first in the results

  Scenario: Search stays fast with one hundred thousand products
    Given an index with one hundred thousand vectors
    Then a query resolves in well under one hundred milliseconds

  Scenario: The search microservice serves sync and search over HTTP
    Given the service listening on an ephemeral port
    When a catalog is posted to sync and a query is sent to search
    Then both endpoints answer with the report and the ranked results

  Scenario: The index survives a restart through its persisted snapshot
    Given a service that synced a catalog into a data directory
    When a new service instance starts over the same directory
    Then it answers searches without re-embedding anything

  Scenario: The embedding photo is the packshot, never the lifestyle shot
    Given a published product with a catalog photo and a packshot
    When it is projected for the search index
    Then the embedding photo is the packshot with only the product on it
    And a product without packshot falls back to its catalog photo

  Scenario: Search quality is measured with IR metrics against a golden set
    Given a golden set of queries with their relevant products
    When the evaluation harness runs over the index
    Then it reports recall, reciprocal rank and NDCG per query and on average

  Scenario: The service exposes online quality signals beyond latency
    Given searches with strong matches and with nonsense queries
    Then metrics expose the average top score and the low-confidence rate
