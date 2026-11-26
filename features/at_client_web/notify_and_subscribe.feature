Feature: notify sends to another atSign and subscribe delivers only genuine events

  notify sends a value on a key shared with another atSign and resolves true
  when it was delivered. The key is sent as atKey text — the recipient, the
  key with its namespace, and the owner — built from the AtKey and the
  session's namespace and atSign; a public or cached key is refused locally.
  subscribe registers when called and hands the app
  events as an async iterator. A notification this session sent, or one whose
  key owner is not its sender, is never delivered. The iterator buffers up to
  4096 events; past that it ends and its next() rejects overflow.

  Scenario: notify sends the key as atKey text with the session namespace and atSign
    Given an open session in namespace tally, as @alice
    When notify is called on key k shared with @bob without a namespace
    Then the bridge is called with @bob:k.tally@alice and the value

  Scenario: notify keeps an explicit namespace and owner
    Given an open session in namespace tally, as @alice
    When notify is called on key k with namespace other, shared with @bob by @carol
    Then the bridge is called with @bob:k.other@carol and the value

  Scenario: notify with noNamespace sends the key with no namespace
    Given an open session in namespace tally, as @alice
    When notify is called on key k shared with @bob with noNamespace true and namespace other
    Then the bridge is called with @bob:k@alice and the value

  Scenario: notify with a public or cached key rejects invalid_argument naming the flag and sends nothing
    Given an open session
    When notify is called with public true or cached true
    Then each rejects with AtError code invalid_argument naming the flag
    And the bridge is not asked to notify

  Scenario: notify with an empty or non-string key part rejects invalid_argument naming the field and sends nothing
    Given an open session
    When notify is called with an empty or non-string key name, sharedWith, sharedBy or namespace
    Then each rejects with AtError code invalid_argument naming AtKey.<field>
    And the bridge is not asked to notify

  Scenario: notify with a key that is not a plain object rejects invalid_argument naming AtKey and sends nothing
    Given an open session
    When notify is called with a null, undefined or non-object key
    Then it rejects with AtError code invalid_argument naming AtKey
    And the bridge is not asked to notify

  Scenario: a subscription that buffers past the cap unsubscribes and rejects with overflow
    Given an open subscription the app is not reading
    When 4097 events arrive
    Then the subscription is unsubscribed once
    And next() rejects with AtError code overflow
    And the next next() is done

  Scenario: close ends every open iterator, unsubscribes each and closes the bridge session
    Given two open subscriptions, one with a next() waiting
    When close is called
    Then both iterators finish done
    And each subscription is unsubscribed
    And the bridge session is closed once

  Scenario: subscribe after close throws closed without touching the bridge
    Given a closed client
    When subscribe is called
    Then it throws AtError code closed synchronously
    And the bridge is not asked to subscribe

  Scenario: a failed subscribe surfaces its code as an AtError
    Given a bridge whose subscribe answers with { code: 'closed', message }
    When subscribe is called
    Then it throws an AtError with that code

  Scenario: an error on the stream rejects one next() and the stream carries on
    Given an open subscription
    When the bridge reports an error and then a notification
    Then one next rejects with the error's code and the next one delivers the notification

  Scenario: delivers buffered events and failures in FIFO arrival order
    Given an open subscription
    When an event, a stream error, and another event arrive before next()
    Then next() yields the first event, then rejects with the error, then yields the second event

  Scenario: subscribe lowercases namespace in the default regex
    Given an open client with an uppercase namespace
    When subscribe is called without a regex
    Then the bridge subscribes with the escaped lowercase namespace regex

  Scenario: subscribe turns malformed notification keys into bad_key errors without crashing the listener
    Given an open subscription
    When a notification arrives with a malformed key followed by a valid notification
    Then next() rejects with AtError code bad_key and the next next() yields the valid event

  Scenario: canonicalizes atSigns and namespaces to lowercase
    Given a wire key string
    When parseKey parses a mixed-case key
    Then sharedBy, sharedWith, and namespace are lowercased

  Scenario: treats a trailing dot as no namespace
    Given a wire key string ending in a dot, plain or shared
    When parseKey parses it
    Then the key keeps the dot and the result is marked noNamespace with no namespace

  Scenario: rejects malformed keys
    Given a malformed wire key string
    When parseKey parses it
    Then it throws AtError code bad_key saying which part is expected, without echoing the input
