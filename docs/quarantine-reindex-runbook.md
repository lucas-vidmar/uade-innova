# Quarantine & Reindex de Vectores RAG Mal Etiquetados — Runbook

**Story:** 10.17  
**Issue:** #263 (QA-002 — cross-course disclosure, P0)  
**Script:** `backend/scripts/quarantine-reindex-vectors.js`

---

## Propósito

Auditar el índice Pinecone buscando vectores cuyo `subjectId`/`classIds` entra en
conflicto con su `Material` autoritativo (Table Storage), marcarlos en cuarentena
(`quarantined: true`) y reindexar los registros corregidos con metadata correcta.
En query-time, todo filtro RAG/global-search excluye vectores cuarentenados con
`{ quarantined: { $ne: true } }` + un post-filter en proceso (defense-in-depth).

## Prerrequisitos

1. Variables de entorno (mismas que Functions):
   - `PINECONE_HOST`, `PINECONE_INDEX_NAME`, `PINECONE_API_KEY`
   - `PINECONE_NAMESPACE` (opcional — el script respeta namespace)
   - `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCESS_KEY` (Table Storage + Blob)
   - Para reindex **live**: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` (embeddings)
2. Tabla Table Storage `materials` con los registros autoritativos (`partitionKey = subjectId`, `rowKey = materialId`, `classIds`).
3. Blobs `processed/{materialId}.json` con `extractedText`/`chunks` (source of truth del reindex).
4. Node.js 20+.

---

## Paso 1: Dry-run primero (siempre)

```bash
node backend/scripts/quarantine-reindex-vectors.js --dry-run
```

Preview 100% offline: **sin writes** (ni upserts, ni backups, ni checkpoint, ni
telemetría) y **sin lecturas extra a Pinecone** (el reindex dry-run no hace el
refetch de `values` ni consume quota de embeddings). El exit code refleja el
resultado simulado: `0` si el audit estaría completo, `1` si habría vectores
`failed`.

**Importante (comportamiento observado):** si el dry-run se vuelve a correr luego
de un run live, los vectores ya cuarentenados se siguen reportando como
`Quarantined: > 0` (permanecen flaggeados; el audit no los des-cuarentena).

### Salida esperada (ejemplo aritmético consistente)

```
=== Quarantine Summary ===
Mode:               DRY RUN
Scanned:            4520
Clean:              2100
Quarantined:        2410
Unresolvable:       0
Failed:             10
Success:            false
Duration:           3.45s
========================
```

> `Scanned = Clean + Quarantined + Unresolvable + Failed` (4520 = 2100 + 2410 + 0 + 10).
> Los conteos `Clean`/`Quarantined`/`Unresolvable`/`Failed` son mutuamente
> excluyentes; cada vector escaneado cae exactamente en uno.

---

## Paso 2: Backup (automático) y reporte de auditoría

El run live escribe, en el container `vector-quarantine/`:

| Blob | Contenido |
|---|---|
| `{runId}.json` | **Backup pre-cuarentena** — todos los vectores que se van a re-upsertear, con `values` completos (re-fetcheados, incluidos los restaurados por checkpoint). Base del rollback. |
| `{runId}-report.json` | **Reporte de auditoría** — un entry por vector cuarentenado (`id`, `materialId`, viejo `subjectId`/`classIds`, `expectedSubjectId`/`expectedClassIds`, `quarantineReason`) + `counts` + `quarantineReasons`. **Se escribe SIEMPRE** (incluso con 0 cuarentenados). |
| `{runId}-reindex-backup.json` | Backup pre-delete del modo reindex (misma forma, `values` incluidos). |
| `{runId}-quarantined-material-ids.json` | Lista machine-readable de `materialId`s cuarentenados (input de bulk reindex). |

---

## Paso 3: Run live de cuarentena

```bash
node backend/scripts/quarantine-reindex-vectors.js
```

- Cada vector conflictivo se re-upsertea con `quarantined: true` +
  `quarantineReason` + `quarantinedAt` + `conflictSubjectId`/`conflictClassId` +
  `expectedSubjectId`/`expectedClassIds`.
- Cada vector limpio se **normaliza** con `quarantined: false` (campo
  always-present: después del primer run live, `{ quarantined: { $ne: true } }`
  solo excluye lo cuarentenado).
- Vectores `materialType: 'verified-answer'` están **exentos de cuarentena** (no
  tienen fila en `materials` por diseño) pero **igual se normalizan** con
  `quarantined: false`.
- Un **error de lookup** de Table Storage se cuenta `failed` (retryable con
  `--resume`), **nunca** se cuarentena. Solo una ausencia determinística de
  registro produce `no-authoritative-material` → `Unresolvable`.
- Exit codes: `0` éxito completo · `1` incompleto (`failed > 0`) · `2` aborto
  antes de mutar el índice (listado truncado, `--reindex-material` malformado).

### Reanudar un run incompleto

```bash
node backend/scripts/quarantine-reindex-vectors.js --resume
```

El checkpoint (default `reindex-quarantine-checkpoint.json`, **distinto** del de
la migración classId) se preserva cuando hay `failed > 0`. En el resume, los
candidatos restaurados se **re-clasifican** contra el registro autoritativo
actual y los vectores fallidos se reintentan **una vez**; si siguen fallando se
vuelven a persistir. El checkpoint lleva un marker `kind: 'quarantine'`: si se
intenta `--resume` con un checkpoint de la migración classId (sin ese marker), el
run aborta con exit 2 antes de escanear.

---

## Paso 4: Validación live del filtro (Loopback 1 — obligatorio)

Antes de confiar en el filtro de exclusión, ejecutar una query real contra el
índice y confirmar que los vectores NO cuarentenados siguen respondiendo
(Pinecone no define formalmente la semántica de `$ne` con campos ausentes; el
campo always-present la hace determinística **solo después del primer run live**):

```bash
# Query scoped a arq-software-2026 / class-01
curl -s -X POST "$FUNC/api/rag-query" \
  -H 'Content-Type: application/json' \
  -d '{"question":"¿Qué es la arquitectura hexagonal?","subjectId":"arq-software-2026","classIds":["class-01"]}'
```

Debe devolver fuentes de `arq-software-2026`/`class-01` (ninguna de DASI/Tidio/
Econometría II — el leak QA-002). Luego correr la canary de Story 3.7 y exigir
cero source-metadata mismatches.

---

## Paso 5: Reindex de materiales corregidos

Corregir primero la metadata autoritativa (Table Storage `materials`/`classes`),
luego:

```bash
# Preview (sin consumo de embeddings)
node backend/scripts/quarantine-reindex-vectors.js --reindex-material arq-software-2026:mat-123 --dry-run

# Live: borra los vectores del material y los re-embebe desde processed/{materialId}.json
node backend/scripts/quarantine-reindex-vectors.js --reindex-material arq-software-2026:mat-123
```

Comportamiento de seguridad del modo reindex:
- **Aborta (exit 2) antes de cualquier delete** si: el CLI `subjectId` no
  coincide con el registro autoritativo, el re-chunk da 0 chunks, la captura
  paginada devuelve `missingIds` o golpea el tope de páginas, o algún vector
  existente no puede re-fetchear `values` (el backup estaría incompleto).
- **Embeddings antes de borrar**: el delete+upsert solo ocurre si los embeddings
  ya se generaron.
- El reindex escribe `quarantined: false` en cada chunk (campo always-present).
- `--reindex-material` combinado con `--resume` solo advierte (resume no aplica
  en modo reindex).
- La verificación post-reindex reintenta el fetch (eventual consistency),
  compara el `chunkCount` nuevo + `classIds` (como conjunto, order-insensitive) +
  `materialType`, y **confirma que no queden chunks huérfanos** (conteo por
  prefijo `${materialId}-chunk-` == nuevo chunkCount, para materiales acortados).
  Si falla, el runner imprime la ruta del backup de restauración.
- Si `generateEmbeddingsBatch` devuelve menos embeddings que chunks, aborta
  (exit 2, `EMBEDDING_COUNT_MISMATCH`) antes de borrar.

---

## Paso 6: Verificación post-run

```bash
node backend/scripts/quarantine-reindex-vectors.js --dry-run
```

Re-correr el dry-run es la verificación principal: los vectores ya cuarentenados
se reportan `Quarantined: > 0` (permanecen flaggeados) y los limpios
`Clean`. También verificar en el reporte:

```javascript
const { loadJson } = await import('./backend/src/services/storage.js');
const report = await loadJson('vector-quarantine', '<runId>-report.json');
console.log(report.counts); // scanned/clean/quarantined/unresolvable/failed reconciliados
```

---

## Rollback

### 1) Des-cuarentenar vectores (restaurar desde el backup)

Re-upsertear los vectores del backup con `quarantined` **eliminado** (no `false`):

```javascript
// ESM (backend es type: module). Re-upsertea los vectores del backup de
// vector-quarantine/{runId}.json sin el campo `quarantined`, restaurando el
// estado pre-cuarentena (values + metadata originales).
import { loadJson } from './backend/src/services/storage.js';
import { upsertChunks } from './backend/src/services/vector-store.js';

const backup = await loadJson('vector-quarantine', '<runId>.json');
const restored = (backup.vectors || []).map((v) => {
  const metadata = { ...v.metadata };
  delete metadata.quarantined;            // el campo se elimina, no se setea en false
  return { id: v.id, values: v.values, metadata };
});
await upsertChunks(restored);
```

### 2) Reindex fallido (delete ya ejecutado)

El run de reindex escribe `vector-quarantine/{runId}-reindex-backup.json` antes
de borrar. Para restaurar: re-upsertear esos vectores (mismo snippet, usando ese
blob). Re-correr el reindex es idempotente-safe (re-embebe desde el blob
procesado).

---

## Safety Notes

1. **Siempre dry-run primero.** El backup y el reporte se escriben solo en live.
2. **Ventana de bajo tráfico.** El run live re-upsertea potencialmente todo el
   índice (normalización).
3. **Namespace:** el script respeta `PINECONE_NAMESPACE`. Asegurarse de que esté
   configurado si el índice usa namespaces.
4. **Lookups fault-tolerant:** un error de lookup se cuenta `failed` (nunca se
   cuarentena) y es retryable con `--resume`.
5. **Listing truncado aborta (exit 2):** si `listAllVectorIds` no cubre el total
   del índice, el run no arranca (no auditar un índice parcial).
6. **Exit codes para CI:** `0` ok · `1` incompleto (usar `--resume`) · `2` aborto
   (revisar el error; no se mutó nada o el backup quedó intacto).

---

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| `--reindex-material` sin colon | Argumento malformado | Usar `<subjectId>:<materialId>`. Aborta exit 2 sin escanear. |
| `ABORT: listado truncado` | `getIndexStats` > IDs listados | Con `PINECONE_NAMESPACE` la guardia compara contra el conteo del namespace escaneado (no el total del índice). Si el namespace no expone conteo, se omite la guardia. Sin namespace, correr el reindex por material o particionar el scan. |
| `CHECKPOINT_KIND_MISMATCH` | `--resume` apuntando al checkpoint de la migración classId | Usar el checkpoint del runner (`reindex-quarantine-checkpoint.json` o el pasado con `--checkpoint`); aborta exit 2 sin escanear. |
| `Scanned != Clean + Quarantined + Unresolvable + Failed` | MissingIds/skips en un run incompleto | Es un run `failed > 0`; reanudar con `--resume`. En un run exitoso la aritmética siempre cuadra. |
| Verified answers dejan de matchear el fast path | Campo `quarantined` ausente en vectores legacy | Correr el run live de cuarentena: la **normalización** restaura su `quarantined: false` (son exentos del flag pero se normalizan). |
| Reindex verificación falla | Eventual consistency o backup incompleto | Reintentar; si persiste, restaurar desde `{runId}-reindex-backup.json`. |
| `SUBJECT_MISMATCH` | El CLI `subjectId` no coincide con el registro autoritativo | Corregir el argumento; no se borra nada. |
| `ZERO_CHUNKS` / `REINDEX_BACKUP_INCOMPLETE` | Texto vacío o values no re-fetcheables | Revisar el blob `processed/{materialId}.json`; el delete **nunca** supera al backup. |
