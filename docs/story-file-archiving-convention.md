# Convención: Archivar Story Files Reescriptos por QA

**Origen:** Action item `epic-1-retro-item-2-proceso-archivar-story-files-originales` (retrospectiva Epic 1, 2026-08-17).

## Problema

Cuando una QA (o un agente de implementación) reescribe o renombra una user story —por ejemplo, el scope cambia, el AC se reformula o el key de sprint-status cambia— el **story file original** (`{key}-{slug}.md` en `_bmad-output/implementation-artifacts/`) puede quedar obsoleto: mantiene el título/ACs viejos, tareas internas sin marcar, y ya no coincide con el key vivo de `sprint-status.yaml` ni con el issue de GitHub.

## Regla

**Todo story file que ya no corresponde a una historia viva debe moverse a `_bmad-output/implementation-artifacts/archived/`** (con su nombre original, sin borrarlo).

- La **fuente de verdad** son los GitHub Issues (`lucas-vidmar/uade-innova`) y `sprint-status.yaml` — nunca el story file local.
- Un story file archivado no se re-utiliza como spec ni como plan; es solo registro histórico.
- Los specs activos (`spec-*.md`) y los story files que representan el estado **actual** permanecen en la raíz de `implementation-artifacts/`.

## Procedimiento

1. Identificar el story file cuyo key no coincide con `sprint-status.yaml` ni con un issue abierto/cerrado vigente.
2. Moverlo a `archived/`:
   ```bash
   mkdir -p _bmad-output/implementation-artifacts/archived
   mv _bmad-output/implementation-artifacts/{key}-{slug}.md \
      _bmad-output/implementation-artifacts/archived/{key}-{slug}.md
   ```
3. Actualizar las referencias a la ruta original en retrospectivas, specs y otros `.md` del repo (buscar con `grep -rn "{old-name}"`).
4. Si el key de sprint-status cambió, registrar la reconciliación como action item `resolved` en `sprint-status.yaml` (no dejar el archivo como si fuera la historia viva).

## Ejemplo aplicado

- **Story 1.1b:** el archivo `1-1b-enrollment-validation.md` quedó obsoleto cuando la historia viva pasó a ser `scope-resolution-from-allowlist` (issue #260). Se archivó en `archived/1-1b-enrollment-validation.md` y se actualizaron las referencias en `1-2-role-based-dashboard-routing.md` y `epic-1-retro-2026-08-17.md`.

## Owner

Equipo de proceso / implementación. Se aplica al detectar la divergencia durante retrospectivas o code reviews.
