#!/usr/bin/env bash
# =============================================================================
# new-worktree-env.sh — crea un azd env aislado por worktree/branch
#
# Resuelve el problema de colisión descrito en AGENTS.md §1:
# azure.yaml:12 fija RG_UADE_INNOVA_DEV y .azure/config.json:1 fija
# AZURE_ENV_NAME=uade-dev → todos los worktrees compiten por el mismo
# Function App / SWA / Storage (resourceToken = uniqueString(subId, env, loc)).
#
# Este script crea un env efímero wt-<slug> con resourceToken distinto,
# provisiona recursos dedicados en el MISMO RG (sin permisos de subscripton)
# y expone AZURE_STATIC_WEB_APP_URI / AZURE_FUNCTION_APP_URI aislados.
#
# Uso:
#   ./scripts/new-worktree-env.sh              # auto: slug del branch actual
#   ./scripts/new-worktree-env.sh my-feature   # slug explícito
#   ./scripts/new-worktree-env.sh --provision  # crea + azd provision (default)
#   ./scripts/new-worktree-env.sh --no-provision  # solo crea env, no provisiona
#
# Limpieza: ./scripts/cleanup-worktree-env.sh [slug]
# Requiere: azd >= 1.9, az login, permisos en RG_UADE_INNOVA_DEV
# Costo: plan Y1 Consumption + SWA Free → escala a 0, ~$0 si se limpia.
# =============================================================================
set -euo pipefail

PROVISION=true
EXPLICIT_SLUG=""

for arg in "$@"; do
  case "$arg" in
    --provision) PROVISION=true ;;
    --no-provision) PROVISION=false ;;
    --help|-h)
      echo "Usage: $0 [slug] [--provision|--no-provision]"
      exit 0
      ;;
    *)
      if [[ -z "$EXPLICIT_SLUG" ]]; then EXPLICIT_SLUG="$arg"; fi
      ;;
  esac
done

slugify() {
  # lower, alnum+-, trunc 20 chars
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's|[^a-z0-9]+|-|g; s|^-||; s|-$||' | cut -c1-20 | sed 's|-$||'
}

if [[ -n "$EXPLICIT_SLUG" ]]; then
  SLUG="$(slugify "$EXPLICIT_SLUG")"
else
  BRANCH="$(git branch --show-current 2>/dev/null || echo "")"
  if [[ -z "$BRANCH" ]]; then BRANCH="$(basename "$(pwd)")"; fi
  # worktree path fallback: wt-<name>
  if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
    echo "ERROR: estás en '$BRANCH'. Pasá un slug explícito: $0 my-feature" >&2
    exit 1
  fi
  SLUG="$(slugify "$BRANCH")"
  if [[ -z "$SLUG" ]]; then SLUG="wt-$$"; fi
fi

ENV_NAME="wt-${SLUG}"
# azd env name: lowercase alnum+-
ENV_NAME="$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]//g')"

echo "→ Env efímero: $ENV_NAME (slug: $SLUG)"

# --- azd env create (idempotente) ---
if azd env list 2>/dev/null | grep -q "\"$ENV_NAME\""; then
  echo "  env '$ENV_NAME' ya existe — reutilizando."
else
  echo "  creando azd env '$ENV_NAME'..."
  azd env new "$ENV_NAME" --no-prompt 2>&1 | sed 's/^/  /' || {
    echo "ERROR: azd env new falló. Verificá 'az login' y permisos en la subscripción." >&2
    exit 1
  }
fi

azd env select "$ENV_NAME" >/dev/null

# --- heredar valores base de uade-dev ---
# Copiamos secretos/variables no sensibles que definen el provision (location, etc.)
# sin pisar el env nuevo. Los outputs (uris) se regeneran en provision.
if [[ -f ".azure/uade-dev/.env" ]]; then
  echo "  heredando config base desde uade-dev..."
  # location / subscription / rg permanecen iguales; env name ya es distinto
  BASE_LOC="$(grep -E '^AZURE_LOCATION=' .azure/uade-dev/.env 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")"
  BASE_SUB="$(grep -E '^AZURE_SUBSCRIPTION_ID=' .azure/uade-dev/.env 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")"
  if [[ -n "$BASE_LOC" ]]; then azd env set AZURE_LOCATION "$BASE_LOC" >/dev/null; fi
  if [[ -n "$BASE_SUB" ]]; then azd env set AZURE_SUBSCRIPTION_ID "$BASE_SUB" >/dev/null; fi
  # notificationEmail, pinecone, etc. se pasan como azd env vars → main.parameters.json
  for key in notificationEmail pineconeApiKey pineconeHost PINECONE_HOST PINECONE_API_KEY graphApiClientId graphApiClientSecret graphApiTenantId; do
    val="$(grep -E "^${key}=" .azure/uade-dev/.env 2>/dev/null | cut -d= -f2- | sed 's/^"//; s/"$//' || true)"
    if [[ -n "$val" && "$val" != '""' ]]; then
      azd env set "$key" "$val" >/dev/null 2>&1 || true
    fi
  done
fi

echo "  env activo: $(azd env list 2>/dev/null | grep -E '"isDefault":\s*true' -B1 | head -1 || echo "$ENV_NAME")"
azd env get-values 2>&1 | sed 's/^/  /' | head -30

if [[ "$PROVISION" == "true" ]]; then
  echo ""
  echo "→ Provisionando recursos aislados en RG_UADE_INNOVA_DEV (token único por env)..."
  echo "  Esto tarda 5-10 min. Podés cancelar y luego 'azd provision' manual."
  azd provision --no-prompt
  echo ""
  echo "✓ Provision completo. URLs del env efímero:"
  azd env get-values | grep -E 'AZURE_(STATIC_WEB_APP|FUNCTION_APP)_URI|AZURE_RESOURCE_GROUP' || true
  echo ""
  echo "  Verificar con Orca:"
  SWA_URI="$(azd env get-value AZURE_STATIC_WEB_APP_URI 2>/dev/null || echo "")"
  if [[ -n "$SWA_URI" ]]; then
    echo "    orca goto --url $SWA_URI --json"
    echo "    orca snapshot --json"
  fi
  echo "  Limpiar al terminar: ./scripts/cleanup-worktree-env.sh $SLUG"
else
  echo ""
  echo "✓ Env '$ENV_NAME' listo (sin provisionar)."
  echo "  Para provisionar: azd provision"
  echo "  Para deployar:    azd deploy"
fi

echo ""
echo "  Volver a uade-dev: azd env select uade-dev"
