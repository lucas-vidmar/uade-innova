#!/usr/bin/env bash
# =============================================================================
# worktree-setup.sh — bootstrap de cada worktree nuevo de Orca
#
# Configuración (una vez): Orca → Settings del repo "UADE Innova" →
#   Setup script → `bash scripts/worktree-setup.sh`
# Corre automáticamente al crear cualquier worktree nuevo (setupRunPolicy:
# run-by-default), en paralelo con el agente (--agent opencode/codex).
#
# Hace (todo scoped AL WORKTREE donde corre el script — cada workspace ve sus
# propios tabs; los tabs de un worktree no se ven desde otro workspace):
#   1. Abre UNA TAB con las credenciales de prueba.
#   2. Abre OTRA TAB con la SWA de producción (login).
#      - Si ya existe una tab con esa URL en este worktree → solo la enfoca
#        (sin duplicar ni pisar las demás).
#      - Si no existe → `tab create` scoped al worktree (nunca `goto` sobre
#        la tab activa: pisaría la anterior).
#   3. Deja comment en ese mismo worktree con login + credenciales.
#
# Es best-effort: nunca debe fallar el setup del worktree por acá.
# =============================================================================
set -uo pipefail

CREDENCIAS_URL="https://share.onorca.dev/a/Z7HBFVzhGN7Z"
PROD_URL="https://agreeable-beach-002ff0c0f.6.azurestaticapps.net/#/login"
LOGIN_URL="$PROD_URL"

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

# open_url_in_worktree <URL>
#   Dedupe por (worktreeId, url-prefix): si ya hay tab → enfocar con --page;
#   si no → `tab create` nueva scoped. Nunca navega la tab activa de otra URL.
open_url_in_worktree() {
  local URL="$1"

  # Sin worktree resuelto: fallback global (mejor que nada).
  if [[ -z "$WT_ID" ]]; then
    "$ORCA_BIN" goto --url "$URL" --json >/dev/null 2>&1
    return $?
  fi

  local PAGE_ID
  PAGE_ID="$("$ORCA_BIN" tab list --json 2>/dev/null | WT_ID="$WT_ID" URL="$URL" python3 -c "
import json,sys,os
try:
    d=json.load(sys.stdin)
    wt=os.environ['WT_ID']; url=os.environ['URL']
    hit=[t for t in d.get('result',{}).get('tabs',[])
         if t.get('worktreeId')==wt and (t.get('url') or '').startswith(url)]
    print(hit[0].get('browserPageId','') if hit else '')
except Exception:
    print('')" 2>/dev/null || true)"

  if [[ -n "$PAGE_ID" ]]; then
    "$ORCA_BIN" goto --url "$URL" --page "$PAGE_ID" --json >/dev/null 2>&1
    return $?
  fi

  "$ORCA_BIN" tab create --url "$URL" --worktree "id:$WT_ID" --json >/dev/null 2>&1
}

echo "[worktree-setup] abriendo tabs en el browser de Orca (worktree: ${WT_ID##*::}..."

echo "  → credenciales"
open_url_in_worktree "$CREDENCIAS_URL" \
  || echo "[worktree-setup] aviso: no se pudo abrir $CREDENCIAS_URL"

echo "  → producción (SWA)"
open_url_in_worktree "$PROD_URL" \
  || echo "[worktree-setup] aviso: no se pudo abrir $PROD_URL"

# Comentar EL MISMO worktree para trazabilidad (best-effort, no bloquea).
if [[ -n "$WT_ID" ]]; then
  "$ORCA_BIN" worktree set --worktree "id:$WT_ID" \
    --comment "bootstrap ok — prod: $PROD_URL · credenciales: $CREDENCIAS_URL" \
    --json >/dev/null 2>&1 || true
fi

echo "[worktree-setup] listo. Producción y credenciales abiertas para este workspace."
exit 0
