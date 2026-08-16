#!/usr/bin/env bash
# scripts/bootstrap-local-secrets.sh
# Bootstrap local development secrets from Azure Key Vault (story 10.13, AC #7).
#
# Reads secret values via `az keyvault secret show` and writes them into:
#   backend/local.settings.json  (Azure Functions local config)
#   .env.local                   (root-level local env, gitignored)
#
# No secret value is ever committed: both files are gitignored
# (root .gitignore lines 2-5, 18; backend/.gitignore line 3).
#
# Usage:
#   ./scripts/bootstrap-local-secrets.sh [--vault <kv-edu-*>]
#
# Defaults:
#   VAULT = $AZURE_KEY_VAULT_NAME (azd env) or first positional arg
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="${AZURE_KEY_VAULT_NAME:-${1:-}}"
FUNCS_OUTPUT="${ROOT}/backend/local.settings.json"
ENV_OUTPUT="${ROOT}/.env.local"

if [[ -z "${VAULT}" ]]; then
  echo "ERROR: vault no especificado. Usá el nombre del Key Vault o setea AZURE_KEY_VAULT_NAME." >&2
  exit 1
fi

fetch_secret() {
  az keyvault secret show --vault-name "${VAULT}" --name "$1" --query value -o tsv 2>/dev/null || echo ""
}

echo "🔐 Bootstrap de secretos locales desde Key Vault '${VAULT}' ..."

AZURE_STORAGE_ACCESS_KEY="$(fetch_secret AZURE-STORAGE-ACCESS-KEY)"
AZURE_OPENAI_API_KEY="$(fetch_secret AZURE-OPENAI-API-KEY)"
AI_FOUNDRY_DEEPSEEK_KEY="$(fetch_secret AI-FOUNDRY-DEEPSEEK-KEY)"
PINECONE_API_KEY="$(fetch_secret PINECONE-API-KEY)"
PINECONE_HOST="$(fetch_secret PINECONE-HOST)"

# backend/local.settings.json — solo si no existe (nunca sobrescribe trabajo local)
if [[ -f "${FUNCS_OUTPUT}" ]]; then
  echo "ℹ️  ${FUNCS_OUTPUT} ya existe — se conserva. Borralo y re-ejecutá para regenerarlo."
else
  sed \
    -e "s|<az keyvault secret show --vault-name kv-edu-\* --name AZURE-STORAGE-ACCESS-KEY --query value -o tsv>|${AZURE_STORAGE_ACCESS_KEY}|" \
    -e "s|<az keyvault secret show --vault-name kv-edu-\* --name AZURE-OPENAI-API-KEY --query value -o tsv>|${AZURE_OPENAI_API_KEY}|" \
    -e "s|<az keyvault secret show --vault-name kv-edu-\* --name AI-FOUNDRY-DEEPSEEK-KEY --query value -o tsv>|${AI_FOUNDRY_DEEPSEEK_KEY}|" \
    -e "s|<az keyvault secret show --vault-name kv-edu-\* --name PINECONE-API-KEY --query value -o tsv>|${PINECONE_API_KEY}|" \
    "${ROOT}/backend/local.settings.json.template" > "${FUNCS_OUTPUT}"
  echo "✅ ${FUNCS_OUTPUT} generado."
fi

# .env.local — se regenera (local root config, gitignored)
cat > "${ENV_OUTPUT}" <<EOF
# Generado por scripts/bootstrap-local-secrets.sh — NO commitear
PINECONE_HOST=${PINECONE_HOST}
PINECONE_INDEX_NAME=dashboard-edu-pilot
PINECONE_API_KEY=${PINECONE_API_KEY}
AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT:-}
AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY}
AI_FOUNDRY_DEEPSEEK_ENDPOINT=${AI_FOUNDRY_DEEPSEEK_ENDPOINT:-}
AI_FOUNDRY_DEEPSEEK_MODEL=deepseek-v4-flash
AI_FOUNDRY_DEEPSEEK_KEY=${AI_FOUNDRY_DEEPSEEK_KEY}
AZURE_STORAGE_ACCOUNT_NAME=${AZURE_STORAGE_ACCOUNT_NAME:-stdashboard}
AUTH_MOCK_ENABLED=true
EOF
echo "✅ ${ENV_OUTPUT} generado."

echo
echo "Siguiente paso — correr localmente:"
echo "  cd backend && npm run azurite && npm start"
echo
echo "NOTA: AUTH_MOCK_ENABLED=true permite el fallback mock de auth local (continuidad del piloto)."