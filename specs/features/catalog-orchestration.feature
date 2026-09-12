Feature: Reliable catalog orchestration
  Catalog refreshes preserve dependencies and durable state under one scheduler.

  Scenario: Publication waits for judging and synchronization waits for every catalog
    Given a refresh containing generated and native model catalogs
    When Airflow schedules the refresh
    Then generated models are judged before publication
    And synchronization waits for every publication
    And verification and evaluation run only after successful synchronization

  Scenario: Refreshes are bounded and inactive until explicitly enabled
    Given a newly installed catalog orchestrator
    When its DAG is loaded
    Then automatic execution starts paused without historical catchup
    And only one refresh runs at a time with bounded task concurrency and retries
    And ingestion and generation have explicit product limits

  Scenario: Orchestrated publication leaves synchronization to its own task
    Given an active catalog with publishable products
    When publication runs with synchronization disabled
    Then the public catalog is written without contacting the search service

  Scenario: Airflow services preserve state and expose only a loopback panel
    Given a catalog orchestration installation
    When its services are recreated
    Then PostgreSQL metadata and catalog assets use durable host storage
    And the panel binds only to loopback while the database and search have no published ports
    And services restart after failure with bounded logs and explicit health checks

  Scenario: Reinitializing Airflow preserves its credentials and stored catalogs
    Given an installation with existing credentials and catalog data
    When its state directory is prepared again
    Then credentials and catalog data remain unchanged
    And secret files are not readable by other users

  Scenario: The Airflow host is isolated and its durable disk survives replacement
    Given the infrastructure for one selected environment
    When Airflow is provisioned
    Then only IAP SSH on TCP port 22 can reach the host
    And its service account has no project-wide editor permission
    And its data disk is protected from deletion and has daily retained snapshots

  Scenario: Failed catalog tasks produce an operational alert without secrets
    Given a catalog task that has exhausted its retries
    When Airflow reports its failure
    Then an error event identifies the DAG, run and task
    And the event does not contain task configuration or credentials

  Scenario: Airflow upgrades wait until catalog runs have finished
    Given a catalog refresh that is queued or running
    When an operator requests a new Airflow release
    Then the release is refused without interrupting that refresh

  Scenario: An unhealthy scheduler or a full data disk raises an operational error
    Given the periodic Airflow health check
    When a component loses its heartbeat or the data disk exceeds eighty five percent
    Then monitoring emits an error instead of reporting a healthy installation

  Scenario: Airflow backups preserve metadata and encryption keys and reject corruption
    Given a PostgreSQL dump and the installation secrets
    When a backup is created and read for recovery
    Then the exact dump and credentials can be recovered
    And a corrupted backup is refused before any state is overwritten

  Scenario: Startup never reformats an existing data filesystem
    Given a data disk containing an existing filesystem
    When the Airflow host starts
    Then an ext4 disk is mounted without formatting
    And an unsupported filesystem is refused without modification

  Scenario: Airflow delivery requires quality gates and a tested image from its environment
    Given an environment explicitly enabled for Airflow delivery
    When CI builds and tests its Airflow image
    Then only a successful build for that commit and environment may be deployed
    And delivery follows the repository quality gates without enabling another catalog scheduler

  Scenario: Invalid catalog selection prevents scheduling
    Given unknown or duplicate catalogs or an active catalog excluded from publication
    When the DAG is loaded
    Then it refuses the configuration before scheduling tasks

  Scenario: Consistency verification observes the search index without modifying it
    Given a published catalog and a search index with a different product count
    When the verification task runs
    Then it reports the mismatch without resynchronizing the index

  Scenario: Upgrades preserve the operator's pause setting across interrupted releases
    Given a catalog DAG that the operator has activated
    When deployment temporarily pauses it and is interrupted
    Then the original active setting remains recoverable
    And a completed deployment restores that setting

  Scenario: Deployment succeeds only when every application service runs the tested image
    Given an immutable image that passed the release tests
    When deployment verifies the running services
    Then an absent, unhealthy or outdated application service prevents success
