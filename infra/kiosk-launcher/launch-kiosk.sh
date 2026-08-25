#!/usr/bin/env bash
# Launches the Lumina player in a Chromium kiosk window on unattended signage hardware
# (mini-PC, Raspberry Pi, etc. — anything with no touchscreen/keyboard). See
# apps/player/src/lib/audioUnlock.ts for why --autoplay-policy matters: without it, YouTube/video
# content plays silently until someone taps the screen, which never happens on this hardware.
set -euo pipefail

PLAYER_URL="${PLAYER_URL:-http://localhost:5000}"
PROFILE_DIR="${PROFILE_DIR:-$HOME/.config/lumina-kiosk}"

BROWSER=""
for candidate in chromium-browser chromium google-chrome google-chrome-stable; do
  if command -v "$candidate" >/dev/null 2>&1; then
    BROWSER="$candidate"
    break
  fi
done
if [ -z "$BROWSER" ]; then
  echo "No Chromium/Chrome binary found on PATH (tried chromium-browser, chromium, google-chrome, google-chrome-stable)." >&2
  exit 1
fi

# Disables the screen blanker/DPMS so a still frame doesn't get treated as "idle" and blanked —
# harmless if xset/X11 isn't present (e.g. a Wayland-only setup).
xset s off -dpms 2>/dev/null || true

exec "$BROWSER" \
  --kiosk "$PLAYER_URL" \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$PROFILE_DIR" \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000
