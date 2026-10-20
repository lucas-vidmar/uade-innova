/* ============================================================
   Teacher Analytics — Query insights & friction topics
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { apiErrorFeedback } from '../../services/error-feedback.js';

export async function renderTeacherAnalytics(container) {
  renderHeader('Analítica Pedagógica');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando analítica...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function teacherStatusLabel(status) {
    if (status === 'green') return 'Saludable';
    if (status === 'yellow') return 'En observación';
    if (status === 'red') return 'Crítico';
    return 'Desconocido';
  }

  function teacherSafetyColor(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return 'var(--color-text-muted)';
    if (value >= 99) return '#10b981';
    if (value >= 95) return '#f59e0b';
    return '#ef4444';
  }

  function gapSeverityLabel(severity) {
    if (severity === 'red') return 'Crítico';
    if (severity === 'yellow') return 'Moderado';
    return 'Leve';
  }

  function gapSeverityColor(severity) {
    if (severity === 'red') return '#ef4444';
    if (severity === 'yellow') return '#f59e0b';
    return '#10b981';
  }

  function tokenize(text = '') {
    return String(text)
      .toLowerCase()
      .split(/[^a-z0-9áéíóúñü]+/i)
      .filter((w) => w.length > 2);
  }

  // Origen declarado de cada pregunta (#420, UJ-42). Lo calcula el backend a
  // partir de la interacción (sin material / valoración baja / reporte abierto);
  // acá sólo se muestra, sin inferir nada.
  const ORIGEN_LABEL = {
    consultaSinMaterial: 'Sin material',
    valoracionBaja: 'Valoración baja',
    reporteAbierto: 'Reporte abierto',
    sinSenal: 'Sin señal',
  };

  const ORIGEN_CLASS = {
    consultaSinMaterial: 'badge-warning',
    valoracionBaja: 'badge-error',
    reporteAbierto: 'badge-info',
    sinSenal: 'badge-info',
  };

  function originChips(origenes) {
    const list = Array.isArray(origenes) && origenes.length > 0 ? origenes : ['sinSenal'];
    return list
      .map((origen) => `<span class="badge ${ORIGEN_CLASS[origen] || 'badge-info'} origin-chip" data-origen="${escapeHtml(origen)}">${escapeHtml(ORIGEN_LABEL[origen] || origen)}</span>`)
      .join(' ');
  }

  function originSummary(origenes) {
    if (!origenes) return '';
    return ['consultaSinMaterial', 'valoracionBaja', 'reporteAbierto']
      .filter((origen) => Number(origenes[origen]) > 0)
      .map((origen) => `${ORIGEN_LABEL[origen]} ${Number(origenes[origen])}`)
      .join(' · ');
  }

  /**
   * Lectura por tema (#420, UJ-42): agrupa por el temario que declara la
   * unidad (`classes.topics`, servido por el backend en `temario` y `topics`).
   * Lo que no cae en ningún tema declarado va al grupo explícito «Sin tema».
   */
  function renderTopicReading(data) {
    const temas = Array.isArray(data.topics) ? data.topics : [];
    const sinTema = data.sinTema && typeof data.sinTema === 'object'
      ? data.sinTema
      : { tema: 'Sin tema', key: 'sin-tema', count: 0, origenes: {}, questions: [], questionVariants: 0 };
    const temario = data.temario || {};
    const encuentros = Array.isArray(temario.encuentros) ? temario.encuentros : [];
    const totalConsultas = temas.reduce((sum, t) => sum + (Number(t.count) || 0), 0) + (Number(sinTema.count) || 0);
    const resumenOrigenes = originSummary((data.origenes || {}).totales);

    const rowHeader = (tema, extraBadge) => `
      <div style="display:flex;align-items:baseline;gap:var(--space-2);flex-wrap:wrap">
        <span style="font-size:var(--font-size-sm);font-weight:600;flex:1;min-width:200px">${escapeHtml(tema.tema)}</span>
        ${extraBadge || ''}
        <span class="badge badge-info" title="${tema.count} consultas">${tema.count} consultas</span>
        ${originChips(Object.keys(tema.origenes || {}).filter((o) => Number(tema.origenes[o]) > 0 && o !== 'sinSenal'))}
      </div>`;

    const questionList = (tema) => {
      const questions = Array.isArray(tema.questions) ? tema.questions : [];
      if (questions.length === 0) {
        return '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:6px">Sin consultas en este grupo.</div>';
      }
      return `
        <details style="margin-top:6px">
          <summary style="cursor:pointer;font-size:var(--font-size-xs);color:var(--color-text-secondary)">Ver ${questions.length}${tema.questionVariants > questions.length ? ` de ${tema.questionVariants}` : ''} preguntas de este tema</summary>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:var(--font-size-xs);color:var(--color-text-secondary)">
            ${questions.map((q) => `<li>${escapeHtml(q.text)} <span class="badge badge-info">${q.count}</span> ${originChips(q.origenes)}</li>`).join('')}
          </ul>
        </details>`;
    };

    const themeRows = temas.map((tema, i) => `
      <div class="topic-item" data-tema="${escapeHtml(tema.key || tema.tema)}" style="border-bottom:1px solid var(--color-border);padding:var(--space-3) 0">
        ${rowHeader({ ...tema, tema: `${i + 1}. ${tema.tema}` }, (tema.declaredIn || []).length > 0
          ? `<span class="badge badge-info" title="Encuentros que declaran este tema">${(tema.declaredIn || []).map(escapeHtml).join(' · ')}</span>`
          : '')}
        ${questionList(tema)}
      </div>`).join('');

    const sinTemaRow = `
      <div class="topic-item topic-item--sin-tema" data-tema="sin-tema" style="border-bottom:1px solid var(--color-border);padding:var(--space-3) 0;background:var(--color-surface-2);border-radius:var(--radius-md)">
        ${rowHeader({
          ...sinTema,
          tema: `Sin tema · preguntas que no caen en el temario`,
        }, '<span class="badge badge-warning" title="Ningún tema declarado por la unidad coincide">Sin tema declarado</span>')}
        <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:4px">
          Ninguno de los ${Number(temario.totalTemas) || 0} temas que declara la unidad reúne estas consultas. Quedan acá, no se descartan.
        </div>
        ${questionList(sinTema)}
      </div>`;

    return `
      <div class="card" id="teacher-topic-reading" style="margin-bottom:var(--space-8)">
        <div class="card-header">
          <span class="card-title">🧩 Preguntas sin buena respuesta, por tema</span>
          <span class="badge badge-info">${temas.length} temas · ${totalConsultas} consultas</span>
        </div>
        <p style="margin:0 0 var(--space-2);color:var(--color-text-secondary);font-size:var(--font-size-xs)">
          Agrupado con el temario que declara la unidad (<code>classes.topics</code>: ${Number(temario.totalTemas) || 0} temas en ${encuentros.length} encuentros).
          Cada pregunta declara su origen: consulta sin material, valoración baja o reporte abierto.
          ${resumenOrigenes ? `<br><strong>Origen del total de la unidad:</strong> ${escapeHtml(resumenOrigenes)}.` : ''}
        </p>
        ${themeRows || '<div class="empty-state" style="padding:16px">Ninguna consulta cayó en un tema declarado por la unidad.</div>'}
        ${sinTemaRow}
      </div>`;
  }

  /**
   * Lectura por encuentro (#420, UJ-50): cada encuentro con sus consultas.
   * Se usa tanto para la participación como para los temas y su origen.
   */
  function renderEncounterThemes(entry) {
    const temas = Array.isArray(entry?.topics) ? entry.topics : [];
    if (temas.length === 0) {
      return '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:6px">Sin consultas atribuidas a este encuentro.</div>';
    }
    return `<ul style="margin:6px 0 0;padding-left:18px;font-size:var(--font-size-xs);color:var(--color-text-secondary)">
      ${temas.slice(0, 4).map((tema) => `<li>${escapeHtml(tema.tema)} <span class="badge badge-info">${tema.count}</span> ${originChips(Object.keys(tema.origenes || {}).filter((o) => Number(tema.origenes[o]) > 0 && o !== 'sinSenal'))}</li>`).join('')}
    </ul>`;
  }

  function computeThematicGaps(frictionTopics, classes, classViews) {
    if (!frictionTopics || frictionTopics.length === 0) return [];
    const maxQueries = Math.max(...frictionTopics.map((t) => Number(t.queries) || 0), 1);
    const allClassTopics = (classes || []).flatMap((c) => (Array.isArray(c.topics) ? c.topics : []));
    const viewedClassIds = new Set((classViews || []).map((v) => v.classId));

    return frictionTopics
      .map((t) => {
        const queries = Number(t.queries) || 0;
        const unresolved = Number(t.unresolved) || 0;
        const unresolvedRatio = queries > 0 ? unresolved / queries : 0;
        const volume = maxQueries > 0 ? queries / maxQueries : 0;

        const tokens = tokenize(t.topic);
        const matchingTopics = allClassTopics.filter((ct) =>
          tokens.some((tok) => String(ct).toLowerCase().includes(tok))
        );
        const coverage = allClassTopics.length > 0 ? matchingTopics.length / allClassTopics.length : 0;
        const lowCoverage = 1 - coverage;

        const viewedCoverage = (classes || []).filter((c) => viewedClassIds.has(c.id)).length /
          Math.max((classes || []).length, 1);

        const score = unresolvedRatio * volume * (0.5 + lowCoverage + viewedCoverage);
        const severity = unresolvedRatio < 0.3 ? 'green' : unresolvedRatio <= 0.6 ? 'yellow' : 'red';

        return {
          topic: t.topic,
          queries,
          unresolved,
          unresolvedRatio,
          volume,
          coverage,
          lowCoverage,
          score,
          severity,
          matchingTopics,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  function renderThematicGaps(gaps, topQuestions) {
    const relatedQueriesFor = (topic) => {
      const tokens = tokenize(topic);
      if (tokens.length === 0) return [];
      return (topQuestions || []).filter((q) =>
        tokens.some((tok) => String(q.text).toLowerCase().includes(tok))
      );
    };

    const suggestedTopicsFor = (gap) => {
      if (gap.matchingTopics && gap.matchingTopics.length > 0) return gap.matchingTopics;
      const candidates = new Set();
      (topQuestions || []).forEach((q) => {
        tokenize(q.text).forEach((tok) => {
          candidates.add(tok.charAt(0).toUpperCase() + tok.slice(1));
        });
      });
      return Array.from(candidates).slice(0, 5);
    };

    if (!gaps || gaps.length === 0) {
      return `
        <div class="card" id="teacher-gaps-card" style="margin-bottom:var(--space-8)">
          <div class="card-header">
            <span class="card-title">🕳️ Vacíos Temáticos</span>
            <span class="badge badge-info">Sin datos</span>
          </div>
          <div class="empty-state" style="padding:20px">Aún no hay suficiente fricción detectada para calcular vacíos temáticos.</div>
        </div>
      `;
    }

    return `
      <div class="card" id="teacher-gaps-card" style="margin-bottom:var(--space-8)">
        <div class="card-header">
          <span class="card-title">🕳️ Vacíos Temáticos</span>
          <span class="badge badge-warning">Fricción × Cobertura × Volumen</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-4)" id="teacher-gaps-list">
          ${gaps.map((g, i) => {
      const pct = Math.round(g.unresolvedRatio * 100);
      const color = gapSeverityColor(g.severity);
      const related = relatedQueriesFor(g.topic);
      const suggested = suggestedTopicsFor(g);
      return `
              <div class="gap-item" data-severity="${g.severity}" data-topic="${escapeHtml(g.topic)}">
                <div class="gap-item-head">
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:var(--space-2)">
                      <span style="font-size:var(--font-size-sm);font-weight:600">${i + 1}. ${escapeHtml(g.topic)}</span>
                      <span class="badge gap-badge gap-severity-${g.severity}">${gapSeverityLabel(g.severity)}</span>
                    </div>
                    <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:4px">
                      ${g.unresolvedRatio > 0 ? `${pct}% sin resolver · ` : ''}${g.queries} consultas · cobertura de clases ${Math.round(g.coverage * 100)}%
                    </div>
                  </div>
                  <button class="gap-expand-toggle" data-gap-index="${i}" aria-expanded="false" aria-label="Ver consultas y temas para ${escapeHtml(g.topic)}">▾</button>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="--progress-value:${pct}%;background:${color}"></div>
                </div>
                <div class="gap-expand" data-gap-panel="${i}" hidden>
                  ${related.length > 0 ? `
                    <div class="gap-expand-section">
                      <div class="gap-expand-title">📝 Consultas de alumnos relacionadas</div>
                      <ul class="gap-query-list">
                        ${related.slice(0, 5).map(q => `<li>${escapeHtml(q.text)} <span class="gap-query-count">${q.count}</span></li>`).join('')}
                      </ul>
                    </div>
                  ` : `
                    <div class="gap-expand-section">
                      <div class="gap-expand-title">📝 Consultas de alumnos relacionadas</div>
                      <div style="font-size:var(--font-size-xs);color:var(--color-text-muted)">Sin consultas relacionadas detectadas.</div>
                    </div>
                  `}
                  ${suggested.length > 0 ? `
                    <div class="gap-expand-section">
                      <div class="gap-expand-title">🎯 Temas a reforzar en clase</div>
                      <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
                        ${suggested.slice(0, 6).map(s => `<span class="gap-suggested-topic">${escapeHtml(s)}</span>`).join('')}
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;
  }

  try {
    const [data, classes, classViews, enrollments, users, safetyRate] = await Promise.all([
      api.getTeacherAnalytics(activeSubjectId),
      api.getClasses(activeSubjectId).catch(() => []),
      api.getClassViews(activeSubjectId).catch(() => []),
      api.getEnrollmentsBySubject(activeSubjectId).catch(() => []),
      api.getAdminUsers().catch(() => []),
      api.getSafetyRate(activeSubjectId, 30).catch(() => null),
    ]);
    if (!data || !data.topQuestions || !data.frictionTopics) {
      throw new Error('Datos de analítica incompletos');
    }
    const maxCount = Math.max(...data.topQuestions.map(q => q.count));
    const gaps = computeThematicGaps(data.frictionTopics, classes, classViews);

    container.innerHTML = `
    <div class="grid-3" id="teacher-safety-rate-grid" style="margin-bottom:var(--space-8)">
      <div class="card" id="teacher-safety-rate-card">
        <div class="card-header">
          <span class="card-title">🛡️ Tasa Fallo Seguro</span>
          <span class="badge ${safetyRate?.status === 'red' ? 'badge-error' : safetyRate?.status === 'yellow' ? 'badge-warning' : 'badge-success'}">${safetyRate?.status ? teacherStatusLabel(safetyRate.status) : 'Sin datos'}</span>
        </div>
        <div style="padding:var(--space-4)">
          <div style="font-size:2rem;font-weight:700;color:${teacherSafetyColor(safetyRate?.safetyRatePercent)}">${safetyRate ? Number(safetyRate.safetyRatePercent).toFixed(1) + '%' : '-'}</div>
          <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:var(--space-2)">
            ${safetyRate ? `${safetyRate.totalRequests} consultas · ${safetyRate.blockedBySafety} bloqueos por seguridad · ${safetyRate.errorCategorizedFailures} fallos categorizados` : 'Sin datos de consultas RAG todavía.'}
          </div>
        </div>
      </div>
    </div>

    <!-- #467: la lectura de "Alertas docentes" salió de esta pantalla. Su fuente
         (GET /api/sga/teacher-alerts) devuelve una lista fija vacía, sin tabla ni
         blob detrás: una tarjeta vacía se lee como "no hay riesgo" cuando en
         realidad no hay medición. Vuelve cuando exista la fuente real. -->

    <div class="grid-2" style="margin-bottom:var(--space-8)">
      <!-- Top Questions -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">💬 Consultas más frecuentes</span>
          <span class="badge badge-info">Últimos 30 días</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-2) 0">
          ${data.topQuestions.map((q, i) => `
            <div style="display:flex;align-items:baseline;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--color-surface-2)">
              <span style="font-size:var(--font-size-xs);font-weight:700;color:var(--color-text-muted);min-width:20px">${i + 1}.</span>
              <span style="flex:1;font-size:var(--font-size-sm);line-height:1.4">${escapeHtml(q.text)}
                <span style="display:block;font-size:10px;color:var(--color-text-muted);margin-top:2px">Tema: ${escapeHtml(q.tema || 'Sin tema')}</span>
              </span>
              <span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                <span class="badge badge-info" title="${q.count} consultas">${q.count}</span>
                ${originChips(q.origenes)}
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Friction Topics -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">🔥 Temas con más fricción</span>
          <span class="badge badge-warning">Priorizar en clase</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">
          ${data.frictionTopics.map((t, i) => {
    const pct = Math.round((t.unresolved / t.queries) * 100);
    return `
              <div class="friction-item">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
                  <span style="font-size:var(--font-size-sm);font-weight:600">${i + 1}. ${escapeHtml(t.topic)}</span>
                  <span class="badge badge-error">${pct}% sin resolver</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="--progress-value:${pct}%"></div>
                </div>
                <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:4px;display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
                  <span>${t.queries} consultas · ${t.unresolved} sin respuesta satisfactoria</span>
                  <span style="font-size:10px">· Tema: ${escapeHtml(t.tema || 'Sin tema')}</span>
                  ${originChips(t.origenes)}
                </div>
              </div>
            `;
  }).join('')}
        </div>
      </div>
    </div>

    ${renderThematicGaps(gaps, data.topQuestions)}

    ${renderTopicReading(data)}

    ${renderEncounterReading(data.byClass, classes, classViews, enrollments, escapeHtml, renderEncounterThemes)}

    <!-- Queries over time (simple bar chart) -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">📈 Frecuencia de consultas por tema</span>
        <span class="badge badge-info">Temario de la unidad</span>
      </div>
      <div class="bar-chart">
        ${(() => {
    // El gráfico se arma con los temas declarados (#420), no con el texto
    // literal de cada pregunta: es la lectura que el título promete.
    const temasChart = (Array.isArray(data.topics) ? data.topics : []).slice(0, 8);
    const sinTemaChart = data.sinTema && Number(data.sinTema.count) > 0
      ? [{ tema: 'Sin tema', count: Number(data.sinTema.count), key: 'sin-tema' }]
      : [];
    const serie = [...temasChart, ...sinTemaChart];
    const maxTema = Math.max(...serie.map((t) => Number(t.count) || 0), 1);
    return serie.map((t) => {
      const shortLabel = t.tema.length > 28 ? `${t.tema.slice(0, 28)}…` : t.tema;
      return `
          <div class="bar-chart-item" data-tema="${escapeHtml(t.key || t.tema)}">
            <div class="bar-chart-bar-wrap">
              <div class="bar-chart-bar" style="--bar-height:${Math.round((Number(t.count) / maxTema) * 100)}%" title="${escapeHtml(t.tema)}: ${t.count} consultas"></div>
            </div>
            <div class="bar-chart-label" title="${escapeHtml(t.tema)}">${escapeHtml(shortLabel)}</div>
            <div class="bar-chart-val">${t.count}</div>
          </div>
        `;
    }).join('');
  })()}
      </div>
    </div>

    ${renderStudentProgress(classes, classViews, enrollments, users, escapeHtml)}
  `;

    container.querySelectorAll('.gap-expand-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = container.querySelector(`[data-gap-panel="${btn.dataset.gapIndex}"]`);
        if (!panel) return;
        const expanded = panel.hidden;
        panel.hidden = !expanded;
        btn.setAttribute('aria-expanded', String(expanded));
        btn.textContent = expanded ? '▴' : '▾';
      });
    });
  } catch (err) {
    console.error('Error loading analytics:', err);
    const feedback = apiErrorFeedback(err, {
      ENROLLMENT_INACTIVE: 'Tu identidad no figura como docente activo de esta materia. Contactá a administración o verificá tu inscripción.',
      FORBIDDEN: 'Tu rol no permite ver analítica de esta materia.',
      ACCESS_DENIED: 'Tu cuenta no está habilitada en la plataforma. Contactá a administración.',
      auth: 'Tu cuenta no tiene permisos para ver la analítica de esta materia.',
    });
    container.innerHTML = `
      <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
        <div class="empty-state-icon" aria-hidden="true">📊</div>
        <h2 class="h3">${escapeHtml(feedback.title)}</h2>
        <p style="color:var(--color-text-secondary)">${escapeHtml(feedback.message || 'No se pudieron cargar los datos de analítica.')}</p>
        ${feedback.hint ? `<p style="color:var(--color-warning);font-weight:600;margin-top:var(--space-2)">${escapeHtml(feedback.hint)}</p>` : ''}
        ${feedback.retryable ? `<button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar cargar la página">Reintentar</button>` : `
          <div style="margin-top:var(--space-4)">
            <button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar cargar la página">Reintentar</button>
          </div>
        `}
      </div>
    `;
  }
}

/**
 * Lectura por encuentro (#420, UJ-50): cada encuentro con su participación
 * (alumnos inscriptos que lo abrieron) y las consultas que se le atribuyen por
 * el alcance de la consulta (`byClass` del backend). Sin promedio de la unidad:
 * cada encuentro se lee por separado.
 */
function renderEncounterReading(byClass, classes, classViews, enrollments, escapeHtml, renderThemes) {
  const ORIGEN_CORTO = { consultaSinMaterial: 'sin material', valoracionBaja: 'valoración baja', reporteAbierto: 'reporte abierto' };
  const originLine = (origenes) => {
    if (!origenes) return '';
    return Object.keys(ORIGEN_CORTO)
      .filter((origen) => Number(origenes[origen]) > 0)
      .map((origen) => `${ORIGEN_CORTO[origen]} ${Number(origenes[origen])}`)
      .join(' · ');
  };

  const enrolled = new Set(
    (enrollments || [])
      .filter((e) => e.role === 'student' && e.status === 'active')
      .map((e) => e.userId)
      .filter((sid) => sid && String(sid).toLowerCase() !== 'anonymous')
  );

  const viewedByClass = {};
  for (const v of classViews || []) {
    if (!enrolled.has(v.studentId)) continue;
    if (!viewedByClass[v.classId]) viewedByClass[v.classId] = new Set();
    viewedByClass[v.classId].add(v.studentId);
  }

  const byClassId = new Map((byClass || []).map((c) => [c.classId, c]));
  const ordered = [...(classes || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  const rows = ordered.map((c) => {
    const viewed = viewedByClass[c.id] ? viewedByClass[c.id].size : 0;
    const pct = enrolled.size > 0 ? Math.round((viewed / enrolled.size) * 100) : 0;
    const q = byClassId.get(c.id);
    const themes = q && typeof renderThemes === 'function'
      ? renderThemes(q)
      : '<div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:6px">Sin consultas atribuidas a este encuentro.</div>';
    const declared = Array.isArray(c.topics) && c.topics.length
      ? `<div style="font-size:10px;color:var(--color-text-muted);margin-top:4px">Temario que declara el encuentro: ${c.topics.map((topic) => escapeHtml(topic)).join(' · ')}</div>`
      : '';
    const literal = q && Array.isArray(q.topQuestions) && q.topQuestions.length
      ? `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:var(--font-size-xs);color:var(--color-text-muted)">Ver preguntas literales del encuentro</summary>
          <ul style="margin:4px 0 0;padding-left:18px;font-size:var(--font-size-xs);color:var(--color-text-secondary)">${q.topQuestions
          .map((t) => `<li>${escapeHtml(t.text)} <span class="badge badge-info">${t.count}</span></li>`)
          .join('')}</ul></details>`
      : '';
    return `
      <div class="encounter-item" data-class-id="${escapeHtml(c.id)}" style="border-bottom:1px solid var(--color-border);padding:var(--space-3) 0">
        <div style="display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap">
          <span style="font-size:var(--font-size-sm);font-weight:600;flex:1;min-width:180px">${escapeHtml(c.title || c.name || c.id)}</span>
          <span class="badge ${pct >= 60 ? 'badge-success' : pct > 0 ? 'badge-warning' : 'badge-error'}">${viewed}/${enrolled.size} participaron (${pct}%)</span>
          <span class="badge badge-info">${q ? q.questionCount : 0} consultas</span>
          ${q && originLine(q.origenes) ? `<span style="font-size:10px;color:var(--color-text-muted)">${originLine(q.origenes)}</span>` : ''}
        </div>
        ${themes}
        ${declared}
        ${literal}
      </div>`;
  }).join('');

  return `
    <div class="card" id="teacher-encounter-reading" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">🧭 Lectura por encuentro</span>
        <span class="badge badge-info">${ordered.length} encuentros · ${enrolled.size} inscriptos</span>
      </div>
      <p style="margin:0 0 var(--space-2);color:var(--color-text-secondary);font-size:var(--font-size-xs)">
        Participación (inscriptos que abrieron el encuentro) y consultas atribuidas a cada encuentro por el alcance de la consulta.
      </p>
      ${rows || '<div class="empty-state" style="padding:20px">No hay encuentros para leer.</div>'}
    </div>
  `;
}

function renderStudentProgress(classes, classViews, enrollments, users, escapeHtml) {
  const studentEnrollments = (enrollments || []).filter(e => e.role === 'student' && e.status === 'active');
  // Only enrolled students: never leak raw ids from stale classViews and
  // never render the "anonymous" row (#336).
  const studentIds = [...new Set(studentEnrollments.map(e => e.userId).filter(Boolean))]
    .filter(sid => String(sid).toLowerCase() !== 'anonymous');

  if (studentIds.length === 0 || !classes || classes.length === 0) {
    return `
      <div class="card" style="margin-bottom:var(--space-8)">
        <div class="card-header">
          <span class="card-title">👥 Progreso de Alumnos</span>
        </div>
        <div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--text-sm)">No hay alumnos inscriptos o clases para mostrar progreso.</div>
      </div>
    `;
  }

  const usersById = new Map((users || []).map(u => [u.id || u.userId, u]));
  const studentNames = {};
  for (const sid of studentIds) {
    const u = usersById.get(sid);
    studentNames[sid] = u ? (u.name ? `${u.name} ${u.surname || ''}`.trim() : u.email) : sid;
  }

  const viewsByStudent = {};
  for (const v of classViews) {
    if (!viewsByStudent[v.studentId]) viewsByStudent[v.studentId] = new Set();
    viewsByStudent[v.studentId].add(v.classId);
  }

  const sortedClasses = [...classes].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  return `
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">👥 Progreso de Alumnos</span>
        <span class="badge badge-info">${studentIds.length} alumnos · ${sortedClasses.length} clases</span>
      </div>
      <div style="overflow-x:auto;padding:var(--space-2)">
        <table class="data-table">
          <thead>
            <tr>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);white-space:nowrap;font-weight:600;position:sticky;left:0;background:var(--color-surface);">Alumno</th>
              ${sortedClasses.map(c => `
                <th style="text-align:center;padding:var(--space-2) var(--space-1);white-space:nowrap;font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.title)}">${escapeHtml(c.title).split('—')[1]?.trim() || escapeHtml(c.title).slice(0, 20)}</th>
              `).join('')}
              <th style="text-align:center;padding:var(--space-2) var(--space-3);white-space:nowrap;font-weight:600;">% Visto</th>
            </tr>
          </thead>
          <tbody>
            ${studentIds.map(sid => {
              const viewed = viewsByStudent[sid] || new Set();
              const viewedCount = sortedClasses.filter(c => c.summaryReady && viewed.has(c.id)).length;
              const availableCount = sortedClasses.filter(c => c.summaryReady).length;
              const pct = availableCount > 0 ? Math.round((viewedCount / availableCount) * 100) : 0;
              return `
                <tr>
                  <td style="padding:var(--space-2) var(--space-3);font-weight:500;white-space:nowrap;position:sticky;left:0;background:var(--color-surface);">${escapeHtml(studentNames[sid] || sid)}</td>
                  ${sortedClasses.map(c => {
                    if (!c.summaryReady) return '<td style="text-align:center;padding:var(--space-2);color:var(--color-text-muted)">—</td>';
                    const seen = viewed.has(c.id);
                    return `
                      <td style="text-align:center;padding:var(--space-2);">
                        <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${seen ? '#10b981' : 'var(--color-surface-2)'};color:${seen ? 'white' : 'var(--color-text-muted)'};font-size:11px;line-height:18px;font-weight:700;">${seen ? '✓' : '·'}</span>
                      </td>
                    `;
                  }).join('')}
                  <td style="text-align:center;padding:var(--space-2) var(--space-3);font-weight:600;">${pct}%</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:var(--space-2) var(--space-3);font-size:10px;color:var(--color-text-muted);border-top:1px solid var(--color-border);display:flex;gap:var(--space-4);align-items:center;">
        <span>👤 ${studentIds.length} alumnos</span>
        <span>📚 ${sortedClasses.length} clases</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#10b981;"></span> Visto</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--color-surface-2);"></span> No visto</span>
        <span style="display:flex;align-items:center;gap:4px;color:var(--color-text-muted);">— No disponible</span>
      </div>
    </div>
  `;
}
