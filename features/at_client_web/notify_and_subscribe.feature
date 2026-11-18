Feature: notify sends to another atSign and subscribe delivers only genuine events

  notify sends a value on a key shared with another atSign and resolves true
  when it was delivered. subscribe registers when called and hands the app
  events as an async iterator. A notification this session sent, or one whose
  key owner is not its sender, is never delivered. The iterator buffers up to
  4096 events; past that it ends and its next() rejects overflow.

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
