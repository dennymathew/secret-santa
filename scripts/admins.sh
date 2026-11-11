#!/usr/bin/env bash
# Manages who may sign in to the admin panel (with Google, via "Sign in as admin").
# Admins don't have to be on the participant list. Add as many as you like.
#
#   ./scripts/admins.sh add anu@gmail.com [more@gmail.com ...]   real site
#   ./scripts/admins.sh remove anu@gmail.com                      takes effect at their next click
#   ./scripts/admins.sh list
#   Add --preview for the test site, or --local for local development, e.g.:
#   ./scripts/admins.sh add anu@gmail.com --preview
# (Written for the bash that comes with macOS, 3.2.)
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { echo "Usage: $0 add|remove|list [email ...] [--preview | --local]"; exit 1; }
CMD="${1:-}"
[ $# -gt 0 ] && shift
DB=berlinmallusanta
WHERE_FLAGS="--remote"
WHERE="the real site"
EMAILS=""
for a in "$@"; do
  case "$a" in
    --preview) DB=berlinmallusanta-test; WHERE_FLAGS="--remote --env preview"; WHERE="the test site" ;;
    --local) WHERE_FLAGS="--local"; WHERE="local development" ;;
    -*) usage ;;
    *)
      e="$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')"
      # Strict check: it also keeps quotes and other SQL out of the commands below.
      [[ "$e" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "❌ \"$a\" isn't an email address."; exit 1; }
      EMAILS="$EMAILS $e" ;;
  esac
done

# shellcheck disable=SC2086  # WHERE_FLAGS is split on purpose
d1() { npx wrangler d1 execute "$DB" $WHERE_FLAGS "$@"; }

list() {
  echo "Admins on $WHERE:"
  d1 --json --command "SELECT email, added_at FROM admins ORDER BY email" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0].results;console.log(r.length?r.map(x=>"  "+x.email+"  (added "+x.added_at.slice(0,10)+")").join("\n"):"  (none yet)")})'
}

case "$CMD" in
  add|remove)
    [ -n "$EMAILS" ] || usage
    SQL=""
    for e in $EMAILS; do
      if [ "$CMD" = add ]; then SQL="$SQL INSERT OR IGNORE INTO admins (email) VALUES ('$e');"
      else SQL="$SQL DELETE FROM admins WHERE email = '$e';"; fi
    done
    d1 --command "$SQL" >/dev/null
    if [ "$CMD" = add ]; then echo "✅ Added on $WHERE:$EMAILS"; else echo "✅ Removed on $WHERE:$EMAILS"; fi
    list
    ;;
  list) list ;;
  *) usage ;;
esac
