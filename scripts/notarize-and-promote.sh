#!/usr/bin/env bash
set -euo pipefail

# Notarize the vmm binary from the staged npm package and approve all staged packages.
#
# Usage: ./scripts/notarize-and-promote.sh [tag]
#
# Prerequisites:
#   Store your App Store Connect API key in the Keychain once:
#     xcrun notarytool store-credentials "sandboxctl" \
#       --key /path/to/api_key.p8 \
#       --key-id <KEY_ID> \
#       --issuer <ISSUER_ID>

TAG=${1:-$(git describe --tags --abbrev=0)}
VERSION=${TAG#v}
SUBMISSION_FILE=".notarization-${TAG}"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

NOTARY_ARGS=(--keychain-profile "sandboxctl")

# Fetch staged packages and find those matching this release version
echo "Fetching staged packages..."
STAGED=$(npm stage list --json)

VMM_ID=$(echo "$STAGED" | python3 -c "
import sys, json
pkgs = json.load(sys.stdin)
for p in pkgs:
    if p['packageName'] == '@inputforge/sandboxctl-vmm' and p['version'] == '$VERSION':
        print(p['id'])
        break
")

if [[ -z "$VMM_ID" ]]; then
  echo "error: no staged @inputforge/sandboxctl-vmm@$VERSION found" >&2
  echo "Run 'npm stage list' to see what is currently staged." >&2
  exit 1
fi

ALL_IDS=$(echo "$STAGED" | python3 -c "
import sys, json
pkgs = json.load(sys.stdin)
for p in pkgs:
    if p['version'] == '$VERSION':
        print(p['id'])
")

# Submit for notarization (skip if we already have a submission ID)
if [[ -f "$SUBMISSION_FILE" ]]; then
  SUBMISSION_ID=$(cat "$SUBMISSION_FILE")
  echo "Resuming existing submission: $SUBMISSION_ID"
else
  echo "Downloading staged vmm tarball (id: $VMM_ID)..."
  npm stage download "$VMM_ID" --output "$WORK_DIR/vmm.tgz"
  tar -xzf "$WORK_DIR/vmm.tgz" -C "$WORK_DIR" --strip-components=2 package/dist/vmm
  chmod +x "$WORK_DIR/vmm"

  echo "Creating zip for notarization..."
  ditto -c -k --keepParent "$WORK_DIR/vmm" "$WORK_DIR/vmm.zip"

  echo "Submitting for notarization..."
  SUBMISSION_ID=$(
    xcrun notarytool submit "$WORK_DIR/vmm.zip" \
      "${NOTARY_ARGS[@]}" \
      --no-wait \
      --output-format json \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])"
  )

  echo "$SUBMISSION_ID" > "$SUBMISSION_FILE"
  echo "Submission ID: $SUBMISSION_ID (saved to $SUBMISSION_FILE)"
fi

# Wait for notarization to complete
echo "Waiting for notarization (this may take a while)..."
xcrun notarytool wait "$SUBMISSION_ID" "${NOTARY_ARGS[@]}"

STATUS=$(
  xcrun notarytool info "$SUBMISSION_ID" \
    "${NOTARY_ARGS[@]}" \
    --output-format json \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])"
)

if [[ "$STATUS" != "Accepted" ]]; then
  echo "error: notarization failed with status: $STATUS" >&2
  xcrun notarytool log "$SUBMISSION_ID" "${NOTARY_ARGS[@]}" >&2
  exit 1
fi

echo "Notarization accepted! Approving all staged packages for $TAG..."
while IFS= read -r id; do
  npm stage approve "$id"
done <<< "$ALL_IDS"

rm -f "$SUBMISSION_FILE"
echo "Done! $TAG packages are now live on npm."
