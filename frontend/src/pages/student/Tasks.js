/* ============================================================
   Student Tasks — Priority task list + grades
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

export async function renderStudentTasks(container) {
    renderHeader('Tareas & Notas');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando tareas...</div>`;

    const user = auth.getUser();
    const tasksData = await api.getTasks(user.id);
    const tasks = Array.isArray(tasksData) ? tasksData : [];

    // Sort logic: Score = (weight / 10) + (10 / (Math.max(1, daysUntil)))
    // Higher score = more prioritized
    const calculatePriority = (t) => {
        const daysUntil = Math.max(0, Math.ceil((new Date(t.dueDate) - new Date()) / 86400000));
        const proximity = 10 / (daysUntil + 1);
        const weightFactor = t.weight / 5;
        return proximity + weightFactor;
    };

    const pending = tasks
        .filter(t => t.status === 'pending')
        .sort((a, b) => calculatePriority(b) - calculatePriority(a));

    const completed = tasks
        .filter(t => t.status === 'completed')
        .sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));
    const totalWeight = completed.reduce((a, t) => a + t.weight, 0);
    const weightedAvg = completed.length > 0
        ? completed.reduce((a, t) => a + (t.grade || 0) * t.weight, 0) / totalWeight
        : null;

    container.innerHTML = `
    <!-- KPIs -->
    <div class="grid-3" style="margin-bottom:var(--space-8)">
      <div class="kpi-card">
        <div class="kpi-label">Tareas pendientes</div>
        <div class="kpi-value">${pending.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Completadas</div>
        <div class="kpi-value" style="color:var(--color-success)">${completed.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Promedio ponderado</div>
        <div class="kpi-value" style="color:var(--color-primary-light)">${weightedAvg !== null ? weightedAvg.toFixed(1) : '—'}</div>
      </div>
    </div>

    <!-- Pending -->
    <div class="section-title"><h2>⏳ Pendientes</h2><div class="line"></div></div>
    ${pending.length === 0 ? `<div class="card" style="margin-bottom:var(--space-5)"><div class="empty-state" style="padding:32px"><span class="empty-state-icon">🎉</span><p>¡No tenés tareas pendientes!</p></div></div>` : `
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
                <th>Prioridad</th>
                <th>Tarea</th>
                <th>Peso</th>
                <th>Vencimiento</th>
                <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${pending.map(t => {
        const daysUntil = Math.ceil((new Date(t.dueDate) - new Date()) / 86400000);
        const urgency = daysUntil <= 3 ? { label: '🔴 Alta', badge: 'badge-error' }
            : daysUntil <= 7 ? { label: '🟡 Media', badge: 'badge-warning' }
                : { label: '🔵 Normal', badge: 'badge-info' };
        
        // Final Exam weight check for priority boost color
        const weightLabel = t.weight >= 20 ? 'badge-primary' : 'badge-neutral';

        return `
                <tr>
                  <td><span class="badge ${urgency.badge}">${urgency.label}</span></td>
                  <td><strong>${t.title}</strong></td>
                  <td><span class="badge ${weightLabel}">${t.weight}%</span></td>
                  <td>${new Date(t.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</td>
                  <td><span class="badge badge-warning">⏳ Pendiente</span></td>
                </tr>
              `;
    }).join('')}
          </tbody>
        </table>
      </div>
    </div>`}

    <!-- Completed -->
    <div class="section-title"><h2>✅ Completadas</h2><div class="line"></div></div>
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tarea</th>
              <th>Peso</th>
              <th>Nota</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${completed.map(t => `
              <tr>
                <td>${t.title}</td>
                <td><span class="badge badge-neutral">${t.weight}%</span></td>
                <td><strong style="color:${(t.grade || 0) >= 6 ? 'var(--color-success)' : 'var(--color-error)'}">${t.grade !== null ? t.grade.toFixed(1) : '—'}</strong></td>
                <td><span class="badge badge-success">✅ Aprobado</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
