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
#   1. Abre en el browser embebido de Orca la página de credenciales de prueba.
#   2. Deja registro en el comment del worktree de que el bootstrap corrió.
#
# Es best-effort: nunca debe fallar el setup del worktree por acá.
# =============================================================================
set -uo pipefail

CREDENCIAS_URL="https://share.onorca.dev/a/Z7HBFVzhGN7Z"
LOGIN_URL="https://agreeable-beach-002ff0c0f.6.azurestaticapps.net/#/login"

# Resolver el binario orca (en terminales gestionadas por Orca siempre existe).
ORCA_BIN="$(command -v orca || true)"
if [[ -z "$ORCA_BIN" ]]; then
  echo "[worktree-setup] orca CLI no disponible — skip browser bootstrap."
  exit 0
fi

echo "[worktree-setup] abriendo credenciales de prueba en el browser de Orca..."
"$ORCA_BIN" goto --url "$CREDENCIAS_URL" --json >/dev/null 2>&1 \
  || echo "[worktree-setup] aviso: no se pudo abrir $CREDENCIAS_URL"

# Comentar el worktree activo para trazabilidad (best-effort, no bloquea).
"$ORCA_BIN" worktree set --worktree active \
  --comment "bootstrap ok — credenciales: $CREDENCIAS_URL · login: $LOGIN_URL" \
  --json >/dev/null 2>&1 || true

echo "[worktree-setup] listo. Login: $LOGIN_URL · Credenciales: $CREDENCIAS_URL"
exit 0
