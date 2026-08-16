# Guía de Desarrollo

## Prerrequisitos

| Herramienta | Versión | Propósito |
|---|---|---|
| Node.js | >= 20.0.0 | Runtime |
| Azure Functions Core Tools | 4.x | Functions local |
| Azure Developer CLI (azd) | Latest | Infra + deploy |
| Azurite | Latest | Storage emulator local |
| Playwright | Latest | E2E tests |

## Configuración del Entorno

```bash
# 1. Clonar repositorio
git clone <repo>
cd azure-educational-dashboard

# 2. Frontend
cd frontend && npm install

# 3. Backend
cd ../backend && npm install

# 4. Variables de entorno (backend)
# Generar desde Key Vault (story 10.13 — nunca commitear keys):
./scripts/bootstrap-local-secrets.sh --vault <kv-edu-*>
# o, si ya existe backend/local.settings.json, copiarlo desde el template:
cp local.settings.json.template local.settings.json
# Editar con valores locales o de azd

# 5. Variables de entorno (frontend)
echo "VITE_API_BASE_URL=http://localhost:7071/api" > .env
```

## Comandos de Desarrollo

### Frontend
```bash
npm run dev          # Vite dev server (hot reload)
npm run build        # Build producción
npm run preview      # Preview build
npm run test:e2e     # Playwright E2E tests
```

### Backend
```bash
npm start            # func start (Functions local)
npm run azurite      # Storage emulator
npm test             # Unit tests (Node test runner)
```

### Infraestructura
```bash
azd provision        # Provisionar infraestructura Azure
azd deploy           # Desplegar frontend + backend
azd down             # Destruir entorno
```

## Flujo de Trabajo Típico

1. **Local**: `azurite` + `func start` + `npm run dev`
2. **Test**: `npm test` (backend) + `npm run test:e2e` (frontend)
3. **Staging**: Push a `staging` → CI/CD despliega + auto PR
4. **Producción**: Merge PR `staging → main` → CI/CD despliega

## Estructura de Commits

- Commits en español o inglés
- Prefijos sugeridos: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`

## Testing

### Backend
- Node.js built-in test runner (`--experimental-test-module-mocks`)
- Tests en `*.test.js` junto a los módulos
- Mock de servicios externos con `MockFunction`

### Frontend
- Playwright para E2E
- Tests en `*.spec.js`
- Chromium headless

## Convenciones de Código

- ES Modules (`type: "module"`)
- camelCase para funciones y variables
- kebab-case para nombres de archivos
- Context logging con `structured-logger.js`
- Errores categorizados con `error-categories.js`
