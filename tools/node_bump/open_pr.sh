#!/usr/bin/env bash
# Opens the bump PR for VERSION: branch from BASE_SHA, write .node-version via the
# contents API, open the PR, dispatch CI on the branch. Needs env REPO, BASE_SHA, VERSION
# and gh on PATH.
set -euo pipefail

[[ "${VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid VERSION" >&2; exit 1; }

branch="bot/node-${VERSION}"
if gh api "repos/${REPO}/git/ref/heads/${branch}" --silent 2>/dev/null; then
  echo "${branch} already exists; nothing to do"
  exit 0
fi
gh api "repos/${REPO}/git/refs" --silent \
  -f ref="refs/heads/${branch}" -f sha="${BASE_SHA}"
# A failure before the PR exists must not leave a PR-less branch that blocks later runs.
trap 'gh api -X DELETE "repos/${REPO}/git/refs/heads/${branch}" --silent || true' EXIT
file_sha="$(gh api "repos/${REPO}/contents/.node-version?ref=${branch}" --jq .sha)"
content="$(printf '%s\n' "${VERSION}" | base64 | tr -d '\n')"
gh api -X PUT "repos/${REPO}/contents/.node-version" --silent \
  -f message="ci: bump Node to ${VERSION}" \
  -f content="${content}" \
  -f sha="${file_sha}" \
  -f branch="${branch}"
gh pr create --repo "${REPO}" --base trunk --head "${branch}" \
  --title "ci: bump Node to ${VERSION}" \
  --body "Weekly bump of the pinned Node patch to ${VERSION}, the newest release of the current major that is at least 7 days old."
trap - EXIT
gh workflow run ci.yaml --repo "${REPO}" --ref "${branch}"
