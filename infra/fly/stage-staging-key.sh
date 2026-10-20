#!/usr/bin/env bash
# Stages the hand-entered staging keys on markethub-api-staging, straight from the clipboard.
# Nothing is pasted at a prompt: PowerShell's Read-Host once stored Ctrl+V as one control
# character in five secrets. Start it, then copy each value when it asks; it sees the
# clipboard change, checks the value, stages it, clears the clipboard and asks for the next.
# Values are never printed.
#   bash infra/fly/stage-staging-key.sh                  # all four, in order
#   bash infra/fly/stage-staging-key.sh S3_SECRET_KEY    # just that one
# Staged keys apply on the next deploy (Actions → Deploy → staging), where
# packages/shared/src/env.ts checks them again.
set -euo pipefail

FLY=${FLY:-$(command -v flyctl || command -v fly || echo "$HOME/.fly/bin/flyctl")}
APP=markethub-api-staging

if command -v powershell.exe > /dev/null; then
  clipboard_raw() { powershell.exe -NoProfile -Command 'Get-Clipboard -Raw'; }
  clear_clipboard() { powershell.exe -NoProfile -Command 'Set-Clipboard -Value $null'; }
elif command -v pbpaste > /dev/null; then
  clipboard_raw() { pbpaste; }
  clear_clipboard() { pbcopy < /dev/null; }
else
  clipboard_raw() { xclip -selection clipboard -o 2> /dev/null || true; }
  clear_clipboard() { xclip -selection clipboard < /dev/null; }
fi
# Copying from a web page often brings a trailing newline or space along
clipboard() { clipboard_raw | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

where() {
  case "$1" in
    S3_ENDPOINT) echo "Cloudflare → R2 → Overview → S3 API" ;;
    S3_ACCESS_KEY) echo "the R2 API token's Access Key ID" ;;
    S3_SECRET_KEY) echo "the R2 API token's Secret Access Key" ;;
    PAYSTACK_SECRET_KEY) echo "Paystack → Settings → API Keys & Webhooks → Test Secret Key" ;;
    *) return 1 ;;
  esac
}

# Sets $why when $value can't be $1, otherwise $shown: what's safe to say about it
check() {
  why= shown=
  case "$1" in
    S3_ENDPOINT)
      local note=
      # A bucket's own "S3 API" URL ends in /<bucket>; path-style requests add that themselves
      if [[ $value =~ ^(https://[a-z0-9.-]+\.r2\.cloudflarestorage\.com)(/[a-z0-9-]+)/?$ ]]; then
        value=${BASH_REMATCH[1]} note=", ${BASH_REMATCH[2]} dropped"
      fi
      value=${value%/}
      [[ $value =~ ^https://[a-z0-9.-]+$ ]] || why="expected https://<account id>.r2.cloudflarestorage.com"
      shown="https://…${value#*.}$note" ;;
    S3_ACCESS_KEY)
      [[ $value =~ ^[0-9a-f]{32}$ ]] ||
        why="an Access Key ID is 32 hex characters, that was ${#value} (the token value is a different thing)"
      shown="${#value} chars" ;;
    S3_SECRET_KEY)
      [[ $value =~ ^[0-9a-f]{64}$ ]] || why="a Secret Access Key is 64 hex characters, that was ${#value}"
      shown="${#value} chars" ;;
    PAYSTACK_SECRET_KEY)
      if [[ $value =~ ^sk_test_[A-Za-z0-9]+$ ]]; then :
      elif [[ $value =~ ^(sk|pk)_(test|live)_ ]]; then why="staging takes the test secret key, that's ${BASH_REMATCH[0]}…"
      else why="expected the test secret key, sk_test_…, that was ${#value} characters"; fi
      shown="sk_test_…, ${#value} chars" ;;
  esac
  [ -z "$why" ]
}

names=("$@")
[ $# -gt 0 ] || names=(S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY PAYSTACK_SECRET_KEY)
for name in "${names[@]}"; do
  where "$name" > /dev/null || { echo "usage: $0 [S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY|PAYSTACK_SECRET_KEY]" >&2; exit 2; }
done

seen=$(clipboard) # what's there now (likely this very command) isn't a key
for name in "${names[@]}"; do
  echo "Copy $name: $(where "$name")"
  deadline=$((SECONDS + 600))
  while :; do
    [ $SECONDS -lt $deadline ] || { echo "Gave up waiting for $name after 10 minutes." >&2; exit 1; }
    sleep 1
    value=$(clipboard)
    [ -n "$value" ] && [ "$value" != "$seen" ] || continue
    seen=$value
    check "$name" && break
    echo "  not stored: $why. Waiting for the next copy…"
  done

  lines="$name=$value"
  # Paystack signs webhooks with the secret key itself (RUNBOOK §2)
  [ "$name" != PAYSTACK_SECRET_KEY ] || lines+=$'\n'"PAYSTACK_WEBHOOK_SECRET=$value"
  # Fly's API answers "unauthorized" now and then, and is fine a moment later
  for try in 1 2 3; do
    printf '%s\n' "$lines" | "$FLY" secrets import -a "$APP" --stage > /dev/null && break
    [ $try -lt 3 ] || { echo "flyctl didn't take $name (error above). Run this again for $name and the keys after it." >&2; exit 1; }
    sleep 3
  done
  unset lines
  clear_clipboard
  seen=
  echo "  staged ($shown)"
done
unset value seen

# Five keys once shared one digest, all the same stray character. They shouldn't now.
echo "Digests on $APP:"
"$FLY" secrets list -a "$APP" | awk '/S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY|PAYSTACK_/ {print "  " $1, $3, $5}' ||
  echo "  (couldn't list them just now; fly secrets list -a $APP)"
