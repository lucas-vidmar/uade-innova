import { api } from '../../services/api.js';
import { renderHeader } from '../../components/Header.js';

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

  const policy = await api.getRetentionPolicy();

  const isConfigured = policy?.configured !== false;

  container.innerHTML = `
    <div style="padding:var(--space-6);max-width:1400px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-6)">
        <div>
          <h2 style="margin:0;color:var(--color-text-primary);font-size:1.5rem">Evidencia de Cumplimiento Normativo</h2>
          <p style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:0.875rem">
            Pol&iacute;ticas de retenci&oacute;n y disposici&oacute;n de datos — &uacute;ltima evaluaci&oacute;n: ${policy?.evaluatedAt ? new Date(policy.evaluatedAt).toLocaleString() : 'N/A'}
            ${!isConfigured ? '<span class="badge badge-warning" style="margin-left:var(--space-2)">No configurado</span>' : ''}
          </p>
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
