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
#   1. Abre UNA TAB con las credenciales de prueba (URL directa de contenido
#      para botones copiar, con dedupe también por slug del share).
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

CREDENCIALES_SHARE_URL="https://share.onorca.dev/a/Z7HBFVzhGN7Z"
CREDENCIALES_URL="https://content.orcausercontent.dev/usercontent/Z7HBFVzhGN7Z/artifact.html"
PROD_URL="https://agreeable-beach-002ff0c0f.6.azurestaticapps.net/#/login"
LOGIN_URL="$PROD_URL"

# `command -v orca` can resolve to a broken /usr/local/bin shim
# ("Unable to determine Orca.app path"). Prefer a working binary.
ORCA_BIN=""
for _cand in "$(command -v orca 2>/dev/null || true)" \
  "/Applications/Orca.app/Contents/Resources/bin/orca"; do
  if [[ -n "$_cand" && -x "$_cand" ]] && "$_cand" status --json >/dev/null 2>&1; then
    ORCA_BIN="$_cand"
    break
  fi
done
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

# open_url_in_worktree <URL> [MATCH]
#   Dedupe por (worktreeId, url-prefix o substring MATCH): si ya hay tab
#   → enfocar con --page; si no → `tab create` nueva scoped.
#   Nunca navega la tab activa de otra URL.
open_url_in_worktree() {
  local URL="$1"
  local MATCH="${2:-$1}"

  # Sin worktree resuelto: fallback global (mejor que nada).
  if [[ -z "$WT_ID" ]]; then
    "$ORCA_BIN" goto --url "$URL" --json >/dev/null 2>&1
    return $?
  fi

  local PAGE_ID
  PAGE_ID="$("$ORCA_BIN" tab list --json 2>/dev/null | WT_ID="$WT_ID" URL="$URL" MATCH="$MATCH" python3 -c "
import json,sys,os
try:
    d=json.load(sys.stdin)
    wt=os.environ['WT_ID']; url=os.environ['URL']; m=os.environ['MATCH']
    hit=[t for t in d.get('result',{}).get('tabs',[])
         if t.get('worktreeId')==wt and ((t.get('url') or '').startswith(url) or m in (t.get('url') or ''))]
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
open_url_in_worktree "$CREDENCIALES_URL" "Z7HBFVzhGN7Z" \
  || echo "[worktree-setup] aviso: no se pudo abrir $CREDENCIALES_URL"

echo "  → producción (SWA)"
open_url_in_worktree "$PROD_URL" \
  || echo "[worktree-setup] aviso: no se pudo abrir $PROD_URL"

# Comentar EL MISMO worktree para trazabilidad (best-effort, no bloquea).
if [[ -n "$WT_ID" ]]; then
  "$ORCA_BIN" worktree set --worktree "id:$WT_ID" \
    --comment "bootstrap ok — prod: $PROD_URL · credenciales: $CREDENCIALES_SHARE_URL" \
    --json >/dev/null 2>&1 || true
fi

echo "[worktree-setup] listo. Producción y credenciales abiertas para este workspace."
exit 0
