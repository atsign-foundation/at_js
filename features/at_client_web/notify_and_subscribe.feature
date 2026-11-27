# Threats: forgery and impersonation are refused locally (a sharedBy that is
# not the session atSign is rejected, and the owner is always the session's)
# and again by the bridge. There is no replay or race surface: composing the
# atKey text is a pure function. DoS is bounded by the bridge's 248-character
# key validator.
#
# Inbound, subscribe takes a key's owner only from the bridge's verified
# sender: a notification with no verified sender is dropped. Forgery: the owner
# comes only from `from`. DoS: display-bounded key text is never parsed.
# Replay and race: no new surface.

Feature: notify sends to another atSign and subscribe delivers only genuine events

  notify sends a value on a key shared with another atSign and resolves true
  when it was delivered. The key is sent as atKey text — the recipient, the
  key with its namespace, and the owner — built from the NotifyKey and the
  session's namespace and atSign; sharedWith is required, the owner is always
  the session atSign, and a malformed field is refused locally with
  invalid_argument naming NotifyKey.<field>. subscribe registers when called
  and hands the app
  events as an async iterator. Each event's key owner is the verified sender; a
  notification with no verified sender is skipped, and a key the bridge bounded
  to 128 units is marked truncated and not parsed. The iterator buffers up to
  4096 events; past that it ends and its next() rejects overflow.

  Scenario: notify sends the key as atKey text with the session namespace and atSign
    Given an open session in namespace tally, as @alice
    When notify is called on key k shared with @bob without a namespace
    Then the bridge is called with @bob:k.tally@alice and the value

  Scenario: notify with a sharedBy other than the session atSign rejects invalid_argument and sends nothing
    Given an open session in namespace tally, as @alice
    When notify is called on key k with namespace other, shared with @bob by @carol
    Then it rejects with AtError code invalid_argument naming NotifyKey.sharedBy
    And the bridge is not asked to notify

  Scenario: notify accepts a sharedBy equal to the session atSign in any case
    Given an open session in namespace tally, as @alice
    When notify is called on key k shared with @bob by @ALICE
    Then the bridge is called with @bob:k.tally@alice and the value

  Scenario: notify without sharedWith rejects invalid_argument naming NotifyKey.sharedWith and sends nothing
    Given an open session
    When notify is called on key k with no sharedWith
    Then it rejects with AtError code invalid_argument naming NotifyKey.sharedWith
    And the bridge is not asked to notify

  Scenario: notify with noNamespace sends the key with no namespace
    Given an open session in namespace tally, as @alice
    When notify is called on key k shared with @bob with noNamespace true and namespace other
    Then the bridge is called with @bob:k@alice and the value

  Scenario: notify refuses delimiters in key parts with invalid_argument naming the field
    Given an open session
    When notify is called with an @, ':' or whitespace in the key name, a namespace that is not one word, or a sharedWith or sharedBy that is not one @atSign
    Then each rejects with AtError code invalid_argument naming NotifyKey.<field>
    And the bridge is not asked to notify

  Scenario: notify refuses a truthy public or cached flag
    Given an open session
    When notify is called with public or cached set to a truthy value
    Then each rejects with AtError code invalid_argument naming NotifyKey.public or NotifyKey.cached
    And the bridge is not asked to notify

  Scenario: notify with a public or cached key rejects invalid_argument naming the flag and sends nothing
    Given an open session
    When notify is called with public true or cached true
    Then each rejects with AtError code invalid_argument naming NotifyKey.public or NotifyKey.cached
    And the bridge is not asked to notify

  Scenario: notify with an empty or non-string key part rejects invalid_argument naming the field and sends nothing
    Given an open session
    When notify is called with an empty or non-string key name, sharedWith or namespace
    Then each rejects with AtError code invalid_argument naming NotifyKey.<field>
    And the bridge is not asked to notify

  Scenario: notify with a key that is not a plain object rejects invalid_argument naming NotifyKey and sends nothing
    Given an open session
    When notify is called with a null, undefined or non-object key
    Then it rejects with AtError code invalid_argument naming NotifyKey
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

  Scenario: subscribe takes the key owner from the verified sender
    Given an open subscription
    When a notification arrives from @bobsmith with a key whose text names another owner
    Then the event's key owner is @bobsmith and its from is @bobsmith

  Scenario: subscribe skips a notification with no verified sender
    Given an open subscription
    When notifications arrive with no @-prefixed from and then a well-formed one
    Then only the well-formed notification is yielded

  Scenario: subscribe marks a display-bounded key as truncated and does not parse it
    Given an open subscription
    When a notification arrives with key text cut at the bridge's 128-unit display bound
    Then the event's key is that bounded text, owned by the verified sender, with truncated true
    And none of the text is parsed

  Scenario: subscribe parses an uncut key of exactly 128 units
    Given an open subscription
    When a notification arrives with a 128-unit key that does not end in three dots
    Then the key is parsed and carries no truncated field

  Scenario: subscribe marks a key cut before a surrogate pair as truncated
    Given an open subscription
    When a notification arrives with 127 units of key text ending in three dots
    Then the event's key is that bounded text, owned by the verified sender, with truncated true

  Scenario: an ordinary subscribe event carries no truncated field
    Given an open subscription
    When an ordinary notification arrives
    Then its key carries no truncated field

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
