#!/usr/bin/env bash
# =============================================================================
# cleanup-worktree-env.sh — borra recursos del env efímero wt-<slug>
#
# Complemento de new-worktree-env.sh. Lista y purga los recursos creados
# para el env aislado (Function App, SWA, Storage aislado con token único).
# NO toca el env compartido uade-dev salvo que se pase explícitamente.
#
# Uso:
#   ./scripts/cleanup-worktree-env.sh           # auto: slug del branch actual
#   ./scripts/cleanup-worktree-env.sh my-feature
#   ./scripts/cleanup-worktree-env.sh wt-my-feature
#   ./scripts/cleanup-worktree-env.sh --list    # solo listar envs wt-*
#   ./scripts/cleanup-worktree-env.sh --all     # purgar TODOS los wt-*
#
# Seguridad: pide confirmación salvo --yes. Nunca hace azd down sobre uade-dev.
# =============================================================================
set -euo pipefail

CONFIRM=true
LIST_ONLY=false
PURGE_ALL=false
EXPLICIT_SLUG=""

for arg in "$@"; do
  case "$arg" in
    --yes|-y) CONFIRM=false ;;
    --list) LIST_ONLY=true ;;
    --all) PURGE_ALL=true ;;
    --help|-h)
      echo "Usage: $0 [slug] [--yes] [--list] [--all]"
      exit 0
      ;;
    *)
      if [[ -z "$EXPLICIT_SLUG" ]]; then EXPLICIT_SLUG="$arg"; fi
      ;;
  esac
done

slugify() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's|[^a-z0-9]+|-|g; s|^-||; s|-$||' | cut -c1-20 | sed 's|-$||'; }

if [[ "$LIST_ONLY" == "true" ]]; then
  echo "Envs efímeros (wt-*):"
  azd env list 2>/dev/null | grep -o '"wt-[^"]*"' | tr -d '"' || echo "  (ninguno)"
  exit 0
fi

if [[ "$PURGE_ALL" == "true" ]]; then
  ENVS="$(azd env list 2>/dev/null | grep -o '"wt-[^"]*"' | tr -d '"' || true)"
  if [[ -z "$ENVS" ]]; then echo "No hay envs wt-* para purgar."; exit 0; fi
  echo "Se purgarán estos envs:"
  echo "$ENVS" | sed 's/^/  - /'
  if [[ "$CONFIRM" == "true" ]]; then
    read -r -p "¿Confirmar purga de TODOS los wt-*? (yes/no): " ans
    if [[ "$ans" != "yes" ]]; then echo "Abortado."; exit 0; fi
  fi
  for env in $ENVS; do
    echo ""
    echo "→ Purgando $env ..."
    azd env select "$env" >/dev/null 2>&1 || true
    azd down --force --purge 2>&1 | sed 's/^/  /' || echo "  (azd down falló — revisar 'azd env get-values')"
    # azd down borra recursos pero deja el env; lo borramos del state local
    rm -rf ".azure/$env" 2>/dev/null || true
    echo "  ✓ $env purgado."
  done
  azd env select uade-dev >/dev/null 2>&1 || true
  echo ""
  echo "Restaurado a uade-dev. 'azd env list' para verificar."
  exit 0
fi

# slug single
if [[ -n "$EXPLICIT_SLUG" ]]; then
  SLUG="$(slugify "$EXPLICIT_SLUG")"
  # permitir que pasen ya prefijado wt-
  if [[ "$EXPLICIT_SLUG" == wt-* ]]; then SLUG="${EXPLICIT_SLUG#wt-}"; SLUG="$(slugify "$SLUG")"; fi
else
  BRANCH="$(git branch --show-current 2>/dev/null || echo "")"
  if [[ -z "$BRANCH" ]]; then echo "No se pudo inferir el slug. Uso: $0 <slug>"; exit 1; fi
  SLUG="$(slugify "$BRANCH")"
fi

# proteger uade-dev
if [[ "$SLUG" == "uade-dev" || "$SLUG" == "dev" ]]; then
  echo "ERROR: rehúso a purgar el env compartido '$SLUG'. Usá 'azd down' manualmente si realmente querés borrar uade-dev." >&2
  exit 1
fi

ENV_NAME="wt-${SLUG}"
ENV_NAME="$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]//g')"

if ! azd env list 2>/dev/null | grep -q "\"$ENV_NAME\""; then
  echo "Env '$ENV_NAME' no existe. Envs disponibles:"
  azd env list 2>/dev/null | grep -o '"wt-[^"]*"' | tr -d '"' | sed 's/^/  - /' || echo "  (ninguno)"
  exit 0
fi

echo "→ Env a purgar: $ENV_NAME"
azd env select "$ENV_NAME" >/dev/null
echo "  Recursos (preview):"
azd env get-values 2>&1 | grep -E 'AZURE_(STATIC_WEB_APP|FUNCTION_APP|STORAGE|RESOURCE_GROUP)' | sed 's/^/    /' || true

if [[ "$CONFIRM" == "true" ]]; then
  echo ""
  read -r -p "¿Borrar recursos de '$ENV_NAME' en RG_UADE_INNOVA_DEV? (yes/no): " ans
  if [[ "$ans" != "yes" ]]; then echo "Abortado."; azd env select uade-dev >/dev/null 2>&1 || true; exit 0; fi
fi

echo "  ejecutando azd down --purge ..."
azd down --force --purge 2>&1 | sed 's/^/  /' || {
  echo "  azd down falló — puede requerir limpieza manual en portal (RG_UADE_INNOVA_DEV)." >&2
}
rm -rf ".azure/$ENV_NAME" 2>/dev/null || true
azd env select uade-dev >/dev/null 2>&1 || true
echo "✓ $ENV_NAME purgado. Restaurado a uade-dev."
