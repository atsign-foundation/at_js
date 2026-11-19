Feature: Weekly Node patch bump
  The pinned .node-version follows the newest patch of its own major once that
  release is at least 7 days old, and never moves on anything it cannot validate.

  Scenario: the newest same-major patch past the cooldown is picked
    Given .node-version holds a valid version
    And the release index lists several patches of that major
    When the bump is computed
    Then the newest of those patches that is at least 7 days old is the result

  Scenario: a newer major is ignored
    Given the release index lists a newer major that is past the cooldown
    When the bump is computed
    Then the result stays within the current major

  Scenario: a release younger than 7 days is ignored
    Given the newest same-major release is younger than 7 days
    When the bump is computed
    Then the newest older release is the result

  Scenario: nothing is output when the pin is already the newest eligible patch
    Given .node-version holds the newest same-major release past the cooldown
    When the bump is computed
    Then there is no result

  Scenario: a malformed .node-version is rejected
    Given .node-version does not match MAJOR.MINOR.PATCH
    When the bump is computed
    Then it fails with "invalid current version" followed by the value

  Scenario: a malformed or non-greater candidate is rejected
    Given the release index holds a malformed entry, or the newest eligible release is older than the pin
    When the bump is computed
    Then it fails and nothing is written

  Scenario: a release counts as released at the end of its day
    Given a release dated D
    When the bump is computed at noon UTC on D+7
    Then the release is not yet eligible
    And at noon UTC on D+8 it is eligible

  Scenario: a fetch error fails the run
    Given the release index cannot be fetched or answers with an HTTP error
    When the bump tool runs
    Then it exits non-zero with a diagnostic on stderr and prints nothing on stdout

  Scenario: an invalid JSON index fails the run
    Given the release index answers with a body that is not valid JSON
    When the bump tool runs
    Then it exits non-zero with a diagnostic on stderr and prints nothing on stdout

  Scenario: the tool prints the new version
    Given a release index with a newer eligible patch of the pinned major
    When the bump tool runs
    Then it prints that version on stdout and exits 0
