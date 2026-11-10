#!/usr/bin/env bash
# Creates the secret key that seals all matches.
#
#   ./scripts/set-match-key.sh            real site: stored in Cloudflare WITHOUT ever being printed.
#                                         Cloudflare never shows a secret again after it's been set.
#   ./scripts/set-match-key.sh --preview  test site (its own, different key), also never printed.
set -euo pipefail
PROJECT="${PROJECT:-berlinmallusanta}"
ENV=production; WHERE="the real site"
if [ "${1:-}" = "--preview" ]; then ENV=preview; WHERE="the test site"; fi

openssl rand -base64 32 | tr -d '\n' | npx wrangler pages secret put MATCH_KEY --project-name "$PROJECT" --env "$ENV" >/dev/null
echo "✅ MATCH_KEY set for $WHERE ('$PROJECT', $ENV). It was never shown, and nobody (you included) knows it."
echo "⚠️  Don't run this again after the game has started, or nobody will be able to open their envelope."
