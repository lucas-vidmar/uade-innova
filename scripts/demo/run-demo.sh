#!/usr/bin/env bash
# run-demo.sh — graba los videos demostrativos con testreel.
#
#   ./run-demo.sh <student|teacher|director|admin|all> [--concat] [--format mp4]
#
# Requiere: DEMO_BASE_URL y las credenciales del rol (ver README.md).
set -euo pipefail

cd "$(dirname "$0")"

ROLE="${1:-all}"
shift || true
CONCAT=false
FORMAT="mp4"
for arg in "$@"; do
  case "$arg" in
    --concat) CONCAT=true ;;
    --format) FORMAT="${2:-mp4}" ;;
  esac
done

: "${DEMO_BASE_URL:?falta DEMO_BASE_URL (ej: https://agreeable-beach-002ff0c0f.6.azurestaticapps.net)}"

OUT="testreel-output"
mkdir -p "$OUT"

roles=()
if [ "$ROLE" = "all" ]; then
  roles=(student teacher director admin)
else
  roles=("$ROLE")
fi

videos=()
for r in "${roles[@]}"; do
  def="recordings/${r}.json"
  [ -f "$def" ] || { echo "no existe $def" >&2; exit 1; }
  echo "=== grabando rol: $r ==="
  npx testreel "$def" --format "$FORMAT"
  latest=$(ls -t "$OUT"/${r}-*."$FORMAT" 2>/dev/null | head -1 || true)
  [ -n "$latest" ] && videos+=("$latest")
done

if [ "$CONCAT" = "true" ] && [ "${#videos[@]}" -gt 1 ]; then
  list="$OUT/concat-list.txt"
  : > "$list"
  for v in "${videos[@]}"; do echo "file '$(basename "$v")'" >> "$list"; done
  final="$OUT/uade-innova-demo-$(date +%Y%m%d-%H%M%S).$FORMAT"
  ffmpeg -y -f concat -safe 0 -i "$list" -c copy "$final"
  echo "video combinado: $final"
fi

echo "listo. salida en $OUT/"
