/* ============================================================
   GroupPractice.js — Práctica compartida del grupo (#445 / UJ-32)

   La práctica individual no cambia: cada persona sigue generando y respondiendo
   la suya. Esta página es la capa de grupo:
   - el grupo es el que la materia ya declara (matrículas activas);
   - la práctica se abre una vez para ese grupo, así todas responden el mismo
     conjunto y el mismo alcance;
   - cada una responde por separado y recién después ve la comparación;
   - juntas asientan un resultado común y los temas que no pudieron acordar,
     para llevarlos a quien enseña (UJ-28).
   ============================================================ */
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const GROUP_STYLE = `
<style>
.gp-bars { display:flex; flex-direction:column; gap:6px; margin-top:var(--space-2); }
.gp-bar-row { display:grid; grid-template-columns:20px 1fr 52px; gap:var(--space-2); align-items:center; font-size:var(--font-size-xs); }
.gp-bar-track { height:10px; border-radius:var(--radius-full); background:var(--color-surface-2); overflow:hidden; }
.gp-bar-fill { height:100%; border-radius:var(--radius-full); background:var(--color-primary); }
.gp-bar-fill.mine { background:var(--color-primary-light); }
.gp-bar-fill.correct { background:var(--color-success); }
.gp-question { padding:var(--space-4); border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-surface); }
.gp-verdict { font-size:var(--font-size-xs); font-weight:700; padding:2px 10px; border-radius:var(--radius-full); }
.gp-verdict.agree { background:color-mix(in srgb, var(--color-success) 16%, transparent); color:var(--color-success); }
.gp-verdict.disagree { background:color-mix(in srgb, var(--color-warning) 18%, transparent); color:var(--color-warning); }
.gp-verdict.pending { background:color-mix(in srgb, var(--color-text-secondary) 14%, transparent); color:var(--color-text-secondary); }
.gp-option { display:flex; align-items:center; gap:var(--space-3); padding:var(--space-3) var(--space-4); border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-surface); cursor:pointer; font-size:var(--font-size-sm); }
.gp-option.selected { border-color:var(--color-primary); background:color-mix(in srgb, var(--color-primary) 12%, transparent); }
.gp-topic-chip { display:inline-block; padding:4px 12px; border-radius:var(--radius-full); font-size:var(--font-size-xs); font-weight:600; background:color-mix(in srgb, var(--color-warning) 16%, transparent); color:var(--color-warning); text-decoration:none; }
</style>`;

let state = null;

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function scopeQuery() {
    return state.scope === 'unit'
        ? { subjectId: state.subjectId, scope: 'unit' }
        : { subjectId: state.subjectId, scope: 'class', classId: state.classId };
}

function consultHref(topic) {
    if (!state.classId) return null;
    const params = new URLSearchParams({
        classId: state.classId,
        preset: `Quiero repasar "${topic}". ¿Me lo explicás con el material de la clase?`,
    });
    return `#/student/chat?${params.toString()}`;
}

export async function renderStudentGroupPractice(container) {
    const user = auth.getUser();
    const subjectId = auth.getActiveSubjectId();
    const subjectName = user?.subjects?.find((s) => s.id === subjectId)?.name || 'la materia';

    renderHeader('Práctica del grupo');

    if (!subjectId) {
        container.innerHTML = '<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>';
        return;
    }

    state = {
        subjectId,
        subjectName,
        scope: 'unit',
        classId: null,
        classes: [],
        practice: null,
        myResponse: null,
        record: null,
        group: null,
        questions: [],
        answers: [],
        comparison: null,
        busy: false,
    };

    container.innerHTML = GROUP_STYLE + `
        <div class="student-group-practice" style="max-width:960px;margin:0 auto;padding:var(--space-6);">
            <header style="margin-bottom:var(--space-5);">
                <h2 class="h3" style="margin:0 0 var(--space-2) 0;">Práctica del grupo</h2>
                <p style="margin:0;color:var(--color-text-secondary);font-size:var(--font-size-sm);">
                    Una práctica compartida de <strong>${escapeHtml(subjectName)}</strong>: el mismo conjunto para todo
                    el grupo, cada persona responde por separado y después ven juntas en qué coincidieron y en qué no.
                    La práctica individual de cada clase y de la unidad sigue donde siempre.
                </p>
            </header>
            <div id="group-practice-mount"></div>
        </div>
    `;

    const mount = container.querySelector('#group-practice-mount');

    // El anuncio del alcance sale del servidor: qué clases están publicadas y con
    // qué temas. Sin él la práctica del grupo sería «de algo» sin decirlo.
    try {
        const scopeData = await api.getQuizScope(subjectId);
        state.classes = Array.isArray(scopeData?.classes) ? scopeData.classes : [];
    } catch {
        state.classes = [];
    }
    if (state.classes.length === 0 && state.scope === 'unit') {
        // Sin clases publicadas la unidad no tiene temas: se avisa en el estado.
        state.classes = [];
    }

    await loadState(mount);
}

async function loadState(mount) {
    mount.innerHTML = '<div class="card"><div style="padding:var(--space-6);color:var(--color-text-secondary);font-size:var(--font-size-sm);">Cargando la práctica del grupo...</div></div>';
    try {
        const data = await api.getGroupQuiz(scopeQuery());
        state.group = data.group;
        state.practice = data.practice || null;
        state.myResponse = data.myResponse || null;
        state.record = data.record || null;
        state.comparison = null;
    } catch (err) {
        renderError(mount, err);
        return;
    }
    renderEstado(mount);
}

function renderError(mount, err) {
    const message = err?.message || 'No pudimos cargar la práctica del grupo.';
    mount.innerHTML = `
        <div class="card">
            <div style="padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-3);">
                <strong>La práctica del grupo no está disponible</strong>
                <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-secondary);">${escapeHtml(message)}</p>
                <button type="button" class="btn btn-ghost" id="gp-retry" style="align-self:flex-start;">Reintentar</button>
            </div>
        </div>
    `;
    mount.querySelector('#gp-retry')?.addEventListener('click', () => loadState(mount));
}

function scopeSelectorHtml() {
    const options = [
        `<option value="unit" ${state.scope === 'unit' ? 'selected' : ''}>La unidad completa (${state.classes.length} clase${state.classes.length === 1 ? '' : 's'} publicada${state.classes.length === 1 ? '' : 's'})</option>`,
        ...state.classes.map((c) => `<option value="${escapeHtml(c.classId)}" ${state.classId === c.classId ? 'selected' : ''}>${escapeHtml(c.title)}</option>`),
    ];
    return `
        <label class="form-label" style="font-weight:600;display:block;margin-bottom:var(--space-2);">Qué practica el grupo</label>
        <select id="gp-scope-select" class="form-input" style="max-width:420px;">
            ${options.join('')}
        </select>
    `;
}

function renderEstado(mount) {
    const group = state.group || { memberCount: 0 };
    const practice = state.practice;
    const mine = state.myResponse;
    const answeredCount = practice?.answeredCount || 0;

    mount.innerHTML = `
        <div class="card" style="margin-bottom:var(--space-4);">
            <div style="padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-5);">
                <div style="display:flex;align-items:center;gap:var(--space-3);">
                    <div style="width:48px;height:48px;border-radius:var(--radius-lg);background:color-mix(in srgb, var(--color-primary) 15%, transparent);display:flex;align-items:center;justify-content:center;font-size:1.5rem;">👥</div>
                    <div>
                        <h4 style="margin:0;font-weight:700;">Práctica compartida</h4>
                        <p style="margin:var(--space-1) 0 0 0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                            El grupo son las <strong>${group.memberCount}</strong> personas con matrícula activa en la materia.
                            No se elige a mano: sale de la matrícula que la materia ya declara.
                        </p>
                    </div>
                </div>

                ${scopeSelectorHtml()}

                ${!practice ? `
                    <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                        Todavía no hay una práctica abierta para este alcance. Al abrirla se genera <strong>una sola vez</strong>
                        para todo el grupo: después cada persona entra a esta misma práctica, con las mismas preguntas.
                    </p>
                    <button type="button" class="btn btn-primary" id="gp-open-btn" style="align-self:flex-start;">Abrir la práctica del grupo</button>
                ` : `
                    <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);background:var(--color-surface-2);">
                        <strong style="font-size:var(--font-size-sm);">Práctica abierta del grupo</strong>
                        <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                            ${practice.questionCount} preguntas · respondieron <strong>${answeredCount}</strong> de ${practice.memberCount} personas
                            ${practice.expiresAt ? ` · abierta hasta el ${escapeHtml(new Date(practice.expiresAt).toLocaleDateString('es-AR'))}` : ''}
                        </span>
                    </div>
                    ${mine ? `
                        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:center;font-size:var(--font-size-sm);">
                            <span>Tu respuesta: <strong>${mine.score}%</strong> (${mine.correctCount} de ${mine.totalQuestions})</span>
                            <button type="button" class="btn btn-primary" id="gp-compare-btn">Ver la comparación del grupo</button>
                        </div>
                    ` : `
                        <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                            Ya hay una práctica abierta: es la misma que están respondiendo las demás.
                            La comparación se abre cuando respondas la tuya.
                        </p>
                        <button type="button" class="btn btn-primary" id="gp-answer-btn" style="align-self:flex-start;">Responder mi práctica</button>
                    `}
                `}

                ${state.record ? `
                    <div id="gp-record-summary" style="border:1px solid var(--color-success);border-radius:var(--radius-md);padding:var(--space-4);background:color-mix(in srgb, var(--color-success) 8%, transparent);font-size:var(--font-size-sm);">
                        <strong>Resultado común asentado</strong> (revisión ${state.record.revision}, con ${state.record.respondedCount} de ${state.record.memberCount} respuestas).
                        ${state.record.consultTopics?.length
                            ? `Quedaron ${state.record.consultTopics.length} tema${state.record.consultTopics.length === 1 ? '' : 's'} sin acordar para llevar a quien enseña.`
                            : 'El grupo coincidió en todas las preguntas comparadas.'}
                    </div>
                ` : ''}
            </div>
        </div>
        <p style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin:0;">
            Cada persona responde una sola vez y ve las respuestas de las demás sólo después de responder la suya.
        </p>
    `;

    mount.querySelector('#gp-scope-select')?.addEventListener('change', async (event) => {
        const value = event.target.value;
        if (value === 'unit') {
            state.scope = 'unit';
            state.classId = null;
        } else {
            state.scope = 'class';
            state.classId = value;
        }
        await loadState(mount);
    });

    mount.querySelector('#gp-open-btn')?.addEventListener('click', () => openPractice(mount));
    mount.querySelector('#gp-answer-btn')?.addEventListener('click', () => openPractice(mount));
    mount.querySelector('#gp-compare-btn')?.addEventListener('click', () => loadComparison(mount));
}

async function openPractice(mount) {
    if (state.busy) return;
    state.busy = true;
    const button = mount.querySelector('#gp-open-btn, #gp-answer-btn');
    if (button) {
        button.disabled = true;
        button.textContent = state.practice ? 'Abriendo...' : 'Generando la práctica del grupo...';
    }
    try {
        const quiz = await api.createGroupQuiz({
            ...scopeQuery(),
            subjectName: state.subjectName,
            unitName: state.scope === 'unit' ? state.subjectName : undefined,
            classIds: state.scope === 'unit' && state.classes.length ? state.classes.map((c) => c.classId) : undefined,
        });
        state.questions = Array.isArray(quiz.questions) ? quiz.questions : [];
        state.answers = state.questions.map(() => null);
        if (state.questions.length === 0) throw new Error('La práctica llegó vacía. Probá de nuevo.');
        // La práctica con la que se sigue (responder, comparar) es ésta: sin
        // fijarla acá, la respuesta no tendría a qué práctica pertenecer.
        state.practice = {
            groupQuizId: quiz.groupQuizId,
            scope: quiz.scope,
            classId: quiz.classId,
            questionCount: quiz.questionCount ?? state.questions.length,
            memberCount: quiz.memberCount,
            answeredCount: quiz.answeredCount || 0,
            createdAt: quiz.createdAt,
            expiresAt: quiz.expiresAt,
        };
        if (quiz.reused) {
            toast('success', 'Es la práctica del grupo', 'Abrimos la misma que están respondiendo las demás: mismas preguntas, mismo alcance.');
        }
        renderPreguntas(mount);
    } catch (err) {
        toast('error', 'No se pudo abrir la práctica', err?.message || 'Probá de nuevo en un momento.');
        if (button) {
            button.disabled = false;
            button.textContent = state.practice ? 'Responder mi práctica' : 'Abrir la práctica del grupo';
        }
    } finally {
        state.busy = false;
    }
}

function renderPreguntas(mount) {
    const total = state.questions.length;
    mount.innerHTML = `
        <div class="card" style="margin-bottom:var(--space-4);">
            <div style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-2);">
                <strong style="font-size:var(--font-size-sm);">Tu respuesta a la práctica del grupo</strong>
                <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                    ${total} preguntas compartidas. Respondés una sola vez: la comparación se arma con esta respuesta.
                </span>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
            ${state.questions.map((q, i) => `
                <div class="gp-question" data-question-index="${i}">
                    <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);flex-wrap:wrap;">
                        <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">Pregunta ${i + 1} de ${total}</span>
                        ${q.topic ? `<span class="gp-topic-chip" style="background:color-mix(in srgb, var(--color-primary) 12%, transparent);color:var(--color-primary-light);">${escapeHtml(q.topic)}</span>` : ''}
                    </div>
                    <p style="font-weight:600;font-size:var(--font-size-sm);margin:0 0 var(--space-3) 0;">${escapeHtml(q.question)}</p>
                    <div style="display:flex;flex-direction:column;gap:var(--space-2);">
                        ${(q.options || []).map((option, oi) => `
                            <button type="button" class="gp-option" data-index="${oi}" data-question="${i}">
                                <span style="font-weight:700;color:var(--color-text-secondary);">${OPTION_LETTERS[oi] || oi + 1}.</span>
                                <span>${escapeHtml(option)}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);">
            <button type="button" class="btn btn-primary" id="gp-submit-btn" disabled>Cerrar mi respuesta</button>
            <button type="button" class="btn btn-ghost" id="gp-cancel-btn">Volver</button>
        </div>
    `;

    const submit = mount.querySelector('#gp-submit-btn');
    const refresh = () => {
        const answered = state.answers.filter((a) => a !== null).length;
        submit.disabled = answered < total;
        submit.textContent = answered < total
            ? `Cerrar mi respuesta (${answered}/${total})`
            : 'Cerrar mi respuesta';
    };

    mount.querySelectorAll('.gp-option').forEach((button) => {
        button.addEventListener('click', () => {
            const qi = Number(button.dataset.question);
            const oi = Number(button.dataset.index);
            state.answers[qi] = oi;
            const card = button.closest('.gp-question');
            card?.querySelectorAll('.gp-option').forEach((b) => {
                b.classList.toggle('selected', Number(b.dataset.index) === oi);
            });
            refresh();
        });
    });

    mount.querySelector('#gp-cancel-btn')?.addEventListener('click', () => loadState(mount));

    submit?.addEventListener('click', async () => {
        submit.disabled = true;
        submit.textContent = 'Enviando...';
        try {
            const saved = await api.saveGroupQuizResponse({
                subjectId: state.subjectId,
                groupQuizId: state.practice.groupQuizId,
                answers: state.questions.map((q, i) => ({ questionId: q.id, selectedIndex: state.answers[i] })),
            });
            state.myResponse = {
                score: saved.score,
                correctCount: saved.correctCount,
                totalQuestions: saved.totalQuestions,
                passed: saved.passed,
            };
            state.practice = { ...state.practice, answeredCount: saved.answeredCount ?? (state.practice.answeredCount + 1) };
            renderMiResultado(mount, saved);
        } catch (err) {
            toast('error', 'No se pudo cerrar tu respuesta', err?.message || 'Tus respuestas siguen acá: probá de nuevo.');
            submit.disabled = false;
            refresh();
        }
    });

    refresh();
}

function renderMiResultado(mount, saved) {
    mount.innerHTML = `
        <div class="card" style="margin-bottom:var(--space-4);">
            <div style="padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-3);">
                <h4 style="margin:0;font-weight:700;">Tu respuesta quedó registrada</h4>
                <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                    ${saved.score}% · ${saved.correctCount} de ${saved.totalQuestions} correctas.
                    Ya podés ver la comparación del grupo.
                </p>
                <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">
                    <button type="button" class="btn btn-primary" id="gp-compare-btn">Ver la comparación del grupo</button>
                    <button type="button" class="btn btn-ghost" id="gp-back-btn">Volver</button>
                </div>
            </div>
        </div>
    `;
    mount.querySelector('#gp-compare-btn')?.addEventListener('click', () => loadComparison(mount));
    mount.querySelector('#gp-back-btn')?.addEventListener('click', () => loadState(mount));
}

async function loadComparison(mount) {
    mount.innerHTML = '<div class="card"><div style="padding:var(--space-6);color:var(--color-text-secondary);font-size:var(--font-size-sm);">Armando la comparación del grupo...</div></div>';
    try {
        const comparison = await api.getGroupQuizComparison({
            subjectId: state.subjectId,
            groupQuizId: state.practice.groupQuizId,
        });
        state.comparison = comparison;
        state.record = comparison.record || state.record;
    } catch (err) {
        renderError(mount, err);
        return;
    }
    renderComparison(mount);
}

function distributionHtml(question) {
    const total = question.distribution.reduce((sum, count) => sum + count, 0) || 1;
    return `
        <div class="gp-bars">
            ${question.distribution.map((count, index) => {
                const pct = Math.round((count / total) * 100);
                const classes = ['gp-bar-fill'];
                if (index === question.correctIndex) classes.push('correct');
                else if (index === question.myAnswerIndex) classes.push('mine');
                return `
                    <div class="gp-bar-row">
                        <span style="font-weight:700;color:var(--color-text-secondary);">${OPTION_LETTERS[index] || index + 1}</span>
                        <div>
                            <div style="margin-bottom:2px;color:var(--color-text-primary);">${escapeHtml(question.options[index])}${index === question.correctIndex ? ' <em style="color:var(--color-success);">(correcta)</em>' : ''}${index === question.myAnswerIndex ? ' <em>(tu respuesta)</em>' : ''}</div>
                            <div class="gp-bar-track"><div class="${classes.join(' ')}" style="width:${pct}%"></div></div>
                        </div>
                        <span style="text-align:right;color:var(--color-text-secondary);">${count} ${count === 1 ? 'voto' : 'votos'}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderComparison(mount) {
    const comparison = state.comparison;
    const common = comparison.commonResult;
    const questions = comparison.questions || [];
    const consultTopics = comparison.consultTopics || [];
    const consensusWrong = comparison.coincidieronEnIncorrecta || [];

    mount.innerHTML = `
        <div class="card" style="margin-bottom:var(--space-4);">
            <div style="padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-3);">
                <h4 style="margin:0;font-weight:700;">Comparación del grupo</h4>
                <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                    Respondieron <strong>${common.answeredCount}</strong> de ${common.memberCount} personas.
                    ${common.comparedCount > 0
                        ? `Coincidieron en <strong>${common.agreedCount}</strong> de ${common.comparedCount} preguntas comparadas${common.disagreedCount > 0 ? ` y no coincidieron en <strong>${common.disagreedCount}</strong>` : ''}.`
                        : 'Todavía no hay dos respuestas sobre la misma pregunta: la comparación empieza cuando responda otra persona del grupo.'}
                    ${common.pendingCount > 0 ? ` Falta${common.pendingCount === 1 ? '' : 'n'} ${common.pendingCount} respuesta${common.pendingCount === 1 ? '' : 's'} del grupo.` : ''}
                </p>
                ${common.consensusWrongCount > 0 ? `
                    <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-warning);">
                        En ${common.consensusWrongCount} pregunta${common.consensusWrongCount === 1 ? '' : 's'} el grupo coincidió en una respuesta incorrecta: coincidir no es acertar.
                    </p>
                ` : ''}
            </div>
        </div>

        <h4 class="h5" style="margin:var(--space-4) 0 var(--space-3) 0;">Pregunta por pregunta</h4>
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
            ${questions.map((q, i) => {
                const verdict = q.answeredCount < 2
                    ? { css: 'pending', text: 'Sin comparación todavía' }
                    : (q.agreed ? { css: 'agree', text: 'Coincidieron' } : { css: 'disagree', text: 'No coincidieron' });
                return `
                    <div class="gp-question">
                        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);flex-wrap:wrap;justify-content:space-between;">
                            <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">Pregunta ${i + 1}</span>
                            <span class="gp-verdict ${verdict.css}">${verdict.text}</span>
                        </div>
                        <p style="font-weight:600;font-size:var(--font-size-sm);margin:0 0 var(--space-2) 0;">${escapeHtml(q.question)}</p>
                        ${q.topic ? `<span class="gp-topic-chip" style="background:color-mix(in srgb, var(--color-primary) 12%, transparent);color:var(--color-primary-light);margin-bottom:var(--space-2);display:inline-block;">${escapeHtml(q.topic)}</span>` : ''}
                        ${distributionHtml(q)}
                        <p style="margin:var(--space-2) 0 0 0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                            ${q.agreed
                                ? `La respuesta del grupo fue ${OPTION_LETTERS[q.commonAnswerIndex] || q.commonAnswerIndex + 1}: ${escapeHtml(q.options[q.commonAnswerIndex])}${q.commonAnswerIndex === q.correctIndex ? ' — correcta.' : ' — incorrecta.'}`
                                : `Vos elegiste ${q.myAnswerIndex === null ? 'nada' : `${OPTION_LETTERS[q.myAnswerIndex] || q.myAnswerIndex + 1}`}${q.myCorrect ? ' (correcta)' : ''}.`}
                        </p>
                    </div>
                `;
            }).join('')}
        </div>

        <div class="card" style="margin-top:var(--space-5);">
            <div style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3);">
                <h5 style="margin:0;font-weight:700;">Temas que el grupo no pudo acordar</h5>
                ${consultTopics.length ? `
                    <p style="margin:0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                        De acá salen los temas para llevar a quien enseña. No los resolvemos por ustedes: quedan asentados como pendientes.
                    </p>
                    <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
                        ${consultTopics.map((t) => {
                            const href = consultHref(t.topic);
                            const label = `${escapeHtml(t.topic)} (${t.questionCount} pregunta${t.questionCount === 1 ? '' : 's'})`;
                            return href
                                ? `<a class="gp-topic-chip" href="${href}">★ ${label}</a>`
                                : `<span class="gp-topic-chip">★ ${label}</span>`;
                        }).join('')}
                    </div>
                ` : `
                    <p style="margin:0;font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                        Por ahora no hay temas en desacuerdo entre las respuestas recibidas.
                    </p>
                `}
                ${consensusWrong.length ? `
                    <div style="border-top:1px solid var(--color-border);padding-top:var(--space-3);">
                        <strong style="font-size:var(--font-size-sm);color:var(--color-warning);">Coincidieron pero en una respuesta incorrecta</strong>
                        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-2);">
                            ${consensusWrong.map((q) => {
                                const href = consultHref(q.topic);
                                const label = escapeHtml(q.topic);
                                return href
                                    ? `<a class="gp-topic-chip" href="${href}">★ ${label}</a>`
                                    : `<span class="gp-topic-chip">★ ${label}</span>`;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}

                <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center;">
                    <button type="button" class="btn btn-primary" id="gp-record-btn">Asentar el resultado común</button>
                    <button type="button" class="btn btn-ghost" id="gp-back-btn">Volver</button>
                </div>
                ${comparison.record ? `
                    <p style="margin:0;font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                        Resultado común asentado en la revisión ${comparison.record.revision}
                        (${comparison.record.respondedCount} de ${comparison.record.memberCount} respuestas), el ${escapeHtml(new Date(comparison.record.recordedAt).toLocaleString('es-AR'))}.
                    </p>
                ` : ''}
            </div>
        </div>
    `;

    mount.querySelector('#gp-back-btn')?.addEventListener('click', () => loadState(mount));
    mount.querySelector('#gp-record-btn')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Asentando...';
        try {
            const saved = await api.saveGroupQuizRecord({
                subjectId: state.subjectId,
                groupQuizId: state.practice.groupQuizId,
            });
            state.record = {
                revision: saved.record.revision,
                respondedCount: saved.record.respondedCount,
                memberCount: saved.record.memberCount,
                consultTopics: saved.record.consultTopics,
                recordedAt: saved.record.recordedAt,
            };
            toast('success', 'Resultado común asentado', `Revisión ${saved.record.revision}: quedó registrado con ${saved.record.consultTopics.length} tema${saved.record.consultTopics.length === 1 ? '' : 's'} para consultar.`);
            renderComparison(mount);
        } catch (err) {
            toast('error', 'No se pudo asentar', err?.message || 'Probá de nuevo.');
            button.disabled = false;
            button.textContent = 'Asentar el resultado común';
        }
    });
}
