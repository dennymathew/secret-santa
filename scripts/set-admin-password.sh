#!/usr/bin/env bash
# Sets an admin panel password. Only a PBKDF2 hash is stored; the password itself is never saved anywhere.
#
# Personal password for one admin (recommended; run it once per admin, each with their own password):
#   ./scripts/set-admin-password.sh --email you@gmail.com            real site: secret ADMIN_PW_<email>
#   ./scripts/set-admin-password.sh --email you@gmail.com --preview  test site (preview)
#   ./scripts/set-admin-password.sh --email you@gmail.com --local    local dev: written into .dev.vars
#   That Google account may then sign in (even before it's on the list) and unlock the admin panel
#   with this password. Changing it logs out only that admin.
#
# Shared password (the older way: anyone on the list who knows it can unlock the admin panel):
#   ./scripts/set-admin-password.sh [--preview | --local]           secret ADMIN_PASSWORD_HASH
#   Changing it logs out everyone who uses it.
set -euo pipefail
PROJECT="${PROJECT:-berlinmallusanta}"
cd "$(dirname "$0")/.."

MODE=production
EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"; shift 2 ;;
    --preview|--local) MODE="$1"; shift ;;
    *) echo "Usage: $0 [--email you@gmail.com] [--preview | --local]"; exit 1 ;;
  esac
done
if [ -n "$EMAIL" ]; then
  [[ "$EMAIL" =~ ^[^@[:space:]|]+@[^@[:space:]|]+\.[^@[:space:]|]+$ ]] || { echo "❌ \"$EMAIL\" isn't an email address."; exit 1; }
  # ADMIN_PW_ + the email in capitals, other characters as _ (e.g. ADMIN_PW_DENNY_GMAIL_COM)
  NAME="ADMIN_PW_$(printf '%s' "$EMAIL" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"
  WHO="for $EMAIL"
else
  NAME="ADMIN_PASSWORD_HASH"
  WHO="(shared)"
fi

read -rsp "New admin password $WHO: " PW; echo
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
# A personal secret also carries the email it belongs to: "<email>|<hash>".
VALUE="$HASH"
[ -n "$EMAIL" ] && VALUE="$EMAIL|$HASH"

case "$MODE" in
  production)
    printf '%s' "$VALUE" | npx wrangler pages secret put "$NAME" --project-name "$PROJECT" --env production >/dev/null
    echo "✅ Admin password $WHO set for the real site ('$PROJECT', secret $NAME). Redeploy so it's picked up."
    ;;
  --preview)
    printf '%s' "$VALUE" | npx wrangler pages secret put "$NAME" --project-name "$PROJECT" --env preview >/dev/null
    echo "✅ Admin password $WHO set for the test site ('$PROJECT', preview, secret $NAME). Push to the test branch so it's picked up."
    ;;
  --local)
    touch .dev.vars
    grep -v "^$NAME=" .dev.vars > .dev.vars.tmp || true
    printf "%s='%s'\n" "$NAME" "$VALUE" >> .dev.vars.tmp
    mv .dev.vars.tmp .dev.vars
    echo "✅ Admin password $WHO set in .dev.vars ($NAME). Restart the local server."
    ;;
esac
