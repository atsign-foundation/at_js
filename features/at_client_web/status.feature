Feature: The connection status is readable and observable

  status returns the latest state and onStatus reports each change until the
  caller calls the function it returned. The states are connecting, connected,
  waiting:network, waiting:server and waiting:auth. There is no retry call;
  the client reconnects by itself.

  Scenario: reads the bridge status
    Given an open client
    When status is read
    Then it is the state the bridge reports now

  Scenario: onStatus delivers changes and returns an off function
    Given an open client with a listener
    When the state changes twice and the listener is switched off
    Then the listener saw both states in order
    And the bridge listener was removed once

  Scenario: onStatus surfaces a bridge failure as an AtError
    Given a bridge that cannot register the listener
    When onStatus is called
    Then it throws an AtError with the bridge's code

  Scenario: onStatus after close throws closed without touching the bridge
    Given a closed client
    When onStatus is called
    Then it throws AtError code closed

  Scenario: has no retry
    Given an open client
    Then it has no retry
