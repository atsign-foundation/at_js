Feature: CI browser canary
  The pipeline runs Chromium against a static page so that browser-based
  package tests can rely on the same setup.

  Scenario: the page is a secure context on localhost
    Given the static page is served on 127.0.0.1
    When Chromium opens it as localhost
    Then window.isSecureContext is true

  Scenario: the page is not a secure context on a mapped plain-http name
    Given the static page is served on 127.0.0.1
    When Chromium opens it as insecure.test, mapped to 127.0.0.1
    Then window.isSecureContext is false

  Scenario: the static server serves only the page and the dist tree
    Given the static server root
    When a request path names a file outside the page and the dist tree
    Then the server resolves no file for it

  Scenario: the static server resolves no file for a path that climbs out of the served trees
    Given the static server root
    When a request path climbs out with dot-dot segments, plain or percent-encoded
    Then the server resolves no file for it

  Scenario: a malformed request target gets 400
    Given the static server root
    When a request target is not a well-formed URL
    Then the server answers 400 with no body

  Scenario: a well-formed request target is answered from the served trees
    Given the static server root
    When a request target is well formed
    Then the server answers 200 for a served file and 404 for any other path

  Scenario: a file that cannot be opened gets 500
    Given a served file that is removed before it is opened
    When the server sends it
    Then the server answers 500

  Scenario: a file that fails while streaming ends the response early
    Given a served path that cannot be read to the end
    When the server sends it
    Then the response is closed without a complete body

  Scenario: a readable file is streamed with 200
    Given a served file that can be read
    When the server sends it
    Then the server answers 200 with the file
