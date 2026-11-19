Feature: CI browser test port
  The browser tests serve the static page on one port, read from a single
  place, so that the server, the Playwright config and the specs agree.

  Scenario: the port is 4174 when E2E_PORT is unset or empty
    Given E2E_PORT is unset or empty
    When the browser test port is read
    Then the port is 4174

  Scenario: the port is the E2E_PORT value when it is an integer from 1 to 65535
    Given E2E_PORT is set to an integer from 1 to 65535
    When the browser test port is read
    Then the port is that integer

  Scenario: an E2E_PORT value that is not an integer from 1 to 65535 is rejected
    Given E2E_PORT is set to a value that is not an integer from 1 to 65535
    When the browser test port is read
    Then it fails with "E2E_PORT: must be 1-65535, got" followed by the value
