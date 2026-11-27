Feature: The package runs end to end against a local atServer environment

  The keyless suite starts the local atServer virtual environment, pre-navigates
  each atServer origin in the browser context, and drives two demo atSigns
  through the built package. It needs no real account.

  Scenario: ve: both atSigns connect and only the environment host is contacted
    Given a running environment and a page per atSign
    When both create an AtClient against the environment root
    Then both reach connected
    And no request or socket left the environment's hosts

  Scenario: ve: the session and collection surface equals the bridge manifest
    Given a connected session
    When its session and a collection are enumerated
    Then they equal the bridge manifest

  Scenario: ve: a notification from alice reaches bob with its sender and value
    Given bob subscribed to a run pattern
    When alice notifies bob
    Then bob receives it with alice as sender and the same value

  Scenario: ve: collection create, get, list, query, update and remove all resolve in order with watch events
    Given an open collection with a watch
    When an item is created, read, listed, queried, updated and removed
    Then each call resolves and the watch reports updated, updated, deleted

  Scenario: ve: an item shared with bob is listed by bob and bob cannot remove it
    Given alice shares an item with bob
    When bob lists the collection and tries to remove it
    Then bob sees alice as owner and the removal is refused as not owner

  Scenario: ve: a notify without a recipient or with a foreign sender is refused locally
    Given a connected session
    When a notify omits sharedWith or names another sharedBy
    Then it fails with invalid_argument naming the field and nothing is received

  Scenario: ve: a create for an atSign absent from the environment records its code
    Given an atSign the environment does not know
    When a client is created for it
    Then the outcome code is recorded without being asserted

  Scenario: ve: close is idempotent and later calls reject closed
    Given open sessions
    When close is called twice on one and once on the other
    Then later notify and subscribe calls reject closed
