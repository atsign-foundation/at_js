# Threats: DoS is the surface here: a stalled bundle request gives up after
# 60 s, so it no longer pins every create, and the next create injects afresh.
# Race: a late onload after expiry is ignored, because both handlers are
# cleared and the pending install poll is stopped, so it cannot install a
# second bridge through this path. Forgery and replay do not apply to loading
# a script from the package's own origin.

Feature: The Dart bundle loads once and a failed load can be retried

  The first call that needs the bridge injects dist/dart/at_client.js as a
  script and resolves with the global it installs. Every later call and every
  concurrent caller shares that one load. One deadline starts when the script
  is appended: the load must download and install the bridge within 60 s.

  Scenario: loads once however many calls and callers
    Given an installed loader
    When loadBridge is called twice at once and then once more
    Then the loader ran once
    And all three calls resolved with the same bridge

  Scenario: rejects with an internal AtError when the script fails to load
    Given the bundle script is injected and fails to load
    When the load fails
    Then loadBridge rejects with AtError code internal
    And the failed script is removed from the page

  Scenario: injects a fresh script on the retry after a failed load
    Given a failed load
    When loadBridge is called again
    Then a second script is injected
    And it resolves with the bridge the script installs, leaving the script in place

  Scenario: keeps a loader installed while an earlier load was failing
    Given a load in progress on one loader
    When a replacement loader is installed and the earlier load then fails
    Then the replacement is used and is kept for later calls

  Scenario: a bundle request that never loads rejects timeout after 60 s
    Given the bundle script is injected and neither loads nor fails
    When 60 s pass
    Then loadBridge rejects with AtError code timeout saying the bundle did not load within 60 s
    And the script is removed and its onload and onerror are cleared

  Scenario: a create after a timed-out bundle load injects the bundle again
    Given a bundle load that timed out after 60 s
    When loadBridge is called again
    Then a second script is appended and it resolves with the bridge that script installs

  Scenario: the bundle deadline covers a slow download and the install
    Given the script loads at 59 s and the bridge is installed at 59.5 s
    When the 60 s deadline passes
    Then the load resolves
    And a script that loads at 59.9 s and installs nothing rejects timeout, not internal, at 60 s
