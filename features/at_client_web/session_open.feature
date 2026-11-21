Feature: A browser opens an atSign session only where it safely can

  AtClient.create opens a session from an atSign's .atKeys document. It
  checks the page and the options before the Dart bundle is loaded, and
  rejects with an AtError whose code says why. The package has no passkey
  entry points.

  Scenario: passes the atSign, namespace and keys to the bridge
    Given a secure page
    When create is called with atSign, namespace and keys
    Then the bridge is asked to open the session with exactly those values

  Scenario: passes any rootDomain through
    Given a secure page
    When create is called with a rootDomain
    Then the bridge receives it unchanged

  Scenario: a missing namespace rejects bad_key before loading the bridge
    Given a secure page
    When create is called without a namespace
    Then it rejects with AtError code bad_key
    And the Dart bundle has not been loaded

  Scenario: missing keys reject bad_key before loading the bridge
    Given a secure page
    When create is called without keys
    Then it rejects with AtError code bad_key
    And the Dart bundle has not been loaded

  Scenario: a non-secure context rejects unsupported
    Given a page that is not a secure context
    When create is called
    Then it rejects with AtError code unsupported
    And the Dart bundle has not been loaded

  Scenario: has no passkey entry points
    Given the AtClient class
    Then it has no onboard, enroll or prfSupported

  Scenario: create(null) rejects with bad_key
    Given a secure page
    When create is called with null
    Then it rejects with AtError code bad_key
    And the Dart bundle has not been loaded

  Scenario: create with non-object options rejects with bad_key
    Given a secure page
    When create is called with a string, a number or an array
    Then each rejects with AtError code bad_key
    And the Dart bundle has not been loaded

  Scenario: create lowercases the namespace for the client but not for the bridge
    Given a secure page
    When create is called with the namespace Tally and the client sends a notification
    Then the bridge was opened with Tally
    And the notification key is under the namespace tally
