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

  Scenario: copy-bundle accepts a fetched bundle whose sha256 matches bridge.ref
    Given a fetched bundle whose sha256 is the pinned one
    When the build verifies its source
    Then it uses the fetched bundle

  Scenario: copy-bundle rejects a fetched bundle whose sha256 differs from bridge.ref
    Given a fetched bundle whose sha256 differs from the pinned one
    When the build verifies its source
    Then it throws a checksum mismatch and the bundle is removed

  Scenario: copy-bundle skips the checksum when AT_CLIENT_WEB_BUNDLE is set
    Given AT_CLIENT_WEB_BUNDLE names a bundle
    When the build verifies its source
    Then it uses that bundle without checking its sha256

  Scenario: fetch-bridge pins the source ref and denies self-hosted runners
    Given the fetched bundle
    When the attestation check is built
    Then it names the release workflow, the trunk source ref and denies self-hosted runners

  # Threats: forgery -- attestation stays mandatory, and a gh that cannot attest
  # fails closed instead of skipping the check; impersonation -- the signer
  # workflow and source ref are pinned literals, never taken from the release.

  Scenario: fetch-bridge names a missing gh and the minimum version
    Given no working gh on PATH
    When the bridge is fetched
    Then it fails naming gh 2.49.0 or later and downloads nothing

  Scenario: fetch-bridge names a gh without the attestation command
    Given a gh version 2.46.0 without an attestation command
    When the bridge is fetched
    Then it fails naming that version, the attestation command and the minimum version

  Scenario: fetch-bridge names attestation flags this gh lacks
    Given a gh whose attestation help omits a flag the check passes
    When the bridge is fetched
    Then it fails naming the missing flag

  Scenario: fetch-bridge runs the attestation check with the pinned signer workflow
    Given a pinned bridge.ref and a download that matches its sha256
    When the bridge is fetched with an injected runner
    Then it attests the file against the literal signer workflow, refs/heads/trunk and denies self-hosted runners

  # A publish re-derives dist/dart/at_client.js from the sha-checked bridge, so
  # forgery cannot ship an unverified bundle and a stale dist from an older pin
  # fails the byte comparison. Race and DoS are not applicable: the checks run
  # once, offline, before anything is packed.

  Scenario: verify-dist refuses to publish when AT_CLIENT_WEB_BUNDLE is set
    Given AT_CLIENT_WEB_BUNDLE names a local bundle
    When the publish guard runs
    Then it refuses and names AT_CLIENT_WEB_BUNDLE

  Scenario: verify-dist refuses a dist missing index.js, index.d.ts or dart/at_client.js
    Given a dist without one of its three required files
    When verify-dist runs
    Then it refuses and names the missing file

  Scenario: the publish guard names ci:prepare when .bridge is missing or its sha differs from bridge.ref
    Given no fetched bundle, or one whose sha256 differs from bridge.ref
    When the publish guard runs
    Then it refuses with a message naming npm run ci:prepare

  Scenario: the publish guard passes on a tree with no dist
    Given a verified fetched bundle and no dist directory
    When the publish guard runs
    Then it passes without reading dist

  Scenario: verify-dist refuses a dist bundle that is not the stripped verified bridge
    Given a dist bundle that still carries its sourceMappingURL comment
    When verify-dist runs
    Then it refuses; the stripped bridge passes

  Scenario: package.json runs build and verify-dist on prepack and the publish guard on prepublishOnly
    Given the package manifest
    When its scripts are read
    Then prepack builds and verifies and prepublishOnly runs only the publish guard

  Scenario: npm publish --dry-run on a clean copy runs the guard, then builds and verifies dist
    Given a clean copy of the package with a fixture bridge pin
    When npm publish --dry-run runs offline
    Then the guard, the build and verify-dist each succeed in that order and dist exists

  Scenario: npm publish --dry-run refuses in prepublishOnly, before any build, when AT_CLIENT_WEB_BUNDLE is set
    Given a clean copy of the package and AT_CLIENT_WEB_BUNDLE set
    When npm publish --dry-run runs offline
    Then it exits non-zero naming the override and no dist is built

  Scenario: the package declares no engines
    Given the package manifest
    When it is read
    Then it has no engines field

  Scenario: the package exports its package.json
    Given the package manifest
    When a consumer resolves @atsign/at_client_web/package.json
    Then the export is declared and the consumer resolves it
