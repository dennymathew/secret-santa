#!/usr/bin/env bash
# Sets the admin panel password. Only a PBKDF2 hash is stored; the password itself is never saved anywhere.
#
#   ./scripts/set-admin-password.sh            real site: stores the hash as the Cloudflare secret ADMIN_PASSWORD_HASH
#   ./scripts/set-admin-password.sh --preview  test site: prints the hash to paste into the dashboard (Preview)
#   ./scripts/set-admin-password.sh --local    local dev: writes the hash into .dev.vars
#
# Changing the password logs out everyone who has the admin panel open.
set -euo pipefail
MODE="${1:-production}"
PROJECT="${PROJECT:-berlinmallusanta}"
cd "$(dirname "$0")/.."

read -rsp "New admin password: " PW; echo
read -rsp "Same password again: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "❌ The passwords don't match."; exit 1; }
[ "${#PW}" -ge 10 ] || { echo "❌ Please use at least 10 characters."; exit 1; }

# pbkdf2$<iterations>$<salt>$<hash>, same format as functions/lib/adminAuth.ts (100k = the Workers maximum)
HASH=$(PW="$PW" node -e '
  const c = require("crypto");
  const salt = c.randomBytes(16);
  const hash = c.pbkdf2Sync(process.env.PW, salt, 100000, 32, "sha256");
  process.stdout.write(`pbkdf2$100000$${salt.toString("base64url")}$${hash.toString("base64url")}`);
')
unset PW PW2

case "$MODE" in
  production)
    printf '%s' "$HASH" | npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name "$PROJECT" >/dev/null
    echo "✅ Admin password set for the real site ('$PROJECT'). Redeploy so it's picked up."
    ;;
  --preview)
    echo "Paste this as a SECRET named ADMIN_PASSWORD_HASH in the Cloudflare dashboard:"
    echo "  Workers & Pages → $PROJECT → Settings → Variables and Secrets → Preview → Add → Secret"
    echo
    echo "$HASH"
    echo
    echo "(This is only a hash. The password itself can't be read back from it.)"
    ;;
  --local)
    touch .dev.vars
    grep -v '^ADMIN_PASSWORD_HASH=' .dev.vars > .dev.vars.tmp || true
    printf "ADMIN_PASSWORD_HASH='%s'\n" "$HASH" >> .dev.vars.tmp
    mv .dev.vars.tmp .dev.vars
    echo "✅ Admin password set in .dev.vars. Restart the local server."
    ;;
  *)
    echo "Usage: $0 [--preview | --local]"; exit 1 ;;
esac
