import { getActive, listVersions, PROMPT_TYPES } from './prompt-store.js';

/**
 * Obtiene la versión activa de un tipo de prompt directamente desde Table Storage.
 * Sin cache — cada llamada lee el estado actual para que los cambios del panel
 * de gestión se reflejen instantáneamente.
 */
export async function getActivePrompt(type) {
  try {
    const active = await getActive(type);
    if (!active) {
      console.warn(`[Prompts] No hay versión activa para tipo "${type}"`);
      return null;
    }
    return active;
  } catch (err) {
    console.error(`[Prompts] Error obteniendo prompt activo para "${type}":`, err.message);
    return null;
  }
}

/**
 * Shadow testing: obtiene una versión aleatoria entre todas las disponibles de rag-master.
 * Sin cache — refleja cambios en tiempo real.
 */
export async function getShadowPrompt() {
  const allVersions = await listVersions('rag-master').catch(() => []);
  if (allVersions.length === 0) {
    return { id: 'fallback', content: 'Eres un asistente académico.' };
  }

  if (allVersions.length === 1) {
    return {
      id: allVersions[0].versionId,
      content: allVersions[0].content,
    };
  }

  const selectedVersion = allVersions[Math.floor(Math.random() * allVersions.length)];
  return {
    id: selectedVersion.versionId,
    content: selectedVersion.content || '',
  };
}
