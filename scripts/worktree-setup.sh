#!/usr/bin/env bash
# =============================================================================
# worktree-setup.sh — bootstrap de cada worktree nuevo de Orca
#
# Configuración (una vez): Orca → Settings del repo "UADE Innova" →
#   Setup script → `bash scripts/worktree-setup.sh`
# Corre automáticamente al crear cualquier worktree nuevo (setupRunPolicy:
# run-by-default), en paralelo con el agente (--agent opencode/codex).
#
# Hace:
#   1. Abre la página de credenciales en el browser embebido de Orca,
#      SCOPED AL WORKTREE donde corre el script (cada workspace ve su propio
#      tab; los tabs de un worktree no se ven desde otro workspace).
#      - Si el worktree ya tiene tab → `goto` lo navega/enfoca (sin duplicar).
#      - Si no tiene ninguno (`browser_no_tab`) → `tab create` primero.
#   2. Deja comment en ese mismo worktree con login + credenciales.
#
# Es best-effort: nunca debe fallar el setup del worktree por acá.
# =============================================================================
set -uo pipefail

CREDENCIAS_URL="https://share.onorca.dev/a/Z7HBFVzhGN7Z"
LOGIN_URL="https://agreeable-beach-002ff0c0f.6.azurestaticapps.net/#/login"

ORCA_BIN="$(command -v orca || true)"
if [[ -z "$ORCA_BIN" ]]; then
  echo "[worktree-setup] orca CLI no disponible — skip browser bootstrap."
  exit 0
fi

# Resolver el worktree actual desde el cwd del runner (el checkout nuevo).
WT_ID="$("$ORCA_BIN" worktree current --json 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get('result',{}).get('worktree',{}).get('id',''))
except Exception:
    print('')" 2>/dev/null || true)"

open_credentials_in_worktree() {
  # Sin worktree resuelto: fallback global (mejor que nada).
  if [[ -z "$WT_ID" ]]; then
    "$ORCA_BIN" goto --url "$CREDENCIAS_URL" --json >/dev/null 2>&1
    return $?
  fi

  local OUT CODE
  OUT="$("$ORCA_BIN" goto --url "$CREDENCIAS_URL" --worktree "id:$WT_ID" --json 2>/dev/null)"
  CODE=$?
  if [[ $CODE -eq 0 ]]; then
    return 0
  fi

  # Sin tabs en este worktree todavía → crear uno scoped y navegarlo.
  if printf '%s' "$OUT" | grep -q 'browser_no_tab'; then
    "$ORCA_BIN" tab create --url "$CREDENCIAS_URL" --worktree "id:$WT_ID" --json >/dev/null 2>&1
    return $?
  fi

  return "$CODE"
}

echo "[worktree-setup] abriendo credenciales en el browser de Orca (worktree: ${WT_ID##*::}..."
open_credentials_in_worktree \
  || echo "[worktree-setup] aviso: no se pudo abrir $CREDENCIAS_URL"

# Comentar EL MISMO worktree para trazabilidad (best-effort, no bloquea).
if [[ -n "$WT_ID" ]]; then
  "$ORCA_BIN" worktree set --worktree "id:$WT_ID" \
    --comment "bootstrap ok — credenciales: $CREDENCIAS_URL · login: $LOGIN_URL" \
    --json >/dev/null 2>&1 || true
fi

echo "[worktree-setup] listo. Login: $LOGIN_URL · Credenciales abiertas para este workspace."
exit 0
