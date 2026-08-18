# Guía: Estabilidad de Workers opencode en Waves Orca Paralelas

**Origen:** Action item `epic-11-retro-item-1-workers-estancados-opencode` (retrospectiva Epic 11, 2026-08-18).

## Síntoma

Durante la Wave 4 (11 workers en worktrees aislados vía `orca orchestration worker-start --agent opencode`), varios workers quedaron **estancados en el paso "Build auto · DeepSeek V4 Flash"**:

- Token-count del TUI **estático** (ej. `89.8K (9%)` inmutable durante horas).
- Proceso opencode con **CPU activa** (15-33%) y **conexión HTTPS ESTABLISHED** al endpoint del LLM.
- Sin archivos modificados ni salida nueva en el terminal por **1.5-3 horas**.
- El `worker_done` nunca llegaba → el coordinador tenía que re-despachar o completar manualmente.

## Causa raíz (observada)

1. **Generación LLM muy larga / streaming atascado:** el paso "Build" representa una llamada de razonamiento de opencode que puede colgarse en streaming sin avanzar el buffer del TUI (token-count estático ≠ proceso muerto; el proceso sigue con CPU/red).
2. **Prompt no inyectado:** en algunos workers (especialmente los re-prompted manualmente con `/tmp/*.txt`) el preamble de dispatch llegaba pero el **task prompt no se auto-inyectaba** en opencode → quedaban idle en "Ask anything" sin ejecutar.
3. **Sin heartbeat del dispatch:** los dispatches mostraban `last_heartbeat_at: None` — no había señal de vida detectable por el coordinador.

## Mitigaciones recomendadas para futuras waves

### 1. Timeout + monitoreo de progreso por worker
- No confiar en el token-count del TUI (engañoso). Monitorear en su lugar:
  - `lsof -p <pid>` para confirmar conexión activa al LLM.
  - Cambios en `git status` / `git log` del worktree (señal real de progreso).
  - `ps -o %cpu` para detectar proceso colgado.
- Definir un **timeout por worker** (ej. 90-120 min sin cambios de archivos = señal de estancamiento) y un **retry automático** en worktree fresco.

### 2. Garantizar inyección del task prompt
- Preferir `orca orchestration worker-start --agent opencode` (inyecta preamble + spec) sobre re-prompting manual con `terminal send`.
- Tras `worker-start`, verificar en los primeros 60s que el terminal muestra el spec del task (no "Ask anything"). Si está idle, re-inyectar el prompt explícitamente.

### 3. Heartbeat / señal de vida
- Pedir a los workers que envíen `heartbeat` periódico (preamble ya lo soporta) para que el coordinador distinga "trabajando lento" de "estancado".
- El coordinador debe usar `check --wait --types worker_done,escalation,question` con ventanas largas, pero correlacionar con actividad real del worktree.

### 4. Aislamiento de deploy
- **No** desplegar desde cada worker al mismo RG compartido (race: `RUN_FROM_PACKAGE` 409, overwrites en SWA).
- Desplegar **una sola vez** desde `main` ya mergeado al final de la wave.

## Owner

Equipo de implementación. Aplicar en la configuración de la próxima wave orquestada (tiempos, monitoreo, inyección de prompt).
