#!/usr/bin/env bash
# Creates the secret key that seals all matches.
#
#   ./scripts/set-match-key.sh            real site: stored in Cloudflare WITHOUT ever being printed.
#                                         Cloudflare never shows a secret again after it's been set.
#   ./scripts/set-match-key.sh --preview  test site: prints a fresh key to paste into the dashboard (Preview).
#                                         Seeing it is fine there, the test site only has throwaway matches.
set -euo pipefail
PROJECT="${PROJECT:-berlinmallusanta}"

if [ "${1:-}" = "--preview" ]; then
  echo "Paste this as a SECRET named MATCH_KEY in the Cloudflare dashboard:"
  echo "  Workers & Pages → $PROJECT → Settings → Variables and Secrets → Preview → Add → Secret"
  echo
  openssl rand -base64 32
  echo
  echo "⚠️  Only for the TEST site. Never use this key for the real site."
  exit 0
fi

openssl rand -base64 32 | tr -d '\n' | npx wrangler pages secret put MATCH_KEY --project-name "$PROJECT" >/dev/null
echo "✅ MATCH_KEY set for project '$PROJECT'. It was never shown, and nobody (you included) knows it."
echo "⚠️  Don't run this again after the game has started, or nobody will be able to open their envelope."
