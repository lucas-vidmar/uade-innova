import { api } from '../../services/api.js';
import { renderHeader } from '../../components/Header.js';

export async function renderDirectorArchiveUsage(container) {
    await loadAndRender(container);
}

async function loadAndRender(container) {
    renderHeader('Archivo en Frío');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando datos de almacenamiento...</div>`;

    const subjFilter = document.getElementById('filter-subject')?.value || '';
    const semFilter = document.getElementById('filter-semester')?.value || '';

    // Fix #343: surface a 403 (role not granted) as an actionable card instead
    // of the silent empty state the old swallowed-null produced.
    let data = null;
    try {
        data = await api.getArchiveUsage(subjFilter || undefined, semFilter || undefined);
    } catch (err) {
        const denied = err?.status === 401 || err?.status === 403;
        container.innerHTML = `
        <div style="padding:var(--space-6);max-width:800px;margin:0 auto">
          <div class="card" style="max-width:560px;margin:var(--space-10) auto;text-align:center">
            <div class="empty-state-icon" aria-hidden="true">${denied ? '🔒' : '⚠️'}</div>
            <h2 class="h3">${denied ? 'Sin permisos para ver el archivo en frío' : 'No se pudo cargar el archivo en frío'}</h2>
            <p style="color:var(--color-text-secondary)">${denied ? 'Tu rol no tiene acceso a este recurso. Si creés que es un error, contactá a administración.' : 'Ocurrió un error al cargar los datos. Intentá nuevamente.'}</p>
            <button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar">Reintentar</button>
          </div>
        </div>`;
        return;
    }

    const totalBlobs = data?.totalArchiveBlobs ?? 0;
    const totalGB = data?.totalArchiveSizeGB ?? 0;
    const bySubject = data?.bySubject || [];
    const bySemester = data?.bySemester || [];
    const lastUpdated = data?.lastUpdatedAt || null;
    const dataSource = data?.dataSource || 'N/A';

    const allSubjects = [...new Set(bySubject.map(s => s.subjectId).filter(Boolean))];
    const allSemesters = [...new Set(bySemester.map(s => s.semester).filter(Boolean))];

    container.innerHTML = `
    <div style="padding:var(--space-6);max-width:1400px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-6)">
        <div>
          <h2 style="margin:0;color:var(--color-text-primary);font-size:1.5rem">Archivo en Frío — Azure Archive Tier</h2>
          <p style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:0.875rem">
            Blobs almacenados en Archive tier por materia y semestre
            ${lastUpdated ? `· Actualizado: ${new Date(lastUpdated).toLocaleString()}` : ''}
          </p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center">
          <select id="filter-subject" style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-surface-1);color:var(--color-text-primary);font-size:0.875rem">
            <option value="">Todas las materias</option>
            ${allSubjects.map(id => `
              <option value="${id}"${id === subjFilter ? ' selected' : ''}>${id}</option>
            `).join('')}
          </select>
          <select id="filter-semester" style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-surface-1);color:var(--color-text-primary);font-size:0.875rem">
            <option value="">Todos los semestres</option>
            ${allSemesters.map(sem => `
              <option value="${sem}"${sem === semFilter ? ' selected' : ''}>${sem.replaceAll('semester-', '')}</option>
            `).join('')}
          </select>
        </div>
      </div>

      <!-- KPI cards -->
      <div class="grid-2" style="margin-bottom:var(--space-8)">
        <div class="kpi-card">
          <div class="kpi-label">Blobs en Archive</div>
          <div class="kpi-value">${totalBlobs.toLocaleString()}</div>
          <span class="kpi-delta" style="color:var(--color-text-secondary);font-size:0.75rem">Total de bloques archivados</span>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Espacio total (GB)</div>
          <div class="kpi-value">${totalGB.toFixed(2)}</div>
          <span class="kpi-delta" style="color:var(--color-text-secondary);font-size:0.75rem">Gigabytes en tier Archive</span>
        </div>
      </div>

      ${bySubject.length > 0 ? `
      <div class="card" style="margin-bottom:var(--space-8)">
        <div class="card-header">
          <span class="card-title">${icon('chart')} GB archivados por Materia</span>
          <span class="badge badge-info">${bySubject.length} materias</span>
        </div>
        <div style="position:relative">
          <canvas id="archive-subject-bar-chart" style="width:100%;height:300px;display:block"></canvas>
        </div>
      </div>
      ` : `
      <div class="card" style="margin-bottom:var(--space-8)">
        <div class="empty-state" style="padding:40px;text-align:center;color:var(--color-text-secondary)">
          Sin datos de archivo en frío. No hay blobs en Archive tier.
        </div>
      </div>
      `}

      ${bySemester.length > 0 ? `
      <div class="card" style="margin-bottom:var(--space-8)">
        <div class="card-header">
          <span class="card-title">${icon('database')} Desglose por Semestre</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Semestre</th>
                <th>Blobs</th>
                <th>Tamaño (GB)</th>
              </tr>
            </thead>
            <tbody>
              ${bySemester.map(s => `
                <tr>
                  <td><strong>${s.semester.replaceAll('semester-', '')}</strong></td>
                  <td>${s.blobCount.toLocaleString()}</td>
                  <td>${s.sizeGB.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}

      <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--color-surface-1);border-radius:var(--radius-md);border:1px solid var(--color-border)">
        <p style="margin:0;color:var(--color-text-secondary);font-size:0.8125rem">
          <strong>Fuente de datos:</strong> ${dataSource}
        </p>
      </div>
    </div>
  `;

    if (bySubject.length > 0) {
        renderSubjectBarChart(bySubject);
    }

    document.getElementById('filter-subject')?.addEventListener('change', () => loadAndRender(container));
    document.getElementById('filter-semester')?.addEventListener('change', () => loadAndRender(container));
}

const CHART_COLORS = ['#0077AB', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#38bdf8', '#ec4899'];

function renderSubjectBarChart(bySubject) {
    const canvas = document.getElementById('archive-subject-bar-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement?.getBoundingClientRect();
    const width = rect?.width || 600;
    if (width <= 0) return;
    canvas.width = width * dpr;
    canvas.height = 300 * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = '300px';
    ctx.scale(dpr, dpr);
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    const data = bySubject;
    const maxVal = Math.max(...data.map(d => d.sizeGB), 0.001);

    ctx.clearRect(0, 0, W, H);
    const padL = 80, padR = 20, padT = 20, padB = 40;
    const barGap = data.length > 10 ? 6 : data.length > 5 ? 10 : 16;
    const barW = Math.max(8, ((W - padL - padR - (data.length - 1) * barGap) / data.length));

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padT + ((H - padT - padB) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText((maxVal * (1 - i / 4)).toFixed(1) + ' GB', padL - 8, y + 4);
    }

    data.forEach((d, i) => {
        const x = padL + i * (barW + barGap);
        const barH = (d.sizeGB / maxVal) * (H - padT - padB);
        const color = CHART_COLORS[i % CHART_COLORS.length];

        ctx.fillStyle = color;
        ctx.fillRect(x, H - padB - barH, barW, barH);

        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.sizeGB.toFixed(2), x + barW / 2, H - padB - barH - 4);

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px monospace';
        const name = d.subjectId?.length > 16 ? d.subjectId?.slice(0, 14) + '...' : d.subjectId || 'unknown';
        ctx.save();
        ctx.translate(x + barW / 2, H - 6);
        ctx.rotate(-0.4);
        ctx.fillText(name, 0, 0);
        ctx.restore();
    });
}

function icon(name) {
    const icons = {
        chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="6"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="5" width="3" height="11"/></svg>',
        database: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
    };
    return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.chart}</span>`;
}
