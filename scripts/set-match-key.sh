#!/usr/bin/env bash
# Creates the secret key that seals all matches and stores it in Cloudflare
# WITHOUT ever printing it. Run once, before starting the game.
# Cloudflare never shows a secret again after it's been set.
set -euo pipefail
PROJECT="${1:-berlinmallusanta}"
openssl rand -base64 32 | tr -d '\n' | npx wrangler pages secret put MATCH_KEY --project-name "$PROJECT" >/dev/null
echo "✅ MATCH_KEY set for project '$PROJECT'. It was never shown, and nobody (you included) knows it."
echo "⚠️  Don't run this again after the game has started, or nobody will be able to open their envelope."
