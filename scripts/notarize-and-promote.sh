#!/usr/bin/env bash
set -euo pipefail

# Notarize the vmm binary from a pre-release and promote it to a full release.
# Promoting the release triggers the publish.yml workflow which publishes to npm.
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
SUBMISSION_FILE=".notarization-${TAG}"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

NOTARY_ARGS=(--keychain-profile "sandboxctl")

# Submit for notarization (skip if we already have a submission ID)
if [[ -f "$SUBMISSION_FILE" ]]; then
  SUBMISSION_ID=$(cat "$SUBMISSION_FILE")
  echo "Resuming existing submission: $SUBMISSION_ID"
else
  echo "Downloading vmm binary from $TAG..."
  gh release download "$TAG" --pattern "vmm" --output "$WORK_DIR/vmm"
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

echo "Notarization accepted! Promoting $TAG to full release..."
gh release edit "$TAG" --prerelease=false --latest

rm -f "$SUBMISSION_FILE"
echo "Done! $TAG is live. The publish workflow will push to npm shortly."
