const SECONDARY_MATERIAL_TYPES = new Set(['bibliography']);

/**
 * Clasifica prioridad pedagógica para un material.
 * Bibliografía se considera secundaria; el resto primaria.
 */
export function getMaterialPriority(materialType) {
  const normalizedType = String(materialType || '').trim().toLowerCase();
  if (SECONDARY_MATERIAL_TYPES.has(normalizedType)) return 'secondary';
  return 'primary';
}
