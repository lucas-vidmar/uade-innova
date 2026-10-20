import { api } from '../../services/api.js';
import { renderHeader } from '../../components/Header.js';
import { dataInventoryHtml, responsableHtml } from '../../components/DataInventory.js';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function renderDirectorCompliance(container) {
  renderHeader('Cumplimiento Normativo');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando pol&iacute;ticas de retenci&oacute;n...</div>`;

  const [policy, inventory] = await Promise.all([
    api.getRetentionPolicy(),
    Promise.resolve(api.getDataInventory()).catch(() => null),
  ]);

  const isConfigured = policy?.configured !== false;
  // #537: guardar la política no la pone en vigor; hace falta que la API
  // informe quién la aprueba. Hasta entonces los plazos están "pendientes".
  const isEffective = policy?.effective === true;

  container.innerHTML = `
    <div style="padding:var(--space-6);max-width:1400px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-6)">
        <div>
          <h2 style="margin:0;color:var(--color-text-primary);font-size:1.5rem">Evidencia de Cumplimiento Normativo</h2>
          <p style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:0.875rem">
            Pol&iacute;ticas de retenci&oacute;n y disposici&oacute;n de datos — &uacute;ltima evaluaci&oacute;n: ${policy?.evaluatedAt ? new Date(policy.evaluatedAt).toLocaleString() : 'N/A'}
            ${!isConfigured ? '<span class="badge badge-warning" style="margin-left:var(--space-2)">No configurado</span>' : ''}
            ${isConfigured && !isEffective ? '<span class="badge badge-warning" style="margin-left:var(--space-2)">Pendiente de aprobación</span>' : ''}
          </p>
          <div id="compliance-responsable" style="margin-top:var(--space-1)">${responsableHtml(inventory)}</div>
        </div>
        <div style="display:flex;gap:var(--space-3)">
          <button class="btn btn-secondary" id="btn-export-csv" style="display:inline-flex;align-items:center;gap:var(--space-2)">
            <span>&#x2193;</span> Exportar CSV
          </button>
          <button class="btn btn-secondary" id="btn-export-json" style="display:inline-flex;align-items:center;gap:var(--space-2)">
            <span>&#x2193;</span> Exportar JSON
          </button>
        </div>
      </div>

      ${!isConfigured ? `
      <div style="margin-bottom:var(--space-4);padding:var(--space-4);background:var(--color-warning-bg, #fffbeb);border-radius:var(--radius-md);border:1px solid var(--color-warning, #d97706);color:var(--color-warning, #d97706)">
        <strong>Pol&iacute;tica no configurada.</strong> ${policy?.note || 'Aplican valores por defecto de Azure Storage.'}
      </div>
      ` : ''}

      <div style="background:var(--color-surface-1);border-radius:var(--radius-md);border:1px solid var(--color-border);overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid var(--color-border)">
              <th style="padding:var(--space-3) var(--space-4);text-align:left;color:var(--color-text-secondary);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Regla</th>
              <th style="padding:var(--space-3) var(--space-4);text-align:left;color:var(--color-text-secondary);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Estado</th>
              <th style="padding:var(--space-3) var(--space-4);text-align:left;color:var(--color-text-secondary);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Acci&oacute;n</th>
              <th style="padding:var(--space-3) var(--space-4);text-align:left;color:var(--color-text-secondary);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Retenci&oacute;n (d&iacute;as)</th>
              <th style="padding:var(--space-3) var(--space-4);text-align:left;color:var(--color-text-secondary);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Prefijos</th>
            </tr>
          </thead>
          <tbody>
            ${(policy?.rules || []).map(r => `
              <tr style="border-bottom:1px solid var(--color-border)">
                <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary);font-weight:500">${r.name}</td>
                <td style="padding:var(--space-3) var(--space-4)">
                  <span style="display:inline-block;padding:2px 8px;border-radius:var(--radius-sm);font-size:0.75rem;font-weight:600;${r.enabled ? 'background:rgba(52,211,153,0.15);color:rgb(52,211,153)' : 'background:rgba(239,68,68,0.15);color:rgb(239,68,68)'}">${r.enabled ? 'Activa' : 'Inactiva'}</span>
                </td>
                <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary)">${r.action === 'delete' ? 'Eliminaci&oacute;n' : r.action === 'tierToArchive' ? 'Archivar' : r.action}</td>
                <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary);font-family:monospace">${r.retentionDays}</td>
                <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-secondary);font-family:monospace;font-size:0.8125rem">${(r.prefixes || []).join(', ')}</td>
              </tr>
            `).join('')}
            <tr style="border-bottom:1px solid var(--color-border)">
              <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary);font-weight:500">Soft Delete Policy</td>
              <td style="padding:var(--space-3) var(--space-4)">
                <span style="display:inline-block;padding:2px 8px;border-radius:var(--radius-sm);font-size:0.75rem;font-weight:600;background:rgba(52,211,153,0.15);color:rgb(52,211,153)">Activa</span>
              </td>
              <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary)">Soft Delete</td>
              <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary);font-family:monospace">${policy?.softDeleteDays || 7}</td>
              <td style="padding:var(--space-3) var(--space-4);color:var(--color-text-secondary);font-family:monospace;font-size:0.8125rem">all blobs</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="margin-top:var(--space-6);background:var(--color-surface-1);border-radius:var(--radius-md);border:1px solid var(--color-border);overflow:hidden">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4);flex-wrap:wrap">
          <div>
            <h3 style="margin:0;color:var(--color-text-primary);font-size:1.0625rem">Rastro de pedidos de datos</h3>
            <p style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:0.8125rem">
              Un asiento por pedido: qui&eacute;n lo hizo, qu&eacute; pidi&oacute;, cu&aacute;ndo, desde d&oacute;nde y si se entreg&oacute; o se deneg&oacute;.
              El contenido del pedido no se copia y el origen se declara cuando la plataforma no lo informa.
            </p>
          </div>
          <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
            <select id="audit-outcome" class="form-select" style="font-size:0.8125rem;padding:4px 8px">
              <option value="">Todos</option>
              <option value="delivered">Entregados</option>
              <option value="denied">Denegados</option>
              <option value="error">Con error</option>
            </select>
            <input id="audit-correlation" class="form-input" placeholder="correlaci&oacute;n"
              style="font-size:0.8125rem;padding:4px 8px;width:190px" />
            <button class="btn btn-secondary" id="btn-audit-search" style="font-size:0.8125rem">Buscar</button>
            <button class="btn btn-secondary" id="btn-audit-csv" style="font-size:0.8125rem">&#x2193; Entregados y denegados (CSV)</button>
            <button class="btn btn-secondary" id="btn-audit-json" style="font-size:0.8125rem">&#x2193; JSON</button>
          </div>
        </div>
        <div id="access-log-body" style="padding:var(--space-4);color:var(--color-text-secondary);font-size:0.875rem">
          Cargando rastro de pedidos...
        </div>
      </div>

      <div style="margin-top:var(--space-6);background:var(--color-surface-1);border-radius:var(--radius-md);border:1px solid var(--color-border);overflow:hidden">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--color-border)">
          <h3 style="margin:0;color:var(--color-text-primary);font-size:1.0625rem">Constancias de borrado de material</h3>
          <p style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:0.8125rem">
            Cada pedido de borrado deja constancia con fecha, alcance y responsable. La comprobaci&oacute;n vuelve a leer el
            acervo, el &iacute;ndice, el dep&oacute;sito fr&iacute;o (<code>deleted/</code>) y el resguardo para mostrar qu&eacute; qued&oacute; vivo.
          </p>
        </div>
        <div id="deletion-records-body" style="padding:var(--space-4);color:var(--color-text-secondary);font-size:0.875rem">
          Cargando constancias de borrado...
        </div>
      </div>
      <div style="margin-top:var(--space-6);background:var(--color-surface-1);border-radius:var(--radius-md);border:1px solid var(--color-border);padding:var(--space-4)">
        <h3 style="margin:0 0 var(--space-2);color:var(--color-text-primary);font-size:1.1rem">Inventario de datos por persona</h3>
        <p style="margin:0 0 var(--space-4);color:var(--color-text-secondary);font-size:0.875rem">Qué se guarda de cada persona, dónde vive, con qué finalidad y con qué plazo. El plazo es el que informa la pol&iacute;tica vigente, no una copia de la pantalla.</p>
        ${dataInventoryHtml(inventory, { id: 'compliance-data-inventory' })}      </div>

      <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--color-surface-1);border-radius:var(--radius-md);border:1px solid var(--color-border)">
        <p style="margin:0;color:var(--color-text-secondary);font-size:0.8125rem">
          <strong>Nota:</strong> Estas pol&iacute;ticas se definen en <code>infra/modules/storage.bicep</code> y se aplican a nivel de Azure Storage Account.
          Los datos exportados solo incluyen metadatos de configuraci&oacute;n — no contienen informaci&oacute;n personal identificable (PII) ni claves de acceso.
        </p>
      </div>
    </div>
  `;

  document.getElementById('btn-export-csv')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-export-csv');
    btn.disabled = true;
    btn.innerHTML = '<span>&#x21bb;</span> Exportando...';
    try {
      const blob = await api.getRetentionExport('csv');
      if (blob) {
        const date = new Date().toISOString().slice(0, 10);
        downloadBlob(blob, `retention-compliance-${date}.csv`);
      }
    } catch (err) {
      console.error('[Compliance] CSV export error:', err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>&#x2193;</span> Exportar CSV';
    }
  });

  cargarConstanciasDeBorrado();
  cargarRastroDeAccesos();
  wireRastroDeAccesos();

  document.getElementById('btn-export-json')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-export-json');
    btn.disabled = true;
    btn.innerHTML = '<span>&#x21bb;</span> Exportando...';
    try {
      const blob = await api.getRetentionExport('json');
      if (blob) {
        const date = new Date().toISOString().slice(0, 10);
        downloadBlob(blob, `retention-compliance-${date}.json`);
      }
    } catch (err) {
      console.error('[Compliance] JSON export error:', err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>&#x2193;</span> Exportar JSON';
    }
  });
}

// ── Constancias de borrado de material (UJ-56 pasos 4, 7 y 9 / #538) ───────
// La pantalla no inventa "no hay borrados": si la lectura falla, lo dice.

const VERDICT_STYLE = {
  'sin-copias': 'background:rgba(52,211,153,0.15);color:rgb(52,211,153)',
  'residuo-soft-delete': 'background:rgba(251,191,36,0.15);color:rgb(251,191,36)',
  'copia-viva': 'background:rgba(239,68,68,0.15);color:rgb(239,68,68)',
  'material-vivo': 'background:rgba(239,68,68,0.15);color:rgb(239,68,68)',
  'indeterminado': 'background:rgba(148,163,184,0.2);color:rgb(148,163,184)',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fechaCorta(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleString();
}

function outcomeLabel(outcome) {
  return ({
    deleted: 'Borrado',
    'already-absent': 'Ya no estaba',
    partial: 'Parcial',
    failed: 'Falló',
  })[outcome] || esc(outcome);
}

async function cargarConstanciasDeBorrado() {
  const body = document.getElementById('deletion-records-body');
  if (!body) return;

  const data = await api.getDeletionRecords({ limit: 20 });
  if (!data) {
    body.innerHTML = `
      <p style="margin:0;color:var(--color-danger,#ef4444)">
        No se pudieron leer las constancias de borrado. Esto <strong>no</strong> significa que no haya borrados registrados.
      </p>`;
    return;
  }

  const records = data.records || [];
  if (records.length === 0) {
    body.innerHTML = '<p style="margin:0">Todavía no hay borrados de material registrados.</p>';
    return;
  }

  const th = (label) => `<th style="padding:var(--space-3) var(--space-4);text-align:left;color:var(--color-text-secondary);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">${label}</th>`;
  const td = (content) => `<td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary);font-size:0.8125rem">${content}</td>`;

  body.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid var(--color-border)">
          ${th('Fecha')}${th('Material')}${th('Unidad')}${th('Responsable')}${th('Resultado')}${th('Copias en deleted/')}${th('Comprobación')}
        </tr>
      </thead>
      <tbody>
        ${records.map((r) => `
          <tr style="border-bottom:1px solid var(--color-border)">
            ${td(fechaCorta(r.requestedAt))}
            ${td(`<span title="${esc(r.target?.materialId)}">${esc(r.target?.filename || r.target?.materialId)}</span>`)}
            ${td(esc(r.target?.subjectId || 'N/A'))}
            ${td(`${esc(r.actor?.id || 'desconocido')}<br><span style="color:var(--color-text-secondary);font-size:0.75rem">${esc((r.actor?.roles || []).join(', '))}</span>`)}
            ${td(`<span style="display:inline-block;padding:2px 8px;border-radius:var(--radius-sm);font-size:0.75rem;font-weight:600;${r.outcome === 'deleted' ? 'background:rgba(52,211,153,0.15);color:rgb(52,211,153)' : r.outcome === 'already-absent' ? 'background:rgba(148,163,184,0.2);color:rgb(148,163,184)' : 'background:rgba(239,68,68,0.15);color:rgb(239,68,68)'}">${outcomeLabel(r.outcome)}</span>`)}
            ${td(`${Array.isArray(r.scope?.blobsMoved) ? r.scope.blobsMoved.length : 0}`)}
            ${td(`<button class="btn btn-secondary" data-verificar="${esc(r.recordId)}" style="font-size:0.75rem;padding:2px 10px">Comprobar</button>`)}
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="margin-top:var(--space-3);color:var(--color-text-secondary);font-size:0.75rem">
      Política vigente: soft delete ${esc(data.policy?.softDeleteDays ?? 7)} d ·
      vida en <code>deleted/</code> ${esc(data.policy?.deletedContainerPurgeDays ?? 'N/A')} d
      ${data.policy?.deletedContainerPurgeDays > (data.policy?.softDeleteDays ?? 7)
        ? `<span style="color:rgb(251,191,36);margin-left:var(--space-2)">— el depósito frío retiene más de lo que declara la política</span>`
        : ''}
    </div>
    <div id="deletion-verify-detail" style="margin-top:var(--space-3)"></div>
  `;

  body.querySelectorAll('[data-verificar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recordId = btn.getAttribute('data-verificar');
      const detalle = document.getElementById('deletion-verify-detail');
      btn.disabled = true;
      btn.textContent = 'Comprobando...';
      const res = await api.verifyDeletionRecord(recordId);
      btn.disabled = false;
      if (!res?.verificacion) {
        btn.textContent = 'No se pudo comprobar';
        if (detalle) detalle.innerHTML = `<p style="margin:0;color:var(--color-danger,#ef4444)">No se pudo comprobar la constancia ${esc(recordId)}. No se informa como verificada.</p>`;
        return;
      }
      const v = res.verificacion;
      btn.textContent = v.verdictLabel ? v.verdictLabel.split(':')[0] : v.verdict;
      if (detalle) {
        const contenedores = Object.entries(v.contenedores || {})
          .map(([nombre, info]) => `${esc(nombre)}: ${info.exists === false ? 'no existe' : `${(info.copias || []).length} copia(s)`}`)
          .join(' · ');
        detalle.innerHTML = `
          <div style="padding:var(--space-3);border-radius:var(--radius-md);background:var(--color-surface-2,rgba(148,163,184,0.1));font-size:0.8125rem">
            <div style="display:inline-block;padding:2px 8px;border-radius:var(--radius-sm);font-weight:600;font-size:0.75rem;${VERDICT_STYLE[v.verdict] || ''}">${esc(v.verdictLabel || v.verdict)}</div>
            <div style="margin-top:var(--space-2);color:var(--color-text-secondary)">
              Comprobado: ${fechaCorta(v.checkedAt)} · ${contenedores}
            </div>
            <div style="margin-top:var(--space-1);color:var(--color-text-secondary)">
              Retención declarada ${esc(v.retencion?.diasDeclaradosPorPolitica)} d ·
              el depósito frío conserva ${esc(v.retencion?.diasDeVidaEnDepositoFrio)} d
              ${v.retencion?.excedeLaPolitica ? '· excede la política vigente' : ''}
            </div>
            <div style="margin-top:var(--space-1);color:var(--color-text-secondary)">
              Constancia: <code>${esc(recordId)}</code>
            </div>
          </div>`;
      }
    });
  });
}

// ── Rastro de pedidos de datos (UJ-62 pasos 5, 7, 8 y 9 / #456) ────────────
// La pantalla no inventa nada: si la lectura falla lo dice ("no pude leer" no
// es "no hubo pedidos"), y si el origen no está disponible lo muestra como
// "no disponible" en vez de dejar la celda vacía.

const ACCESS_OUTCOME_STYLE = {
  delivered: 'background:rgba(52,211,153,0.15);color:rgb(52,211,153)',
  denied: 'background:rgba(239,68,68,0.15);color:rgb(239,68,68)',
  error: 'background:rgba(148,163,184,0.2);color:rgb(148,163,184)',
};

const ACCESS_OUTCOME_LABEL = {
  delivered: 'Entregado',
  denied: 'Denegado',
  error: 'Error',
};

function filtrosRastro() {
  const outcome = document.getElementById('audit-outcome')?.value || '';
  const correlationId = document.getElementById('audit-correlation')?.value?.trim() || '';
  const filtros = {};
  if (outcome) filtros.outcome = outcome;
  if (correlationId) filtros.correlationId = correlationId;
  return filtros;
}

async function cargarRastroDeAccesos() {
  const body = document.getElementById('access-log-body');
  if (!body) return;

  const data = await api.getAccessLog({ ...filtrosRastro(), limit: 25 });
  if (!data) {
    body.innerHTML = `
      <p style="margin:0;color:var(--color-danger,#ef4444)">
        No se pudo leer el rastro de pedidos. Esto <strong>no</strong> significa que no haya pedidos registrados.
      </p>`;
    return;
  }

  const records = data.records || [];
  const totals = data.totals || {};
  const trazado = data.trazado || {};
  const retencion = data.retencion || {};
  const origen = data.origen || {};

  const aviso = [];
  if (trazado.activo === false) {
    aviso.push('El rastro está desactivado en este entorno: un listado vacío no prueba que no hubo pedidos.');
  }
  if (trazado.almacenConfigurado === false) {
    aviso.push('El almacén del rastro no está configurado: los pedidos no se están asentando.');
  }
  if (origen.disponible === false && records.length > 0) {
    aviso.push(origen.nota || 'La plataforma no informó el origen de estos pedidos.');
  }

  const resumen = `
    <div style="margin-bottom:var(--space-3);display:flex;gap:var(--space-4);flex-wrap:wrap;font-size:0.8125rem">
      <span><strong style="color:rgb(52,211,153)">${esc(totals.entregados ?? 0)}</strong> entregados</span>
      <span><strong style="color:rgb(239,68,68)">${esc(totals.denegados ?? 0)}</strong> denegados</span>
      <span><strong style="color:var(--color-text-secondary)">${esc(totals.errores ?? 0)}</strong> con error</span>
      <span style="color:var(--color-text-secondary)">ventana ${esc(fechaCorta(data.window?.from))} — ${esc(fechaCorta(data.window?.to))}</span>
    </div>`;

  const notaRetencion = `
    <div style="margin-top:var(--space-3);color:var(--color-text-secondary);font-size:0.75rem">
      Retención declarada del rastro: ${esc(retencion.days ?? 'N/A')} días
      ${retencion.enforced === false ? '· <span style="color:rgb(251,191,36)">declarada, todavía no aplicada por la política</span>' : ''}
      · ${esc(data.alcance || '')}
    </div>`;

  if (records.length === 0) {
    body.innerHTML = `${resumen}
      <p style="margin:0">Todavía no hay pedidos registrados en esta ventana con estos filtros.</p>
      ${aviso.map((a) => `<p style="margin:var(--space-1) 0 0;color:rgb(251,191,36);font-size:0.8125rem">${esc(a)}</p>`).join('')}
      ${notaRetencion}`;
    return;
  }

  const th = (label) => `<th style="padding:var(--space-3) var(--space-4);text-align:left;color:var(--color-text-secondary);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">${label}</th>`;
  const td = (content) => `<td style="padding:var(--space-3) var(--space-4);color:var(--color-text-primary);font-size:0.8125rem">${content}</td>`;

  body.innerHTML = `
    ${resumen}
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid var(--color-border)">
          ${th('Fecha')}${th('Resultado')}${th('Qué se pidió')}${th('Quién')}${th('Desde dónde')}${th('Estado')}${th('Correlación')}
        </tr>
      </thead>
      <tbody>
        ${records.map((r) => `
          <tr style="border-bottom:1px solid var(--color-border)">
            ${td(fechaCorta(r.at))}
            ${td(`<span style="display:inline-block;padding:2px 8px;border-radius:var(--radius-sm);font-size:0.75rem;font-weight:600;${ACCESS_OUTCOME_STYLE[r.outcome] || ''}">${esc(ACCESS_OUTCOME_LABEL[r.outcome] || r.outcome)}</span>`)}
            ${td(`${esc(r.request?.method || '')} <code>${esc(r.request?.path || 'N/A')}</code><br><span style="color:var(--color-text-secondary);font-size:0.75rem">${esc(r.surface || 'superficie no declarada')}</span>`)}
            ${td(`${esc(r.actor?.id || 'anonymous')}<br><span style="color:var(--color-text-secondary);font-size:0.75rem">${esc(r.actor?.role || (r.actor?.identified ? '' : 'sin identidad verificada'))}</span>`)}
            ${td(r.origin?.available
              ? `<code style="font-size:0.75rem">${esc(r.origin.ip)}</code>`
              : '<span style="color:var(--color-text-secondary);font-size:0.75rem">no disponible</span>')}
            ${td(`${esc(r.status ?? 'N/A')}${r.denial?.code ? `<br><span style="color:var(--color-text-secondary);font-size:0.75rem">${esc(r.denial.code)}</span>` : ''}`)}
            ${td(`<code style="font-size:0.75rem;color:var(--color-text-secondary)">${esc(r.correlationId || 'N/A')}</code>`)}
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${aviso.map((a) => `<p style="margin:var(--space-2) 0 0;color:rgb(251,191,36);font-size:0.8125rem">${esc(a)}</p>`).join('')}
    ${notaRetencion}`;
}

function wireRastroDeAccesos() {
  document.getElementById('btn-audit-search')?.addEventListener('click', () => { cargarRastroDeAccesos(); });

  document.getElementById('btn-audit-csv')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-audit-csv');
    if (btn) btn.disabled = true;
    try {
      const blob = await api.getAccessLogExport(filtrosRastro(), 'csv');
      if (blob) downloadBlob(blob, `rastro-accesos-${new Date().toISOString().slice(0, 10)}.csv`);
      else console.error('[Audit] La exportación del rastro no está disponible');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-audit-json')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-audit-json');
    if (btn) btn.disabled = true;
    try {
      const blob = await api.getAccessLogExport(filtrosRastro(), 'json');
      if (blob) downloadBlob(blob, `rastro-accesos-${new Date().toISOString().slice(0, 10)}.json`);
      else console.error('[Audit] La exportación del rastro no está disponible');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
