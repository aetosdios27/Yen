#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGO_SVG="$WEB_DIR/../../assets/logo.svg"
PUBLIC_ICONS="$WEB_DIR/public/icons"

mkdir -p "$PUBLIC_ICONS"

if command -v magick >/dev/null 2>&1; then
  IM_CMD="magick"
elif command -v convert >/dev/null 2>&1; then
  IM_CMD="convert"
else
  echo "Error: ImageMagick (magick or convert) is required to generate icons." >&2
  exit 1
fi

echo "Generating PWA icons from $LOGO_SVG using $IM_CMD..."

# 192x192 standard icon
$IM_CMD -background none "$LOGO_SVG" -resize 192x192 "$PUBLIC_ICONS/icon-192.png"

# 512x512 standard icon
$IM_CMD -background none "$LOGO_SVG" -resize 512x512 "$PUBLIC_ICONS/icon-512.png"

# Apple Touch Icon (180x180)
$IM_CMD -background none "$LOGO_SVG" -resize 180x180 "$PUBLIC_ICONS/apple-touch-icon.png"
cp "$PUBLIC_ICONS/apple-touch-icon.png" "$WEB_DIR/public/apple-touch-icon.png"

# Maskable 512x512 with safe-zone padding (~80% content area centered on 512x512 canvas with tile background #151518)
$IM_CMD "$LOGO_SVG" -resize 410x410 -background '#151518' -gravity center -extent 512x512 "$PUBLIC_ICONS/icon-maskable-512.png"

# Favicon
$IM_CMD -background none "$LOGO_SVG" -resize 32x32 "$WEB_DIR/public/favicon.ico"

echo "Icons generated successfully in $PUBLIC_ICONS"
