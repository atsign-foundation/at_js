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

  Scenario: maps enrollment_conveyance_failed through unchanged
    Given a bridge whose approve rejects with enrollment_conveyance_failed
    When approve is called
    Then it rejects with an AtError carrying that code and the bridge's message

  Scenario: maps COLLECTION_ITEM_TOO_DEEP through unchanged
    Given a bridge whose collection create rejects with COLLECTION_ITEM_TOO_DEEP
    When create is called on the collection
    Then it rejects with an AtError carrying that code

  Scenario: maps invalid_argument through unchanged
    Given a bridge whose subscribe answers with { code: 'invalid_argument', message }
    When subscribe is called
    Then it throws an AtError carrying that code and the bridge's message

  Scenario: maps enrollment_in_flight through unchanged
    Given a bridge whose deny rejects with enrollment_in_flight
    When deny is called
    Then it rejects with an AtError carrying that code and the bridge's message

  Scenario: every closed rejection from the client says the session is closed
    Given a closed client
    When otp, subscribe and onStatus are called
    Then each fails with AtError code closed and the message the session is closed
