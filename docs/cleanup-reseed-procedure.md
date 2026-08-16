# Cleanup / Reseed Procedure — Runbook

**Story:** 10.23 — Isolate Stale/Test Pilot Data (QA-014)
**Script:** `backend/scripts/cleanup-test-data.js`
**Modelo:** copia del runbook `docs/reindex-vector-classid-migration.md` (dry-run → live → verify → rollback).
**Inventario de artefactos:** `docs/stale-test-data-inventory.md`.

---

## Objetivo

Eliminar (o aislar) los artefactos de prueba del entorno del piloto:

- Deadline `Test deadlinr`.
- Chats duplicados `Que es un sistema?`.
- Marcadores de timeline en `0s`.
- Contenido DASI / Econometría II, `trigger check`, `retry old doc`.
- Materias de test (`dasi-1c2023`, `matematica-2026`, `ing-datos-2026`, `arq-soft-2026`).
- Perfiles `test-alu-*`.

Y re-sembrar **solo** las fixtures piloto (`seed-initial-data.js` + `backend/scripts/pilot-enrollments.csv`).

> ⚠️ La limpieza de vectores Pinecone se coordina con Story 10.17 (QA-002). Por
> defecto este script **NO** borra Pinecone; solo lo hace con `--with-pinecone`.

## Prerrequisitos

1. **Variables de entorno** (iguales a las de las Functions):
   - `AZURE_STORAGE_ACCOUNT_NAME` y `AZURE_STORAGE_ACCESS_KEY` (o `AZURE_STORAGE_CONNECTION_STRING`)
   - `PINECONE_HOST`, `PINECONE_INDEX_NAME`, `PINECONE_API_KEY` (solo con `--with-pinecone`)
2. **Node.js 20+**.
3. Leer `docs/stale-test-data-inventory.md` antes de ejecutar.

## Ejecución

### Paso 1: Dry-run (default — sin mutación)

```bash
node backend/scripts/cleanup-test-data.js
# equivalente:
node backend/scripts/cleanup-test-data.js --dry-run
```

Lista cada artefacto que se eliminaría, por categoría, **sin tocar el storage**.
Revisar el output y confirmar que las materias/usuarios listados son efectivamente de test.

> ⚠️ Si el storage es piloto/producción, este modo (y `--verify`) solo advierte;
> `--live`/`--reseed` se BLOQUEAN salvo `ALLOW_CLEANUP_PILOT=true`.

### Paso 2: Limpieza live

```bash
node backend/scripts/cleanup-test-data.js --live
# en CI, sin prompt interactivo:
node backend/scripts/cleanup-test-data.js --live --yes
```

Pide confirmación interactiva salvo `--yes`. Aplica las eliminaciones:

- Deadlines `Test deadlinr` (blobs `deadlines/*.json`).
- Conversaciones de test (tabla `Conversations` vía `deleteConversation`).
- Timelines en `0s` y blobs de timeline de materias test / con snippets (`class-timelines/*.json`).
- Materiales/clases de materias test (tablas `materials`/`classes`).
- Enrollments y perfiles `test-alu-*` (tablas `Enrollments`/`UserProfiles`).
- Blobs DASI/Econometría (`class-materials/`, `processed/`) y entradas de `subjects.json`.
- Vectores Pinecone de materias test **solo con** `--with-pinecone` (handoff Story 10.17).

### Paso 3: Reseed (solo fixtures piloto)

```bash
node backend/scripts/cleanup-test-data.js --reseed
# en CI, sin prompt interactivo:
node backend/scripts/cleanup-test-data.js --reseed --yes
```

1. Ejecuta la limpieza live.
2. Re-ejecuta `backend/scripts/seed-initial-data.js` (subjects/classes/materials piloto).
3. Re-ejecuta `backend/scripts/seed-enrollments.js` (`backend/scripts/pilot-enrollments.csv`).
4. Corre la verificación automática.

### Paso 4: Verificación

```bash
node backend/scripts/cleanup-test-data.js --verify
```

Devuelve **OK** solo si no quedan artefactos QA-014 en el storage (exit 0).
Si queda algo, imprime las categorías pendientes (exit 1). Con `--skip-pinecone`
(o el default sin `--with-pinecone`) reporta que la verificación de vectores
queda delegada a Story 10.17.

### Paso 5: Verificación visual (E2E)

- Entrar al dashboard del alumno piloto y confirmar: sin `Test deadlinr`, sin
  chats `Que es un sistema?`, sin marcadores `0s` en la timeline de la clase,
  y que el picker de materias solo muestre `arq-software-2026` / `diseno-sistemas-2026`.
- Correr un query RAG en `arq-software-2026` / `class-01` y validar que ninguna
  fuente sea DASI/Econometría.

## Rollback

La limpieza solo elimina datos de prueba; no muta `subjectId`/`classId` del piloto.
Si se necesita restaurar:

```bash
# Re-sembrar fixtures piloto (idempotente):
node backend/scripts/seed-initial-data.js
node backend/scripts/seed-enrollments.js

# Vectores Pinecone borrados por esta limpieza: re-indexarlos desde los
# materiales originales (ingest) o restaurar desde el backup de vectores
# (`scripts/restore-archive.js`). Coordinar con Story 10.17.
```

Los datos de test NO se respaldan (se eliminan intencionalmente); para regenerarlos
de test: `backend/scripts/seed-test-profiles.js` y `test-upload-rag.mjs` (solo dev).

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| `AZURE_STORAGE_ACCOUNT_NAME is not defined` | Faltan env vars de storage | Setear credenciales (ver `.env.local`) |
| `Configuracion incompleta: PINECONE_API_KEY` | Faltan env vars de Pinecone | Solo se necesitan con `--with-pinecone` |
| `--live`/`--reseed` se bloquean al detectar storage piloto | Guard anti-piloto (nombre `stdashboard` o `NODE_ENV=production`) | Usar un storage de desarrollo; o `ALLOW_CLEANUP_PILOT=true` SOLO si estás seguro |
| `--live` se cancela sin `--yes` | Confirmación interactiva en TTY | Ejecutar con `--yes` en CI o aceptar el prompt |
| `--reseed` falla en `seed-initial-data.js` | `NODE_ENV=production` o credenciales | Ejecutar con `NODE_ENV` no-producción y credenciales correctas |
| El verify sigue marcando artefactos | Datos nuevos reintroducidos o conteos distintos | Revisar `docs/stale-test-data-inventory.md` y el output del dry-run |
| Pinecone sigue devolviendo fuentes test | Vectores con metadata vieja (QA-002) | Correr Story 10.17 (reindex/cleanup de vectores) |
| `test-upload-rag.mjs` / `test-large-upload.js` no arrancan | Guard anti-host-piloto activo | Apuntar a un host de DESARROLLO (no setear `ALLOW_TEST_UPLOAD_TO_PILOT`) |
