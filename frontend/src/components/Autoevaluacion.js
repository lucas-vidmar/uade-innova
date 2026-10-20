/* ============================================================
   Autoevaluacion.js — Práctica de autoevaluación (de una clase o de la unidad)
   Flujo: anunciar el alcance → acotarlo (si es de la unidad) → responder → resultados
   ============================================================ */
import { api } from '../services/api.js';
import { toast } from './Toast.js';
import { renderPrivacyModal } from './PrivacyModal.js';

const QUIZ_STYLE = `
<style>
.quiz-section { display:flex; flex-direction:column; gap:var(--space-4); }
.quiz-progress-track { height:8px; background:var(--color-surface-2); border-radius:var(--radius-full); overflow:hidden; }
.quiz-progress-fill { height:100%; background:var(--color-primary); border-radius:var(--radius-full); transition:width 0.3s ease; }
.quiz-option { display:flex; align-items:center; gap:var(--space-3); width:100%; padding:var(--space-3) var(--space-4); border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-surface); cursor:pointer; transition:all var(--transition); font-family:var(--font-family); font-size:var(--font-size-sm); color:var(--color-text-primary); text-align:left; }
.quiz-option:hover { border-color:var(--color-primary); }
.quiz-option.selected { border-color:var(--color-primary); background:color-mix(in srgb, var(--color-primary) 12%, transparent); }
.quiz-option.correct { border-color:var(--color-success); background:color-mix(in srgb, var(--color-success) 15%, transparent); }
.quiz-option.incorrect { border-color:var(--color-error); background:color-mix(in srgb, var(--color-error) 12%, transparent); }
.quiz-option .option-letter { font-weight:700; color:var(--color-text-secondary); flex-shrink:0; }
.quiz-option.selected .option-letter { color:var(--color-primary-light); }
.quiz-option.correct .option-letter { color:var(--color-success); }
.quiz-option.incorrect .option-letter { color:var(--color-error); }
.quiz-score-badge { font-size:3.2rem; font-weight:800; line-height:1; }
.quiz-pass-banner { border-radius:var(--radius-lg); padding:var(--space-6); text-align:center; animation:fadeIn 0.4s ease; }
@keyframes quizCelebrate { 0% { transform: scale(0.6); opacity:0; } 60% { transform: scale(1.15); } 100% { transform: scale(1); opacity:1; } }
.quiz-celebrate { animation:quizCelebrate 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
.quiz-review-item { padding:var(--space-4); border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-surface); }
.quiz-topic-chip { display:inline-block; padding:4px 12px; border-radius:var(--radius-full); font-size:var(--font-size-xs); font-weight:600; }
.quiz-count-select { display:flex; gap:var(--space-2); }
.quiz-count-btn { padding:var(--space-2) var(--space-4); border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-surface); color:var(--color-text-secondary); font-weight:600; font-size:var(--font-size-sm); cursor:pointer; transition:all var(--transition); font-family:var(--font-family); }
.quiz-count-btn.active { border-color:var(--color-primary); background:color-mix(in srgb, var(--color-primary) 15%, transparent); color:var(--color-primary-light); }
.quiz-scope-row { display:grid; grid-template-columns:auto 1fr; gap:var(--space-3); align-items:start; padding:var(--space-3); border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-surface); cursor:pointer; }
.quiz-scope-row.off { opacity:.55; }
.quiz-scope-row input { margin-top:2px; accent-color:var(--color-primary); width:16px; height:16px; }
.quiz-scope-topics { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.quiz-scope-topic { padding:2px 10px; border-radius:var(--radius-full); font-size:var(--font-size-xs); font-weight:600; background:color-mix(in srgb, var(--color-primary) 12%, transparent); color:var(--color-primary-light); }
.quiz-scope-topic.weak { background:color-mix(in srgb, var(--color-warning) 16%, transparent); color:var(--color-warning); }
.quiz-scope-meta { font-size:var(--font-size-xs); color:var(--color-text-secondary); margin-top:4px; }
.quiz-priority-btn { padding:4px 12px; border-radius:var(--radius-full); border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-size:var(--font-size-xs); font-weight:600; cursor:pointer; font-family:var(--font-family); }
.quiz-priority-btn.active { border-color:var(--color-warning); color:var(--color-warning); background:color-mix(in srgb, var(--color-warning) 15%, transparent); }
</style>`;

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Compara el intento recién cerrado con el anterior, tema por tema (UJ-31, paso 7).
 * El anterior llega resumido por tema desde /quiz-attempts; el actual se deduce de
 * las respuestas corregidas.
 */
function buildTopicComparison(previousAttempt, answers) {
    if (!previousAttempt) return [];
    const before = previousAttempt.topics || {};
    const current = {};
    for (const a of answers || []) {
        const topic = a?.topic || 'Sin tema';
        if (!current[topic]) current[topic] = { asked: 0, correct: 0 };
        current[topic].asked += 1;
        if (a?.isCorrect) current[topic].correct += 1;
    }
    const topics = Array.from(new Set([...Object.keys(before), ...Object.keys(current)]));
    return topics.map((topic) => {
        const b = before[topic] || null;
        const c = current[topic] || null;
        const beforeRatio = b && b.asked ? b.correct / b.asked : null;
        const afterRatio = c && c.asked ? c.correct / c.asked : null;
        let verdict = 'se mantuvo';
        if (beforeRatio === null) verdict = 'tema nuevo';
        else if (afterRatio === null) verdict = 'no se evaluó';
        else if (afterRatio > beforeRatio) verdict = 'avanzaste';
        else if (afterRatio < beforeRatio) verdict = 'retrocediste';
        return { topic, beforeRatio, afterRatio, verdict };
    });
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function jsonResponseError(err, fallbackMsg) {
    if (err?.errorCategory === 'RATE_LIMIT') {
        return { message: err.message || 'Límite de intentos alcanzado.', rateLimited: true };
    }
    return { message: err?.message || fallbackMsg, rateLimited: false };
}

function isConsentError(err) {
    if (!err) return false;
    const code = String(err?.code || err?.error?.code || '').toUpperCase();
    const msg = String(err?.message || '').toUpperCase();
    return code.includes('CONSENT') || msg.includes('CONSENT');
}

/**
 * UJ-30 (pasos 6 y 8): destinos reales desde el resultado.
 * El encuentro es la vista de la clase donde vive el material (síntesis,
 * transcripción, materiales). El chat se abre acotado a la clase y con la
 * pregunta ya escrita —`preset` es lo que el widget de chat consume—, para que
 * consultar el tema flojo no obligue a reescribir la pregunta a mano.
 */
function classEncounterHref(classId) {
    return `#/student/class/${encodeURIComponent(classId)}`;
}

function chatConsultHref(classId, question) {
    const params = new URLSearchParams({ classId, preset: question });
    return `#/student/chat?${params.toString()}`;
}

function consultQuestion(topic, source) {
    const t = topic || 'este tema';
    return source
        ? `Quiero repasar "${t}". ¿Me lo explicás según ${source}?`
        : `Quiero repasar "${t}". ¿Me lo explicás con el material de esta clase?`;
}

/**
 * Estado interno del widget (evita re-render completo al cambiar de pregunta).
 */
let state = {
    questions: [],
    answers: [],
    currentIndex: 0,
    questionCount: 5,
    quizId: null,
    result: null,
    busy: false,
    previousAttempt: null,
    // UJ-30 (paso 7): temas flojos que la persona marcó, por persona y unidad.
    markedTopics: [],
    // UJ-30 (pasos 1 y 2): alcance de la práctica. En la unidad, `scopeData` es
    // el anuncio del servidor, `selectedClassIds` el acotamiento vigente y
    // `priorityTopics` los temas que la persona pidió priorizar.
    scope: 'class',
    scopeData: null,
    selectedClassIds: [],
    priorityTopics: [],
};

let hostContainer = null;
let hostOptions = null;

function resetState() {
    state = {
        questions: [],
        answers: [],
        currentIndex: 0,
        questionCount: 5,
        quizId: null,
        result: null,
        busy: false,
        previousAttempt: null,
        markedTopics: [],
        scope: 'class',
        scopeData: null,
        selectedClassIds: [],
        priorityTopics: [],
    };
}

/**
 * UJ-30 (paso 1): anuncia el alcance de la práctica de la unidad. El anuncio sale
 * del servidor —clases publicadas, sus temas y materiales—, no de una suposición
 * del panel. Sin anuncio no se ofrece generar: practicar a ciegas de qué es la
 * práctica es exactamente lo que el issue reporta.
 */
function renderScopeError(mount, { subjectId, className }) {
    mount.innerHTML = `
        <div class="card">
            <div style="padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-3)">
                <h4 style="margin:0;font-weight:700;">Práctica de la unidad</h4>
                <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                    No pudimos cargar qué temas abarca la práctica de ${escapeHtml(className || 'esta unidad')}.
                    Sin ese alcance no la generamos: probá de nuevo.
                </p>
                <button type="button" class="btn btn-ghost" id="quiz-scope-retry" style="align-self:flex-start;">Reintentar</button>
            </div>
        </div>
    `;
    mount.querySelector('#quiz-scope-retry')?.addEventListener('click', () => {
        renderAutoevaluacion(hostContainer, { subjectId, className, scope: 'unit' });
    });
}

export async function renderAutoevaluacion(container, { classId, subjectId, className, scope = 'class' } = {}) {
    hostContainer = container;
    hostOptions = { classId, subjectId, className, scope };
    container.innerHTML = QUIZ_STYLE + `<div class="quiz-section" id="quiz-mount"></div>`;
    const mount = container.querySelector('#quiz-mount');
    resetState();
    state.scope = scope;
    const isUnit = scope === 'unit';

    let latestResult = null;
    let attempts = [];
    try {
        latestResult = await api.getQuizResult(subjectId, classId, { scope });
    } catch {
        latestResult = null;
    }
    try {
        attempts = await api.getQuizAttempts(subjectId, classId, { scope });
    } catch {
        attempts = [];
    }
    // UJ-30 (paso 7): la marca de temas flojos vive en el servidor, por persona
    // y unidad, para que no se pierda al cerrar la pestaña.
    try {
        state.markedTopics = await api.getQuizWeakTopics(subjectId, classId, { scope });
    } catch {
        state.markedTopics = [];
    }
    // El intento anterior queda a mano para poder comparar al cerrar (UJ-31, paso 7).
    state.previousAttempt = attempts.length ? attempts[attempts.length - 1] : null;

    if (isUnit) {
        const scopeData = await api.getQuizScope(subjectId).catch(() => null);
        if (!scopeData || !Array.isArray(scopeData.classes) || scopeData.classes.length === 0) {
            renderScopeError(mount, { subjectId, className });
            return;
        }
        state.scopeData = scopeData;
        // El alcance arranca completo (todos los temas publicados) y se acota
        // destildando; los temas que la persona ya marcó flojos vienen elegidos.
        state.selectedClassIds = scopeData.classes.map((c) => c.classId);
        state.priorityTopics = Array.from(new Set(
            (scopeData.topics || []).filter((t) => t.markedWeak).map((t) => t.topic)
        ));
    }

    renderIdle(mount, { classId, subjectId, className, latestResult, attempts, scope });
}

function renderIdle(mount, { classId, subjectId, className, latestResult, attempts = [], scope = 'class' }) {
    const isUnit = scope === 'unit';
    const opts = { classId, subjectId, className, scope };
    const passScore = latestResult && latestResult.score >= 60;
    const attemptNumber = attempts.length + 1;
    const previousCount = attempts.length;
    const scopeClasses = isUnit ? (state.scopeData?.classes || []) : [];
    const unitTopics = isUnit ? (state.scopeData?.topics || []) : [];
    const markedUnitTopics = Array.from(new Set(unitTopics.filter((t) => t.markedWeak).map((t) => t.topic)));
    const selectedTopics = unitTopics.filter((t) => state.selectedClassIds.includes(t.classId));
    const scopeSummary = isUnit
        ? (state.selectedClassIds.length === scopeClasses.length
            ? `Alcance: unidad completa (${unitTopics.length} temas de ${scopeClasses.length} clases).`
            : `Alcance acotado: ${selectedTopics.length} de ${unitTopics.length} temas (${state.selectedClassIds.length} de ${scopeClasses.length} clases).`)
        : '';

    mount.innerHTML = `
        <div class="card" style="margin-bottom:var(--space-4)">
            <div style="padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-5)">
                <div style="display:flex;align-items:center;gap:var(--space-3)">
                    <div style="width:48px;height:48px;border-radius:var(--radius-lg);background:color-mix(in srgb, var(--color-primary) 15%, transparent);display:flex;align-items:center;justify-content:center;font-size:1.5rem;">📝</div>
                    <div>
                        <h4 style="margin:0;font-weight:700;">${isUnit ? 'Práctica de la unidad' : 'Autoevaluación'}</h4>
                        <p style="margin:var(--space-1) 0 0 0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">${isUnit ? 'Poné a prueba tu comprensión de la unidad completa, no de una clase suelta.' : 'Poné a prueba tu comprensión de esta clase.'}</p>
                    </div>
                </div>

                ${isUnit ? `
                    <div class="card" id="quiz-scope-announcement" style="border:1px solid var(--color-primary);background:color-mix(in srgb, var(--color-primary) 6%, transparent);">
                        <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-3);">
                            <strong style="font-size:var(--font-size-sm);">Antes de empezar: qué abarca esta práctica</strong>
                            <p id="quiz-scope-headline" style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-primary);">${escapeHtml(state.scopeData?.headline || '')}</p>
                            <div id="quiz-scope-classes" style="display:flex;flex-direction:column;gap:var(--space-2);">
                                ${scopeClasses.map((c) => `
                                    <label class="quiz-scope-row ${state.selectedClassIds.includes(c.classId) ? '' : 'off'}" data-class-id="${escapeHtml(c.classId)}">
                                        <input type="checkbox" class="quiz-scope-class" data-class-id="${escapeHtml(c.classId)}" ${state.selectedClassIds.includes(c.classId) ? 'checked' : ''}>
                                        <span>
                                            <span style="font-size:var(--font-size-sm);font-weight:600;">${escapeHtml(c.title)}</span>
                                            <span class="quiz-scope-topics">
                                                ${(c.topics || []).map((t) => `<span class="quiz-scope-topic ${state.markedTopics.includes(t) ? 'weak' : ''}">${state.markedTopics.includes(t) ? '★ ' : ''}${escapeHtml(t)}</span>`).join('')}
                                            </span>
                                            <span class="quiz-scope-meta">${c.materialCount} material${c.materialCount === 1 ? '' : 'es'} · ${c.topicsDeclared ? 'temas declarados por la cátedra' : 'sin temas declarados: se practica la clase completa'}</span>
                                        </span>
                                    </label>
                                `).join('')}
                            </div>
                            ${markedUnitTopics.length > 0 ? `
                                <div id="quiz-priority-topics" style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;">
                                    <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">Temas que marcaste flojos (elegí los que más te preocupan):</span>
                                    ${markedUnitTopics.map((t) => `
                                        <button type="button" class="quiz-priority-btn ${state.priorityTopics.includes(t) ? 'active' : ''}" data-topic="${escapeHtml(t)}" aria-pressed="${state.priorityTopics.includes(t)}">${state.priorityTopics.includes(t) ? '★' : '☆'} ${escapeHtml(t)}</button>
                                    `).join('')}
                                </div>
                            ` : ''}
                            <p id="quiz-scope-summary" style="margin:0;font-size:var(--font-size-xs);color:var(--color-text-secondary);font-weight:600;">${scopeSummary}</p>
                            <p id="quiz-scope-warning" style="margin:0;font-size:var(--font-size-xs);color:var(--color-error);${state.selectedClassIds.length === 0 ? '' : 'display:none;'}">Elegí al menos un tema para poder practicar.</p>
                        </div>
                    </div>
                ` : ''}

                ${latestResult ? `
                    <div class="quiz-pass-banner" style="border:1px solid ${passScore ? 'var(--color-success)' : 'var(--color-warning)'};background:color-mix(in srgb, ${passScore ? 'var(--color-success)' : 'var(--color-warning)'} 10%, transparent);">
                        <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary);">Tu último intento${previousCount > 1 ? ` (${previousCount} en total)` : ''}</div>
                        <div class="quiz-score-badge" style="color:${passScore ? 'var(--color-success)' : 'var(--color-warning)'};">${latestResult.score}%</div>
                        <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary);">${passScore ? '¡Aprobado!' : 'Aún no aprobás. Repasá y volvé a intentar.'}</div>
                    </div>
                ` : ''}

                ${latestResult && (latestResult.answers || []).length > 0 ? `
                    <button type="button" class="btn btn-ghost" id="quiz-view-last-btn" style="align-self:flex-start;">Ver el último resultado</button>
                ` : ''}

                ${!isUnit && state.markedTopics.length > 0 ? `
                    <div class="card" id="quiz-marked-topics" style="border:1px solid var(--color-border);">
                        <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);">
                            <strong style="font-size:var(--font-size-sm);">Tus temas flojos en esta clase</strong>
                            <p style="margin:0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">Los marcaste vos. Abrí la consulta para repasarlos con el material.</p>
                            <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
                                ${state.markedTopics.map(t => `
                                    <a class="quiz-topic-chip quiz-marked-topic" style="text-decoration:none;background:color-mix(in srgb, var(--color-warning) 14%, transparent);color:var(--color-warning);" href="${chatConsultHref(classId, consultQuestion(t, ''))}">★ ${escapeHtml(t)}</a>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                ` : ''}

                ${state.previousAttempt ? `
                    <div id="quiz-attempt-notice" style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);background:var(--color-surface-2);font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                        Esta va a ser tu <strong>práctica ${attemptNumber}</strong> sobre ${isUnit ? 'la unidad' : 'esta clase'}: cubre los mismos temas que la anterior
                        (${previousCount === 1 ? '1 intento previo' : `${previousCount} intentos previos`}) y deja afuera las preguntas que ya respondiste.
                    </div>
                ` : ''}

                <div>
                    <label class="form-label" style="font-weight:600;margin-bottom:var(--space-2);display:block;">Cantidad de preguntas</label>
                    <div class="quiz-count-select" id="quiz-count-select">
                        ${[5, 8, 10].map(n => `
                            <button type="button" class="quiz-count-btn ${n === state.questionCount ? 'active' : ''}" data-count="${n}">${n}</button>
                        `).join('')}
                    </div>
                </div>

                <button type="button" class="btn btn-primary" id="quiz-generate-btn" style="align-self:flex-start;" ${isUnit && state.selectedClassIds.length === 0 ? 'disabled' : ''}>
                    Generar cuestionario
                </button>
            </div>
        </div>
        <p style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin:0;">
            ${isUnit
                ? 'Las preguntas se generan con IA a partir del resumen y los materiales de los temas elegidos de la unidad. Aprobás con 60% o más.'
                : 'Las preguntas se generan con IA a partir del resumen y los materiales de la clase. Aprobás con 60% o más.'}
        </p>
    `;

    mount.querySelector('#quiz-count-select').addEventListener('click', (e) => {
        const btn = e.target.closest('.quiz-count-btn');
        if (!btn) return;
        state.questionCount = Number(btn.dataset.count);
        mount.querySelectorAll('.quiz-count-btn').forEach(b => b.classList.toggle('active', b === btn));
    });

    // UJ-30 (paso 2): acotar el alcance antes de empezar. Destildar una clase la
    // saca del pedido; sin ninguna tildada no se genera (el panel lo avisa y el
    // servidor también rechaza el alcance vacío).
    if (isUnit) {
        const refreshScopeState = () => {
            const selected = state.selectedClassIds;
            const topics = (state.scopeData?.topics || []).filter((t) => selected.includes(t.classId));
            const summary = mount.querySelector('#quiz-scope-summary');
            if (summary) {
                summary.textContent = selected.length === scopeClasses.length
                    ? `Alcance: unidad completa (${topics.length} temas de ${scopeClasses.length} clases).`
                    : `Alcance acotado: ${topics.length} de ${(state.scopeData?.topics || []).length} temas (${selected.length} de ${scopeClasses.length} clases).`;
            }
            const warning = mount.querySelector('#quiz-scope-warning');
            if (warning) warning.style.display = selected.length === 0 ? '' : 'none';
            const generate = mount.querySelector('#quiz-generate-btn');
            if (generate) generate.disabled = selected.length === 0;
        };

        mount.querySelectorAll('.quiz-scope-class').forEach((input) => {
            input.addEventListener('change', () => {
                const id = input.dataset.classId;
                state.selectedClassIds = input.checked
                    ? Array.from(new Set([...state.selectedClassIds, id]))
                    : state.selectedClassIds.filter((x) => x !== id);
                input.closest('.quiz-scope-row')?.classList.toggle('off', !input.checked);
                refreshScopeState();
            });
        });

        mount.querySelectorAll('.quiz-priority-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const topic = btn.dataset.topic;
                const on = !state.priorityTopics.includes(topic);
                state.priorityTopics = on
                    ? [...state.priorityTopics, topic]
                    : state.priorityTopics.filter((t) => t !== topic);
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-pressed', String(on));
                btn.textContent = `${on ? '★' : '☆'} ${topic}`;
            });
        });
    }

    // UJ-30: reabrir la pestaña no tiene que borrar los fallos ni los temas
    // flojos. El último resultado guardado se puede volver a ver desde acá.
    mount.querySelector('#quiz-view-last-btn')?.addEventListener('click', () => {
        if (!latestResult) return;
        state.result = latestResult;
        renderResults(mount, opts);
    });

    mount.querySelector('#quiz-generate-btn').addEventListener('click', async () => {
        const btn = mount.querySelector('#quiz-generate-btn');
        if (isUnit && state.selectedClassIds.length === 0) {
            toast('warning', 'Elegí un tema', 'La práctica de la unidad necesita al menos un tema para generar preguntas.');
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Generando...';
        try {
            const quiz = await api.generateQuiz({
                subjectId,
                classId,
                questionCount: state.questionCount,
                className,
                scope,
                classIds: isUnit ? state.selectedClassIds : undefined,
                topics: isUnit ? state.priorityTopics : undefined,
            });
            state.questions = quiz.questions || [];
            state.answers = state.questions.map(() => null);
            state.currentIndex = 0;
            // El cuestionario quedó guardado en el servidor con sus respuestas
            // correctas; el intento se cierra contra ese registro.
            state.quizId = quiz.quizId || null;
            if (state.questions.length === 0) {
                throw new Error('El cuestionario llegó vacío. Intentá de nuevo.');
            }
            renderQuestion(mount, opts);
        } catch (err) {
            // #338: quiz failures always surface a toast (never silent); a
            // consent denial additionally offers the terms CTA.
            if (isConsentError(err)) {
                toast('error', 'Aceptá los términos', 'Debés aceptar los términos de uso antes de generar un cuestionario.');
                renderPrivacyModal(() => {
                    toast('success', 'Términos aceptados', 'Ya podés generar el cuestionario.');
                }, { force: true });
            } else {
                const { message, rateLimited } = jsonResponseError(err, 'No se pudo generar el cuestionario.');
                toast(rateLimited ? 'warning' : 'error', rateLimited ? 'Esperá un momento' : 'Error', message);
            }
            btn.disabled = false;
            btn.textContent = 'Generar cuestionario';
        }
    });
}

function renderQuestion(mount, opts = {}) {
    const { classId, subjectId, className, scope = 'class' } = opts;
    const total = state.questions.length;
    const idx = state.currentIndex;
    const q = state.questions[idx];
    const answered = state.answers.filter(a => a !== null).length;
    const progressPct = Math.round((answered / total) * 100);

    mount.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-2);">
            <span style="font-size:var(--font-size-sm);color:var(--color-text-secondary);">Pregunta <strong>${idx + 1}</strong> de ${total}</span>
            <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">${answered}/${total} respondidas</span>
        </div>
        <div class="quiz-progress-track" style="margin-bottom:var(--space-5);">
            <div class="quiz-progress-fill" style="width:${progressPct}%"></div>
        </div>

        <div class="card">
            <div style="padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-4);">
                ${q.topic ? `<span class="quiz-topic-chip" style="background:color-mix(in srgb, var(--color-primary) 12%, transparent);color:var(--color-primary-light);align-self:flex-start;">${escapeHtml(q.topic)}</span>` : ''}
                <h4 class="h5" style="margin:0;line-height:1.45;">${escapeHtml(q.question)}</h4>

                <div style="display:flex;flex-direction:column;gap:var(--space-2);" id="quiz-options">
                    ${q.options.map((opt, i) => `
                        <button type="button" class="quiz-option ${state.answers[idx] === i ? 'selected' : ''}" data-index="${i}">
                            <span class="option-letter">${OPTION_LETTERS[i] || i + 1}.</span>
                            <span>${escapeHtml(opt)}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-4);">
            <button type="button" class="btn btn-ghost" id="quiz-prev-btn" ${idx === 0 ? 'disabled' : ''}>← Anterior</button>
            ${idx < total - 1
                ? `<button type="button" class="btn btn-primary" id="quiz-next-btn" ${state.answers[idx] === null ? 'disabled' : ''}>Siguiente →</button>`
                : `<button type="button" class="btn btn-primary" id="quiz-submit-btn" ${state.answers.some(a => a === null) ? 'disabled' : ''}>Ver resultados ✓</button>`}
        </div>
    `;

    mount.querySelectorAll('#quiz-options .quiz-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const optIdx = Number(btn.dataset.index);
            state.answers[idx] = optIdx;
            mount.querySelectorAll('#quiz-options .quiz-option').forEach(b => b.classList.toggle('selected', Number(b.dataset.index) === optIdx));
            const next = mount.querySelector('#quiz-next-btn');
            const submit = mount.querySelector('#quiz-submit-btn');
            if (next) next.disabled = false;
            if (submit && !state.answers.some(a => a === null)) submit.disabled = false;
        });
    });

    mount.querySelector('#quiz-prev-btn')?.addEventListener('click', () => {
        if (state.currentIndex > 0) {
            state.currentIndex -= 1;
            renderQuestion(mount, opts);
        }
    });

    mount.querySelector('#quiz-next-btn')?.addEventListener('click', () => {
        if (state.currentIndex < total - 1) {
            state.currentIndex += 1;
            renderQuestion(mount, opts);
        }
    });

    mount.querySelector('#quiz-submit-btn')?.addEventListener('click', async () => {
        const submitBtn = mount.querySelector('#quiz-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Calculando...';
        try {
            // El cliente sólo declara qué opción eligió: la corrección, el
            // puntaje y los temas flojos los resuelve el servidor contra el
            // cuestionario que emitió (#UJ-30).
            const submittedAnswers = state.questions.map((q, i) => ({
                questionId: q.id,
                selectedIndex: state.answers[i],
            }));

            const saved = await api.saveQuizResult({
                subjectId,
                // En la unidad el intento no pertenece a una clase: el servidor lo
                // guarda bajo su propia clave y no toca el historial de ninguna.
                scope,
                classId: scope === 'unit' ? undefined : classId,
                quizId: state.quizId,
                answers: submittedAnswers,
            });

            state.result = {
                score: saved.score ?? 0,
                passed: saved.passed === true,
                correctCount: saved.correctCount ?? 0,
                totalQuestions: saved.totalQuestions ?? state.questions.length,
                weakTopics: Array.isArray(saved.weakTopics) ? saved.weakTopics : [],
                answers: Array.isArray(saved.answers) ? saved.answers : [],
            };
            renderResults(mount, opts);
        } catch (err) {
            // #442: si el guardado falla no hay resultado que mostrar. Antes se
            // llamaba a renderResults() con state.result en null y el TypeError
            // dejaba la práctica trabada en «Calculando...», sin reintento y con
            // las respuestas ya elegidas a la vista pero sin forma de reenviarlas.
            const { message } = jsonResponseError(err, 'No se pudieron guardar los resultados.');
            toast('error', 'No se pudo cerrar la práctica', `${message} Tus respuestas siguen ahí: probá de nuevo.`);
            const retryBtn = mount.querySelector('#quiz-submit-btn');
            if (retryBtn) {
                retryBtn.disabled = false;
                retryBtn.textContent = 'Ver resultados ✓';
            }
        }
    });
}

function renderResults(mount, opts = {}) {
    const { classId, subjectId, className, scope = 'class' } = opts;
    // UJ-30: con alcance de unidad el fallo trae la clase del material que lo
    // respalda; sin ella (práctica de clase) el destino es la clase del panel.
    const answerClassId = (a) => a?.classId || classId;
    const classLabel = scope === 'unit' ? 'la unidad' : 'esta clase';
    const r = state.result;
    const passed = r.passed;
    const color = passed ? 'var(--color-success)' : 'var(--color-warning)';
    const totalAnswered = r.answers.length;
    const comparison = buildTopicComparison(state.previousAttempt, r.answers);
    const VERDICT_COLOR = { avanzaste: 'var(--color-success)', retrocediste: 'var(--color-error)' };

    mount.innerHTML = `
        <div class="quiz-pass-banner quiz-celebrate" style="border:1px solid ${color};background:color-mix(in srgb, ${color} 10%, transparent);">
            <div style="font-size:2.2rem;margin-bottom:var(--space-2);">${passed ? '🎉' : '📚'}</div>
            <h3 class="h4" style="margin:0 0 var(--space-2) 0;color:${color};">${passed ? '¡Aprobado!' : 'A repasar'}</h3>
            <div class="quiz-score-badge" style="color:${color};">${r.score}%</div>
            <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-top:var(--space-2);">
                ${r.correctCount} de ${totalAnswered} correctas
            </div>
        </div>

        ${comparison.length > 0 ? `
            <div class="card" id="quiz-comparison" style="margin-top:var(--space-4)">
                <div style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3);">
                    <h5 style="margin:0;font-weight:700;">Comparación con tu práctica anterior</h5>
                    <p style="margin:0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                        Tu intento previo fue de ${state.previousAttempt.score}% (${state.previousAttempt.correctCount} de ${state.previousAttempt.totalQuestions}).
                    </p>
                    <div style="display:flex;flex-direction:column;gap:var(--space-2);">
                        ${comparison.map((c) => `
                            <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:var(--font-size-sm);">
                                <span>${escapeHtml(c.topic)}</span>
                                <span style="color:${VERDICT_COLOR[c.verdict] || 'var(--color-text-secondary)'};font-weight:600;">${c.verdict}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        ` : ''}

        ${r.weakTopics.length > 0 ? `
            <div class="card" id="quiz-weak-topics" style="margin-top:var(--space-4)">
                <div style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3);">
                    <h5 style="margin:0;font-weight:700;">${passed ? 'Temas a reforzar' : 'Temas recomendados para repasar'}</h5>
                    <p style="margin:0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">Marcá los temas que sentís flojos: quedan guardados como tuyos en ${classLabel}.</p>
                    <div style="display:flex;flex-direction:column;gap:var(--space-2);">
                        ${r.weakTopics.map(t => {
                            const marked = state.markedTopics.includes(t);
                            return `
                            <div class="quiz-topic-row" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;">
                                <button type="button" class="quiz-topic-chip quiz-topic-toggle" data-topic="${escapeHtml(t)}" role="button" aria-pressed="${marked}" title="Marcar o desmarcar este tema como flojo" style="border:1px solid ${marked ? 'var(--color-warning)' : 'var(--color-border)'};background:color-mix(in srgb, var(--color-warning) ${marked ? '20%' : '10%'}, transparent);color:var(--color-warning);cursor:pointer;font-family:var(--font-family);">${marked ? '★' : '☆'} ${escapeHtml(t)}</button>
                                <a class="quiz-topic-consult" href="${chatConsultHref(classId, consultQuestion(t, ''))}" style="font-size:var(--font-size-xs);font-weight:600;">Consultar este tema</a>
                            </div>
                            `;
                        }).join('')}
                    </div>
                    <p id="quiz-weak-topics-status" style="margin:0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">${state.markedTopics.length ? `Marcaste ${state.markedTopics.length} tema${state.markedTopics.length === 1 ? '' : 's'} flojo${state.markedTopics.length === 1 ? '' : 's'}.` : 'Todavía no marcaste ningún tema flojo.'}</p>
                </div>
            </div>
        ` : passed ? `
            <div class="card" style="margin-top:var(--space-4)">
                <div style="padding:var(--space-5);text-align:center;color:var(--color-text-secondary);font-size:var(--font-size-sm);">¡Perfecto! No se detectaron temas débiles en este intento.</div>
            </div>
        ` : ''}

        <h4 class="h5" style="margin:var(--space-6) 0 var(--space-3) 0;">Repaso de respuestas</h4>
        <div style="display:flex;flex-direction:column;gap:var(--space-3);" id="quiz-review-list">
            ${r.answers.map((a) => {
                const isCorrect = a.isCorrect;
                // UJ-30 (paso 6): cada fallo lleva al material que lo respalda. El
                // rótulo lo emitió el servidor a partir de los bloques de contexto
                // del cuestionario; sin él, se ofrece el encuentro de la clase.
                const sourceBlock = !isCorrect ? `
                    <div class="quiz-review-source" style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);margin-top:8px;border-top:1px dashed var(--color-border);padding-top:8px;">
                        <span style="color:var(--color-text-secondary);">📎 ${a.source ? `Se explica en <strong>${escapeHtml(a.source)}</strong>` : `Tema: <strong>${escapeHtml(a.topic || 'sin etiqueta')}</strong>`}</span>
                        ${answerClassId(a) ? `<a class="quiz-review-link" href="${classEncounterHref(answerClassId(a))}" style="font-weight:600;">Ver el encuentro</a>` : ''}
                        ${answerClassId(a) ? `<a class="quiz-review-link" href="${chatConsultHref(answerClassId(a), consultQuestion(a.topic, a.source))}" style="font-weight:600;">Consultar en el chat</a>` : ''}
                    </div>
                ` : '';
                return `
                <div class="quiz-review-item">
                    <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
                        <span style="flex-shrink:0;">${isCorrect ? '✅' : '❌'}</span>
                        <span style="font-weight:600;font-size:var(--font-size-sm);">${escapeHtml(a.question)}</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;font-size:var(--font-size-xs);margin-left:var(--space-5);">
                        ${a.options.map((opt, oi) => {
                            const cls = oi === a.correctIndex ? 'correct' : (oi === a.selectedIndex && !isCorrect ? 'incorrect' : '');
                            if (!cls) return '';
                            const label = oi === a.correctIndex ? '✓ Correcta' : '✗ Tu respuesta';
                            return `<div style="display:flex;gap:var(--space-2);color:${oi === a.correctIndex ? 'var(--color-success)' : 'var(--color-error)'};">${OPTION_LETTERS[oi] || oi + 1}. ${escapeHtml(opt)} <em>(${label})</em></div>`;
                        }).join('')}
                        ${a.explanation ? `<div style="color:var(--color-text-secondary);margin-top:6px;border-top:1px solid var(--color-border);padding-top:6px;">💡 ${escapeHtml(a.explanation)}</div>` : ''}
                        ${sourceBlock}
                    </div>
                </div>
                `;
            }).join('')}
        </div>

        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);">
            <button type="button" class="btn btn-primary" id="quiz-retry-btn">Volver a intentar</button>
        </div>
    `;

    mount.querySelector('#quiz-retry-btn').addEventListener('click', () => {
        renderAutoevaluacion(hostContainer, opts);
    });

    // UJ-30 (paso 7): marcar/desmarcar un tema flojo. La marca se persiste por
    // persona y unidad; el resultado no la deriva, la declara la persona.
    mount.querySelectorAll('.quiz-topic-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            const topic = btn.dataset.topic;
            const wasMarked = state.markedTopics.includes(topic);
            state.markedTopics = wasMarked
                ? state.markedTopics.filter(t => t !== topic)
                : [...state.markedTopics, topic];
            const nowMarked = !wasMarked;
            btn.setAttribute('aria-pressed', String(nowMarked));
            btn.textContent = `${nowMarked ? '★' : '☆'} ${topic}`;
            btn.style.borderColor = nowMarked ? 'var(--color-warning)' : 'var(--color-border)';
            const status = mount.querySelector('#quiz-weak-topics-status');
            if (status) {
                status.textContent = state.markedTopics.length
                    ? `Marcaste ${state.markedTopics.length} tema${state.markedTopics.length === 1 ? '' : 's'} flojo${state.markedTopics.length === 1 ? '' : 's'}.`
                    : 'Todavía no marcaste ningún tema flojo.';
            }
            try {
                const saved = await api.saveQuizWeakTopics({ subjectId, classId: scope === 'unit' ? undefined : classId, scope, topics: state.markedTopics });
                state.markedTopics = saved;
            } catch {
                // La marca sigue visible en pantalla aunque no se haya podido
                // guardar: se avisa sin bloquear la lectura del resultado.
                toast('warning', 'No se pudo guardar', 'La marca de temas flojos quedó sólo en esta pantalla.');
            }
        });
    });
}
