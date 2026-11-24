# Decisions

| ID | Decision | Status | Decided by | Date |
|---|---|---|---|---|
| D-1 | Review ownership and routing are declared in `.github/CODEOWNERS`, which names the owners for every path and for the dependency, workspace-manifest and CI-version paths. Trunk requires one approving review from a code owner. | Accepted | Srie Teja | 2026-11-23 |

D-1 also settles the branch-protection options: `dismiss_stale_reviews` stays disabled, and `require_last_push_approval` is enabled so an approving review no longer covers a later push.
