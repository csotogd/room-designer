Feature: Product catalog
  Cada artículo es una entidad Producto: nombre, descripción, precio,
  dimensiones y referencias a sus assets (foto y modelo GLB), que en
  producción vivirán en un bucket (S3/CDN). El catálogo es extenso y
  navegable con scroll, como en un configurador comercial.

  Scenario: Every product carries name, description, price and dimensions
    Given the default catalog
    Then every product has a non-empty name, description and positive price
    And every product has positive dimensions

  Scenario: The default catalog offers an extended range
    Given the default catalog
    Then it offers at least 18 products with unique ids

  Scenario: Products can reference remote assets
    Given a product with a model url and an image url
    Then the product exposes both asset urls
    And a product without assets exposes none

  Scenario: Every product declares a known 3D form
    Given the default catalog
    Then every product form is one the renderer knows how to build
