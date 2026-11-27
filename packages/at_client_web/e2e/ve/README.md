# Local atServer virtual environment (VE) probe

`probe.mjs` checks that the local at_server virtual environment (docker image
`atsigncompany/virtualenv`, pinned by digest in `image.lock` and
`docker-compose.yaml`) is usable from Chromium before any VE test is written.
It writes seven pass/fail checks to `probe.json` (gitignored) and exits
non-zero if any fails. It starts the VE (project `at_client_web_ve`, ports
26300-26399, root on 26300) and always takes it down again.

## Prerequisites

- Docker. On a host where your user is not in the `docker` group's login
  session, every call runs as `sg docker -c 'docker …'`; the probe does this
  itself.
- `AT_VE_CERTS_DIR`: the VE certificate folder from at_server commit
  `a158b700d4b6aaaeb7e3d8ba56df8948157f0b1d`,
  `tools/build_virtual_environment/ve_base/contents/atsign/secondary/base/certs`
  (a sparse, blob-filtered clone is enough).
- The demo keys in `AT_VE_KEYS_DIR` (default `$TMPDIR/ve-keys`). When they are
  missing, `mint.mjs` mints them from a throwaway copy of an at_client_sdk
  checkout's `tests/at_end2end_test` (`AT_VE_SDK_TEST_DIR`) with Dart
  (`AT_VE_DART`, default `dart` on `PATH`). These are the public demo fixtures
  of `at_demo_data` for `@alice🛠 @bob🛠 @colin🛠 @eve🛠`, not anyone's keys;
  the probe still never prints them.
- Playwright's Chromium, and a built package (`npm run build`).

## Run

```bash
npm run build
AT_VE_CERTS_DIR=<certs dir> AT_VE_KEYS_DIR=$TMPDIR/ve-keys node e2e/ve/probe.mjs
```

## Checks

1. the container is up on 26300-26399 and the root answers;
2. the image's `fullchain.pem` is byte-equal to a158b700's;
3. the root answers the bridge's HTTPS directory lookup for `@alice🛠`;
4. Chromium opens `wss://vip.ve.atsign.zone:<atServer port>/ws`;
5. a `proxy:` root reaches the atServer through `flaky-proxy.mjs`, a plain TCP
   pass-through (`dropFirst` closes the first n connections);
6. `AtClient.create` against the VE root reaches `connected`;
7. the four demo keys files parse as JSON objects.

## The keyless suite

`ve.spec.ts` (V1-V8, `npm run e2e:ve`, project `ve`) runs against the same
VE. `global-setup.ts` starts it and `global-teardown.ts` takes it down; both do
nothing unless `AT_VE=1`. The suite decrypts the legacy self-encrypted fields of
the demo keys before the page sees them, because the bridge takes the plain
document rather than one it has to self-decrypt.

```bash
npm run build
AT_VE_CERTS_DIR=<certs dir> npm run e2e:ve   # VE_RUNS=5 by default
```

The atServer asks the browser for a client certificate during its TLS
handshake, and Chromium cancels a WebSocket upgrade to such an origin unless a
top-level navigation to the origin already cached the decision. The suite
therefore opens `https://vip.ve.atsign.zone:<port>/` on a second page of the
same context before the first `create` (`prenav.ts`). Set `VE_PRENAVIGATE=0`
to switch this off, for example to try a bridge-side pre-flight instead.
