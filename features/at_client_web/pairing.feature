Feature: An approving device enrolls another browser

  otp, pendingEnrollments, approve and deny need a session with the __manage
  access. The approving device approves a request exactly as filed.

  Scenario: otp, pendingEnrollments, approve and deny reach the bridge
    Given an open client whose session holds __manage
    When otp, pendingEnrollments, approve and deny are called
    Then each reaches the bridge, with the ids passed on
    And pendingEnrollments returns the requests as { id, appName, deviceName, namespaces }
