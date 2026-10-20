/**
 * services/retention-inventory.js — Inventario de datos personales por persona
 * y finalidad (UJ-56, paso 1).
 *
 * La pantalla de retención listaba tipos de dato con un período y una acción,
 * pero no decía **qué se guarda de cada persona** ni **para qué**. Este módulo
 * declara ese inventario una sola vez, en el servidor, contra los almacenes que
 * el código realmente usa, y lo resuelve contra la política persistida para que
 * el plazo que se muestra sea el vigente y no una copia escrita a mano.
 *
 * Reglas:
 *  - Cada fila nombra el almacén real (contenedor o tabla) donde vive el dato.
 *  - `governedBy` es el campo de la política que fija el plazo. Si es `null`, el
 *    dato personal **no tiene plazo declarado** en la política: se informa como
 *    hueco, nunca se le inventa un período.
 *  - El estado sólo dice "Vigente" cuando la política está configurada, tiene
 *    responsable identificado y el dato está cubierto por ella.
 */

export const INVENTORY_STATE = {
  VIGENTE: 'vigente',
  PENDIENTE: 'pendiente',
  SIN_PLAZO: 'sin-plazo',
};

/**
 * Inventario declarado. `persona` responde "de quién es el dato"; `finalidad`,
 * "para qué se guarda"; `donde`, "dónde vive"; `governedBy`, "qué campo de la
 * política le fija el plazo".
 */
export const PERSONAL_DATA_INVENTORY = [
  {
    id: 'conversaciones',
    persona: 'Alumno',
    categoria: 'Conversaciones con el asistente',
    queSeGuarda: 'Mensajes, citas de las fuentes y valoraciones de cada consulta, asociados al usuario y a la materia.',
    donde: 'Tabla Conversations y contenedor chat-logs',
    finalidad: 'Continuidad del estudio y trazabilidad de la respuesta que recibió el alumno.',
    governedBy: 'deleteDays',
  },
  {
    id: 'transcripciones',
    persona: 'Alumno y docente',
    categoria: 'Transcripciones y audio de clase',
    queSeGuarda: 'Audio de la clase y su transcripción (VTT) con los tramos y la participación registrada.',
    donde: 'Contenedores class-audio y processed',
    finalidad: 'Accesibilidad, repaso de la clase y corrección de transcripciones.',
    governedBy: 'archiveDays',
  },
  {
    id: 'materiales',
    persona: 'Docente y alumno',
    categoria: 'Materiales, apuntes y bibliografía',
    queSeGuarda: 'Archivos de clase, resúmenes generados y material de práctica con su autoría.',
    donde: 'Contenedores class-materials y class-summaries',
    finalidad: 'Dictado de la clase y material de estudio del alumno.',
    governedBy: 'archiveDays',
  },
  {
    id: 'entregas',
    persona: 'Alumno',
    categoria: 'Entregas y tareas',
    queSeGuarda: 'Tareas asignadas y estado de entrega por alumno.',
    donde: 'Contenedor tasks-config',
    finalidad: 'Seguimiento académico y recordatorios de vencimiento.',
    governedBy: 'deleteDays',
  },
  {
    id: 'visualizaciones',
    persona: 'Alumno',
    categoria: 'Visualizaciones de clase',
    queSeGuarda: 'Qué clase abrió cada alumno y cuándo.',
    donde: 'Tabla ClassViews',
    finalidad: 'Métricas de uso del material para el docente y el director.',
    governedBy: 'deleteDays',
  },
  {
    id: 'consentimiento',
    persona: 'Todos los roles',
    categoria: 'Consentimiento informado',
    queSeGuarda: 'Aceptación del consentimiento, versión aceptada y fecha.',
    donde: 'Tabla UserConsent',
    finalidad: 'Prueba de que la persona aceptó el tratamiento antes de usar la plataforma.',
    governedBy: null,
    nota: 'Sin plazo declarado en la política de retención: es evidencia legal y hoy no la cubre ningún campo.',
  },
  {
    id: 'notificaciones',
    persona: 'Todos los roles',
    categoria: 'Notificaciones y avisos',
    queSeGuarda: 'Avisos emitidos a cada persona y su estado de lectura.',
    donde: 'Contenedor notifications',
    finalidad: 'Comunicación operativa (material nuevo, vencimientos, alertas).',
    governedBy: 'deleteDays',
  },
  {
    id: 'telemetria',
    persona: 'Todos los roles',
    categoria: 'Logs de interacción y telemetría',
    queSeGuarda: 'Eventos de uso, errores y métricas de las funciones, con identificador de usuario.',
    donde: 'Application Insights y logs de Azure Functions',
    finalidad: 'Operación, seguridad y calidad del servicio.',
    governedBy: 'deleteDays',
  },
  {
    id: 'auditoria-identidad',
    persona: 'Docente, director y admin',
    categoria: 'Auditoría de identidad y accesos',
    queSeGuarda: 'Altas, bajas, reseteos y cortes de acceso con actor, motivo y alcance.',
    donde: 'Tabla IdentityAudit',
    finalidad: 'Control de accesos y reconstrucción de quién cambió qué.',
    governedBy: null,
    nota: 'Registro append-only de auditoría: la política no le fija plazo hoy.',
  },
  {
    id: 'rastro-accesos',
    persona: 'Todos los roles',
    categoria: 'Rastro de pedidos de datos (accesos)',
    queSeGuarda: 'Un asiento por pedido HTTP: quién lo hizo, qué superficie y ruta pidió, cuándo, desde qué origen informado por la plataforma y si se entregó o se denegó. El contenido del pedido no se copia.',
    donde: 'Tabla AccessAudit',
    finalidad: 'Reconstruir qué datos se pidieron y qué se entregó, y sostener las revisiones de acceso con evidencia (UJ-62, UJ-53).',
    governedBy: null,
    nota: 'La política no le fija plazo. El propio rastro declara 365 días y lo informa como no aplicado: el plazo está declarado, todavía no aplicado por ninguna regla.',
  },
];

/**
 * Resuelve el inventario contra la política persistida.
 *
 * @param {object} policy  política efectiva (ya mergeada con los defaults)
 * @param {{configured: boolean, approvedBy?: string|null}} contexto
 */
export function buildDataInventory(policy, { configured = false, approvedBy = null } = {}) {
  const effective = configured === true && typeof approvedBy === 'string' && approvedBy.trim() !== '';
  const archiveDays = Number(policy?.archiveDays);
  const deleteDays = Number(policy?.deleteDays);

  const categories = PERSONAL_DATA_INVENTORY.map((entry) => {
    const covered = entry.governedBy === 'archiveDays' || entry.governedBy === 'deleteDays';
    const periodoDias = entry.governedBy === 'archiveDays'
      ? (Number.isFinite(archiveDays) ? archiveDays : null)
      : entry.governedBy === 'deleteDays'
        ? (Number.isFinite(deleteDays) ? deleteDays : null)
        : null;
    let accion = 'Sin acción declarada';
    if (entry.governedBy === 'archiveDays') accion = 'Archivo en frío (Cold Storage)';
    if (entry.governedBy === 'deleteDays') accion = 'Eliminación permanente';
    let estado = INVENTORY_STATE.SIN_PLAZO;
    if (covered) estado = effective ? INVENTORY_STATE.VIGENTE : INVENTORY_STATE.PENDIENTE;
    return {
      ...entry,
      periodoDias,
      accion,
      estado,
      cubierto: covered,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    configured: configured === true,
    effective,
    responsable: {
      approvedBy: typeof approvedBy === 'string' && approvedBy.trim() !== '' ? approvedBy.trim() : null,
      approvedAt: policy?.approvedAt || null,
      updatedBy: policy?.updatedBy || null,
      updatedAt: policy?.updatedAt || null,
    },
    policy: { archiveDays, deleteDays, softDeleteDays: policy?.softDeleteDays ?? null },
    totals: {
      categorias: categories.length,
      cubiertas: categories.filter((c) => c.cubierto).length,
      sinPlazo: categories.filter((c) => !c.cubierto).length,
      vigentes: categories.filter((c) => c.estado === INVENTORY_STATE.VIGENTE).length,
    },
    categories,
  };
}
