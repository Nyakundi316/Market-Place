#!/usr/bin/env bash
# Generates the staging secrets nobody has to look up and stores them; values are never
# printed. Safe to re-run: every run replaces all of them with fresh ones (users get
# signed out, and browsers have to switch push on again).
#   markethub-api-staging: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, INTERNAL_API_KEY, VAPID pair,
#                          REDIS_URL (DATABASE_URL comes from `fly postgres attach`)
#   markethub-web-staging: INTERNAL_API_KEY (same value as the API's)
#   markethub-redis-staging: REDIS_PASSWORD (redeploy Redis after a re-run so it takes effect)
#   GitHub environment "staging": JWT_ACCESS_SECRET (same as the API's, so k6 can sign tokens)
# Third-party keys (Paystack test, R2, Resend, Africa's Talking) still go in by hand:
# docs/RUNBOOK.md §11. Run from anywhere: bash infra/fly/set-staging-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

FLY=${FLY:-$(command -v flyctl || command -v fly || echo "$HOME/.fly/bin/flyctl")}

gen() { node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))"; }
A=$(gen); R=$(gen); I=$(gen); P=$(gen) # base64url: safe inside a URL as-is
V=$(node -e "const k=require('./apps/api/node_modules/web-push').generateVAPIDKeys();process.stdout.write(k.publicKey+' '+k.privateKey)")
VP=${V% *}; VK=${V#* }
[ ${#A} -ge 32 ] && [ "$A" != "$R" ] && [ -n "$VK" ] && [ "$VP" != "$VK" ] || { echo "generation failed"; exit 1; }

# --stage: stored now, applied on the next deploy
printf 'JWT_ACCESS_SECRET=%s\nJWT_REFRESH_SECRET=%s\nINTERNAL_API_KEY=%s\nVAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\nREDIS_URL=redis://:%s@markethub-redis-staging.internal:6379?family=6\n' \
  "$A" "$R" "$I" "$VP" "$VK" "$P" | "$FLY" secrets import -a markethub-api-staging --stage > /dev/null
printf 'INTERNAL_API_KEY=%s\n' "$I" | "$FLY" secrets import -a markethub-web-staging --stage > /dev/null
printf 'REDIS_PASSWORD=%s\n' "$P" | "$FLY" secrets import -a markethub-redis-staging --stage > /dev/null
printf '%s' "$A" | gh secret set JWT_ACCESS_SECRET --env staging
unset A R I P V VP VK

echo "--- markethub-api-staging";   "$FLY" secrets list -a markethub-api-staging | awk 'NR>1 {print "  " $1}'
echo "--- markethub-web-staging";   "$FLY" secrets list -a markethub-web-staging | awk 'NR>1 {print "  " $1}'
echo "--- markethub-redis-staging"; "$FLY" secrets list -a markethub-redis-staging | awk 'NR>1 {print "  " $1}'
echo "--- GitHub staging";          gh secret list --env staging
