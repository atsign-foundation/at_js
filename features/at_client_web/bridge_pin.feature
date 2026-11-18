Feature: The build uses only the bridge release pinned in bridge.ref

  bridge.ref names one bridge release and the sha256 of its bundle. ci:prepare
  downloads that release and keeps the bundle only when its checksum and build
  attestation match. The build copies the fetched bundle, or the file named by
  AT_CLIENT_WEB_BUNDLE, into dist/dart/.

  Scenario: fails with a clear message while the pin is unset
    Given a bridge.ref whose tag is unset
    When it is parsed
    Then it throws a message saying the pin is not set

  Scenario: rejects a mismatch and deletes the file
    Given a downloaded bundle whose sha256 differs from the pinned one
    When the download is verified
    Then it throws a checksum mismatch and the file is removed

  Scenario: prefers AT_CLIENT_WEB_BUNDLE when set
    Given AT_CLIENT_WEB_BUNDLE names a bundle
    When the build picks its source
    Then it uses that bundle rather than the fetched one

  Scenario: points at ci:prepare when nothing is there
    Given no override and no fetched bundle
    When the build picks its source
    Then it throws a message telling the caller to run npm run ci:prepare
