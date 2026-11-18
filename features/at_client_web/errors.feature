Feature: Every failure is an AtError whose code the caller branches on

  A call rejects with an AtError. A {code, message} the bridge reports keeps
  its code when it is a known one; anything else is internal. An argument the
  bridge rejects names the parameter, never the value it received.

  Scenario: maps a {code, message} rejection to an AtError
    Given a bridge that rejects with { code: 'pkam_refused', message: 'refused' }
    When create is called
    Then it rejects with an AtError, an Error with that message and the code pkam_refused

  Scenario: maps an unknown code or a thrown Error to internal
    Given a bridge that rejects with an unknown code, or with a thrown Error
    When create is called
    Then it rejects with AtError code internal and the message given

  Scenario: maps every code through unchanged
    Given a bridge that rejects with each known code
    When create is called
    Then each rejects with an AtError carrying that code
