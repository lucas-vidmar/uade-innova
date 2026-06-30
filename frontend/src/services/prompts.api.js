import { BASE_URL, apiFetch } from './core.js';

export async function getPromptTypes() {
  const res = await apiFetch(`${BASE_URL}/prompts`);
  if (!res.ok) throw new Error(`Error ${res.status}: no se pudieron obtener los tipos de prompt`);
  return res.json();
}

export async function getPromptVersions(type) {
  const res = await apiFetch(`${BASE_URL}/prompts/${encodeURIComponent(type)}`);
  if (!res.ok) throw new Error(`Error ${res.status}: no se pudieron obtener las versiones`);
  return res.json();
}

export async function getActivePrompt(type) {
  const res = await apiFetch(`${BASE_URL}/prompts/${encodeURIComponent(type)}/active`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Error ${res.status}: no se pudo obtener el prompt activo`);
  }
  return res.json();
}

export async function createPromptVersion({ type, content, systemPrompt, userPromptTemplate, variables, description }) {
  const res = await apiFetch(`${BASE_URL}/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, content, systemPrompt, userPromptTemplate, variables, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

export async function updatePromptVersion(type, versionId, { content, systemPrompt, userPromptTemplate, variables, description }) {
  const res = await apiFetch(`${BASE_URL}/prompts/${encodeURIComponent(type)}/${encodeURIComponent(versionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, systemPrompt, userPromptTemplate, variables, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

export async function activatePromptVersion(type, versionId) {
  const res = await apiFetch(`${BASE_URL}/prompts/${encodeURIComponent(type)}/activate/${encodeURIComponent(versionId)}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

export async function deletePromptVersion(type, versionId) {
  const res = await apiFetch(`${BASE_URL}/prompts/${encodeURIComponent(type)}/${encodeURIComponent(versionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}
