Feature: Catalog ingestion and mesh generation pipeline
  Dos módulos de backend: la ingesta scrapea una web de catálogo y guarda
  foto + datos + enlace en una carpeta con forma de bucket (S3 en el futuro);
  la generación toma imagen + medidas y produce el GLB del producto.

  Scenario: A product page with JSON-LD yields name, image, price and dimensions
    Given the HTML of a product page with schema.org Product data
    When the parser extracts the product
    Then it captures name, image url, price and width, depth and height in cm

  Scenario: Scraped assets are laid out like a bucket
    Given a local folder store
    When a product with an image is saved
    Then the folder contains products.json and the image under images/

  Scenario: The generation queue only picks products without a model
    Given three stored products, one of them with a model already generated
    Then the pending queue contains the other two

  Scenario: The packshot scorer prefers clean studio shots over lifestyle photos
    Given a product photo with a uniform light background and a busy lifestyle photo
    Then the packshot score of the studio shot is higher

  Scenario: Bucket products become app catalog entries in meters
    Given a scraped product with dimensions in centimeters and a generated model
    When it is linked into the app catalog
    Then the entry has meters, price, the product photo and the model url
    And a product without model keeps only the photo
