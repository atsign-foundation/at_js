Feature: A collection offers eight operations over typed items

  client.collection(name, { type, eventSource }) returns a Collection with
  create, get, list, query, update, share, remove and watch. Failures reject
  with an AtError whose code is the collection code, with the failing item's
  id, owner and kind when known. Item data is a plain object with no
  prototype. An event kind this version does not know arrives as unknown.

  Scenario: passes name and options to the bridge
    Given an open client
    When collection is called with a name, a type and an event source
    Then the bridge receives them

  Scenario: create passes data and options and resolves the item
    Given an open collection
    When create is called with data and options
    Then the bridge receives both and the item is returned

  Scenario: get takes an id string or an address and resolves null for none
    Given an open collection
    When get is called with an id, with an address, and for an item that does not exist
    Then the bridge receives an address each time and the missing item resolves null

  Scenario: list and query resolve items and unreadable
    Given an open collection holding one unreadable item
    When list and query are called
    Then both resolve the items and the unreadable ids

  Scenario: update, share and remove pass the address
    Given an open collection
    When update, share and remove are called
    Then the bridge receives the address and the arguments of each

  Scenario: a collection failure rejects with its code and details
    Given a bridge that rejects with a partial failure naming an id, an owner and failures
    When share is called
    Then it rejects with that code and carries the id, owner, kind and failures

  Scenario: a failed open rejects with the bridge code
    Given a bridge that refuses the collection
    When collection is called
    Then it rejects with the bridge's code

  Scenario: item data keeps a prototype-less object as it arrives
    Given an item whose data has the key __proto__
    When get resolves it
    Then the data has no prototype and keeps the key as plain data

  Scenario: watch delivers events, including unknown ones (T6.5, T6.8)
    Given a watch on a collection
    When an updated event and an unknown event arrive
    Then both are delivered in order

  Scenario: watch errors reject one next() and the stream carries on
    Given a watch on a collection
    When the bridge reports an error and then an event
    Then one next rejects with the error's code and the next one delivers the event

  Scenario: breaking out of watch stops it once
    Given a watch on a collection
    When the loop breaks
    Then the bridge watch is stopped once

  Scenario: a watch the bridge cannot start throws its AtError
    Given a bridge that cannot start the watch
    When watch is called
    Then it throws an AtError with the bridge's code

  Scenario: close ends open watches
    Given a watch with a reader waiting
    When the client closes
    Then the read finishes and the watch is stopped once

  Scenario: every operation rejects closed after close, without touching the bridge
    Given a closed client with a collection
    When any operation is called
    Then it rejects with code closed and watch throws code closed

  Scenario: watch keeps a null owner on a sub-item ancestor
    Given an open watch
    When a subItemUpdated event arrives whose ancestor has owner null
    Then next() yields the event with that ancestor's owner still null
