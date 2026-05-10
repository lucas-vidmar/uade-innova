const SECONDARY_MATERIAL_TYPES = new Set(['bibliography']);

/**
 * Clasifica prioridad pedagógica para un material.
 * Soporta override manual del docente.
 * @param {string} materialType - Tipo de material.
 * @param {string} [override] - Prioridad manual ('primary' | 'secondary').
 * @returns {"primary" | "secondary"}
 */
export function getMaterialPriority(materialType, override) {
  if (override === 'primary' || override === 'secondary') return override;
  
  const normalizedType = String(materialType || '').trim().toLowerCase();
  if (SECONDARY_MATERIAL_TYPES.has(normalizedType)) return 'secondary';
  return 'primary';
}
