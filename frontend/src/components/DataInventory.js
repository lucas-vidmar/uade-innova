/**
 * components/DataInventory.js — Inventario de datos personales por persona y
 * finalidad (UJ-56 / #537).
 *
 * La pantalla de retención listaba tipos de dato con período y acción, pero no
 * decía de quién era cada dato ni con qué finalidad se guardaba, y no nombraba
 * a nadie como responsable de la conservación. Este componente renderiza el
 * inventario que sirve el backend (`/api/compliance/data-inventory`), ya
 * resuelto contra la política vigente: los períodos no se escriben acá.
 *
 * Se usa en `#/admin/retention` y en `#/admin/compliance` para que las dos
 * superficies muestren exactamente el mismo inventario y el mismo responsable.
 */

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatPeriod(days) {
  if (days === null || days === undefined || Number.isNaN(Number(days))) return 'Sin plazo declarado';
  const n = Number(days);
  if (n >= 365 && n % 365 === 0) {
    const years = n / 365;
    return `${years} ${years === 1 ? 'año' : 'años'}`;
  }
  if (n >= 30 && n % 30 === 0) {
    const months = n / 30;
    return `${months} ${months === 1 ? 'mes' : 'meses'}`;
  }
  return `${n} días`;
}

export function stateBadge(estado) {
  if (estado === 'vigente') return '<span class="badge badge-success">Vigente</span>';
  if (estado === 'pendiente') return '<span class="badge badge-warning">Pendiente</span>';
  return '<span class="badge badge-warning">Sin plazo en la política</span>';
}

/** Texto del responsable de la política, tal como lo informa la API. */
export function responsableText(inventory) {
  const responsable = inventory?.responsable || {};
  const approvedBy = responsable.approvedBy;
  if (!approvedBy) {
    return inventory?.configured
      ? 'Sin responsable identificado: la política está guardada pero nadie la aprobó.'
      : 'Sin responsable identificado: no hay política de retención aprobada.';
  }
  const approvedAt = responsable.approvedAt ? new Date(responsable.approvedAt) : null;
  const stamp = approvedAt && !Number.isNaN(approvedAt.getTime())
    ? ` el ${approvedAt.toLocaleDateString()}`
    : '';
  return `Responsable: ${escapeHtml(approvedBy)}${escapeHtml(stamp)}`;
}

/** HTML del bloque "Responsable" que acompaña al estado de la política. */
export function responsableHtml(inventory, { id = null } = {}) {
  if (!inventory) {
    return `<p class="text-xs text-text-muted"${id ? ` id="${id}"` : ''}>No se pudo leer el inventario de datos personales.</p>`;
  }
  return `<p class="text-xs text-text-muted"${id ? ` id="${id}"` : ''} style="margin:2px 0 0">${responsableText(inventory)}</p>`;
}

/** Tabla del inventario: qué se guarda de cada persona y con qué finalidad. */
export function dataInventoryHtml(inventory, { id = 'data-inventory' } = {}) {
  if (!inventory) {
    return `<div id="${id}"><p class="text-xs text-text-muted">No se pudo cargar el inventario de datos personales.</p></div>`;
  }
  const categories = Array.isArray(inventory.categories) ? inventory.categories : [];
  const totals = inventory.totals || {};
  const rows = categories.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.persona)}</strong></td>
                <td>
                  <strong>${escapeHtml(row.categoria)}</strong>
                  <p class="text-xs text-text-muted" style="margin:2px 0 0">${escapeHtml(row.queSeGuarda)}</p>
                  <p class="text-xs text-text-muted" style="margin:2px 0 0"><code>${escapeHtml(row.donde)}</code></p>
                </td>
                <td>${escapeHtml(row.finalidad)}</td>
                <td>${escapeHtml(formatPeriod(row.periodoDias))}</td>
                <td>${escapeHtml(row.accion)}</td>
                <td>${stateBadge(row.estado)}</td>
              </tr>`).join('');

  return `
      <div id="${id}">
        <p class="text-xs text-text-muted" style="margin:0 0 var(--space-3)">
          ${escapeHtml(String(totals.categorias ?? categories.length))} categorías declaradas ·
          ${escapeHtml(String(totals.cubiertas ?? 0))} con plazo en la política ·
          ${escapeHtml(String(totals.sinPlazo ?? 0))} sin plazo declarado ·
          responsable: <strong>${escapeHtml(inventory.responsable?.approvedBy || 'sin identificar')}</strong>
        </p>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Qué se guarda</th>
                <th>Finalidad</th>
                <th>Plazo vigente</th>
                <th>Acción al vencer</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
}
