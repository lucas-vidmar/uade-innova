# Stale / Test Pilot Data Inventory — Story 10.23 (QA-014)

**Story:** 10.23 — Isolate Stale/Test Pilot Data
**Issue:** #269 (label `epic-10`)
**QA evidence:** `docs/qa-browser-report-2026-08-14.md` (QA-014; QA-002 para Pinecone/Class 1)
**Script:** `backend/scripts/cleanup-test-data.js`
**Status:** Inventory basado en QA + catálogo del script; los conteos en vivo se obtienen con `--dry-run`.

---

## 1. Contexto

Los artefactos de prueba **no están hardcodeados en el código fuente**: una
búsqueda por `Test deadlinr`, `Que es un sistema`, `trigger check` o
`retry old doc` solo encuentra el reporte QA y el harness `test-upload-rag.mjs`.
Viven en **estado desplegado**: Blob Storage JSON, Table Storage y vectores de
Pinecone. Este documento cataloga dónde aparecen y cómo se enumeran.

## 2. Inventario de artefactos

| # | Artefacto | Ubicación | Origen | Conteo de referencia |
|---|-----------|-----------|--------|----------------------|
| 1 | Deadline `Test deadlinr` | Blob `deadlines/{subjectId}.json` (ej: `arq-software-2026.json`) | Manual testing vía `POST /api/deadlines` | 1+ (QA-014) |
| 2 | Chats recientes duplicados `Que es un sistema?` | Table Storage `Conversations` (campo `firstQuestion`) | Consultas manuales/automáticas de test | Varios (QA-014) |
| 3 | Marcadores de timeline clavados en `0s` | Blob `class-timelines/{classId}.json` (campo `markers[].startSecond = 0`) | Materiales de transcript de prueba procesados | Varios (QA-014) |
| 4 | Contenido DASI / Econometría II (`trigger check`, `retry old doc`) | Blob `class-materials/`, `processed/`, `class-timelines/`; Tablas `materials`/`classes` | `test-upload-rag.mjs` (uploads DASI) + E2E tests | Sí (QA-002/Qa-014, Class 1) |
| 5 | Materias de test: `dasi-1c2023`, `matematica-2026`, `ing-datos-2026`, `arq-soft-2026` | `classes-config/subjects.json`, Tablas `Enrollments`/`classes`/`materials`, vectores Pinecone (metadato `subjectId`) | `test-upload-rag.mjs`, `seed-test-profiles.js` | 4 materias |
| 6 | Perfiles de test `test-alu-001..005` | Tabla `UserProfiles` + `Enrollments` | `backend/scripts/seed-test-profiles.js` | 5 perfiles |
| 7 | `scripts/test-large-upload.js` (20 MB en `arq-software-2026`) | Intrusión potencial en materia piloto | Script manual | — (corregido a `dasi-1c2023`) |
| 8 | `scripts/test-students-enrollments.csv` (IDs `arq-soft-2026`/`ing-datos-2026`) | Referenciado en la spec | CSV legado | **Ya no existe en el repo** (riesgo eliminado) |

### 2.1. Notas por almacén

**Blob Storage**
- `deadlines/{subjectId}.json` — leído por `backend/src/functions/deadlines.js:80`, escrito en `:126-137`.
- `class-timelines/{classId}.json` — producido por `backend/src/services/pipeline.js:254-291`; renderiza `0s` en `frontend/src/pages/student/ClassDetail.js:216-235`. **Claveado solo por `classId`:** si un subject test comparte `classId` con una clase piloto (ej: `class-01` en `dasi-1c2023` y `arq-software-2026`), la limpieza NO borra el blob entero — hace strip parcial de los markers ofensivos para no eliminar el timeline de la clase piloto.
- `class-materials/`, `processed/` — archivos crudos y estado procesado del pipeline (nombres DASI: `DASI Cronograma dia Jueves_1C2023_ejemplo.docx`, `TRABAJO PRÁCTICO FINAL DASI2023.docx`). Path del pipeline: `{subjectId}/{materialId}{ext}`; blobs legacy: `{classId}/{filename}`. La limpieza de `class-materials` exige **contexto de subject test** (subjectId/classId test o filename de un material test) — un blob piloto cuyo nombre mencione "dasi" no se borra.

**Table Storage**
- `Conversations` — `backend/src/services/state-store.js:590-719`; duplicados visibles en `frontend/src/components/SavedConversationsModal.js:49-64`.
- `Enrollments`, `UserProfiles` — perfiles `test-alu-*` y materias test.
- `materials`, `classes` — filas con `subjectId` test.

**Pinecone**
- Vectores con `subjectId` en materias test. **La limpieza/reindexado se coordina con Story 10.17 (QA-002)**; por defecto `cleanup-test-data.js` **NO** borra Pinecone — solo con `--with-pinecone` se ofrece el borrado por filtro `subjectId ∈ {test}` como handoff explícito.

## 3. Cómo producir el inventario en vivo

```bash
# Enumeración completa sin mutar nada (dry-run por defecto):
node backend/scripts/cleanup-test-data.js

# Solo verificación de que no queden artefactos QA-014:
node backend/scripts/cleanup-test-data.js --verify
```

El script recorre: deadlines por blob, `Conversations` (tabla completa),
timelines por blob, tablas `materials`/`classes`/`Enrollments`/`UserProfiles`,
blobs `class-materials` (con guard de contexto de subject test) y `processed`
(inspección de contenido) y `classes-config/subjects.json`. El output reporta
conteos por categoría.

## 4. Fixtures y su etiqueta de entorno (`env`)

| Fixture | env | Estado |
|---|---|---|
| `backend/scripts/seed-initial-data.js` — `arq-software-2026`, `diseno-sistemas-2026` (subjects/classes/materials) | `pilot` | Etiquetado (aditivo) |
| `backend/scripts/seed-initial-data.js` — `eco-internacional-2026` (no en pilot-enrollments.csv) | `dev` | Etiquetado (aditivo) |
| `backend/scripts/pilot-enrollments.csv` | `pilot` | Documentado en header + columna `env` |
| `backend/scripts/seed-test-profiles.js` (`test-alu-*`) | `test` | Etiquetado + guard contra storage piloto |
| `test-upload-rag.mjs` (DASI) | `test` | Guard contra host piloto del Function App |
| `scripts/test-large-upload.js` | `test` | Subject cambiado a `dasi-1c2023` + guard |
| `scripts/test-students-enrollments.csv` | — | Removido del repo (no presente) |

> **Regla (AC #2):** una fixture `test`/`dev` nunca se promueve al scope piloto
> sin un paso explícito y revisado. El gate de enforcement es el filtro por
> `subjectId` + `classId` en `backend/src/functions/rag-query.js:123-144` y
> `frontend/src/components/ChatWidget.js:377-388`; con el storage limpio esos
> filtros son suficientes.

## 5. Referencias

- Reporte QA: `docs/qa-browser-report-2026-08-14.md:253-264` (QA-014), `:101-106` (QA-002), `:259-262`.
- Harness de carga (fuente de datos DASI): `test-upload-rag.mjs`.
- Seed de perfiles test: `backend/scripts/seed-test-profiles.js`.
- Runbook de limpieza: `docs/cleanup-reseed-procedure.md`.
