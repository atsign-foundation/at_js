Feature: An approving device enrolls another browser

  otp, pendingEnrollments, approve and deny need a session with the __manage
  access. The approving device approves a request exactly as filed.

  Scenario: otp, pendingEnrollments, approve and deny reach the bridge
    Given an open client whose session holds __manage
    When otp, pendingEnrollments, approve and deny are called
    Then each reaches the bridge, with the ids passed on
    And pendingEnrollments returns the requests as { id, appName, deviceName, namespaces }

  Scenario: session async methods reject with closed after close()
    Given a closed client
    When notify, otp, pendingEnrollments, approve, or deny is called
    Then each rejects with AtError code closed
