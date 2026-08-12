import { getTableClient } from './storage.js';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../config.js';

const PROMPTS_TABLE = CONFIG.tables.prompts;

export const PROMPT_TYPES = {
  'rag-master': {
    label: 'RAG Master',
    description: 'Prompt principal del asistente RAG para responder preguntas',
    hasSystemPrompt: true,
    hasUserPrompt: false,
    variables: [],
  },
  rewrite: {
    label: 'Reescritura de consulta',
    description: 'Reescribe preguntas de seguimiento para hacerlas autónomas',
    hasSystemPrompt: true,
    hasUserPrompt: false,
    variables: [],
  },
  'class-summary': {
    label: 'Resumen de clase',
    description: 'Genera resúmenes estructurados de materiales de clase',
    hasSystemPrompt: true,
    hasUserPrompt: true,
    variables: ['subjectName', 'text'],
  },
  mermaid: {
    label: 'Mapa conceptual Mermaid.js',
    description: 'Genera diagramas conceptuales en formato Mermaid.js',
    hasSystemPrompt: true,
    hasUserPrompt: true,
    variables: ['text'],
  },
  'transcription-correction': {
    label: 'Corrección de transcripción',
    description: 'Detecta errores en transcripciones usando el glosario',
    hasSystemPrompt: true,
    hasUserPrompt: true,
    variables: ['glossaryTerms', 'transcriptText'],
  },
  'class-podcast': {
    label: 'Podcast de clase',
    description: 'Genera el guión del podcast/audio-guía a partir del resumen de la clase',
    hasSystemPrompt: true,
    hasUserPrompt: true,
    variables: ['subjectName', 'className', 'summaryText'],
  },
  quiz: {
    label: 'Autoevaluación (cuestionario)',
    description: 'Genera preguntas de opción múltiple para autoevaluación a partir de materiales de clase',
    hasSystemPrompt: true,
    hasUserPrompt: true,
    variables: ['subjectName', 'className', 'contextText', 'questionCount'],
  },
};

const VALID_TYPES = new Set(Object.keys(PROMPT_TYPES));

function ensurePromptType(type) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Tipo de prompt inválido: "${type}". Válidos: ${[...VALID_TYPES].join(', ')}.`);
  }
}

async function ensureTable() {
  const client = getTableClient(PROMPTS_TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
}

export async function listTypes() {
  return Object.entries(PROMPT_TYPES).map(([id, meta]) => ({
    id,
    ...meta,
  }));
}

export async function listVersions(type) {
  ensurePromptType(type);
  const client = getTableClient(PROMPTS_TABLE);
  const versions = [];
  try {
    const entities = client.listEntities({ queryOptions: { filter: `PartitionKey eq '${type}'` } });
    for await (const entity of entities) {
      versions.push({
        versionId: entity.rowKey,
        type: entity.partitionKey,
        content: entity.content || '',
        systemPrompt: entity.systemPrompt || '',
        userPromptTemplate: entity.userPromptTemplate || '',
        variables: entity.variables ? JSON.parse(entity.variables) : [],
        isActive: entity.isActive === true || entity.isActive === 'true',
        description: entity.description || '',
        createdAt: entity.createdAt || '',
        updatedAt: entity.updatedAt || '',
        createdBy: entity.createdBy || '',
      });
    }
  } catch (err) {
    if (err.statusCode === 404) return [];
    throw err;
  }
  versions.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return versions;
}

export async function getActive(type) {
  ensurePromptType(type);
  const client = getTableClient(PROMPTS_TABLE);
  try {
    const entities = client.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${type}' and isActive eq true`,
      },
    });
    for await (const entity of entities) {
      return {
        versionId: entity.rowKey,
        type: entity.partitionKey,
        content: entity.content || '',
        systemPrompt: entity.systemPrompt || '',
        userPromptTemplate: entity.userPromptTemplate || '',
        variables: entity.variables ? JSON.parse(entity.variables) : [],
        isActive: true,
        description: entity.description || '',
        createdAt: entity.createdAt || '',
        updatedAt: entity.updatedAt || '',
      };
    }
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
  return null;
}

export async function getVersion(type, versionId) {
  ensurePromptType(type);
  const client = getTableClient(PROMPTS_TABLE);
  try {
    const entity = await client.getEntity(type, versionId);
    return {
      versionId: entity.rowKey,
      type: entity.partitionKey,
      content: entity.content || '',
      systemPrompt: entity.systemPrompt || '',
      userPromptTemplate: entity.userPromptTemplate || '',
      variables: entity.variables ? JSON.parse(entity.variables) : [],
      isActive: entity.isActive === true || entity.isActive === 'true',
      description: entity.description || '',
      createdAt: entity.createdAt || '',
      updatedAt: entity.updatedAt || '',
      createdBy: entity.createdBy || '',
    };
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

export async function createVersion({ type, content, systemPrompt, userPromptTemplate, variables, description, createdBy }) {
  ensurePromptType(type);
  await ensureTable();
  const client = getTableClient(PROMPTS_TABLE);
  const now = new Date().toISOString();
  const versionId = `v-${uuidv4().slice(0, 8)}`;

  await client.createEntity({
    partitionKey: type,
    rowKey: versionId,
    content: content || '',
    systemPrompt: systemPrompt || '',
    userPromptTemplate: userPromptTemplate || '',
    variables: variables ? JSON.stringify(variables) : '[]',
    isActive: false,
    description: description || '',
    createdAt: now,
    updatedAt: now,
    createdBy: createdBy || 'system',
  });

  return { versionId, type, isActive: false, createdAt: now };
}

export async function updateVersion(type, versionId, { content, systemPrompt, userPromptTemplate, variables, description }) {
  ensurePromptType(type);
  const client = getTableClient(PROMPTS_TABLE);
  const existing = await client.getEntity(type, versionId);
  if (!existing) throw new Error(`Versión ${versionId} no encontrada para tipo ${type}`);

  const now = new Date().toISOString();
  await client.updateEntity({
    partitionKey: type,
    rowKey: versionId,
    content: content ?? existing.content,
    systemPrompt: systemPrompt ?? existing.systemPrompt,
    userPromptTemplate: userPromptTemplate ?? existing.userPromptTemplate,
    variables: variables ? JSON.stringify(variables) : existing.variables,
    description: description ?? existing.description,
    updatedAt: now,
  }, 'Merge');

  return { versionId, type, updatedAt: now };
}

export async function activateVersion(type, versionId) {
  ensurePromptType(type);
  const client = getTableClient(PROMPTS_TABLE);

  const target = await client.getEntity(type, versionId);
  if (!target) throw new Error(`Versión ${versionId} no encontrada para tipo ${type}`);

  // Desactivar todas las versiones de este tipo
  const allVersions = [];
  const entities = client.listEntities({ queryOptions: { filter: `PartitionKey eq '${type}'` } });
  for await (const entity of entities) {
    allVersions.push(entity);
  }

  for (const entity of allVersions) {
    if (entity.rowKey === versionId) {
      await client.updateEntity({ ...entity, isActive: true, updatedAt: new Date().toISOString() }, 'Merge');
    } else {
      if (entity.isActive === true || entity.isActive === 'true') {
        await client.updateEntity({ ...entity, isActive: false, updatedAt: new Date().toISOString() }, 'Merge');
      }
    }
  }

  return { type, versionId, isActive: true };
}

export async function deleteVersion(type, versionId) {
  ensurePromptType(type);
  const client = getTableClient(PROMPTS_TABLE);
  const existing = await client.getEntity(type, versionId);
  if (!existing) throw new Error(`Versión ${versionId} no encontrada para tipo ${type}`);

  if (existing.isActive === true || existing.isActive === 'true') {
    throw new Error('No se puede eliminar la versión activa. Activá otra versión primero.');
  }

  await client.deleteEntity(type, versionId);
  return { type, versionId, deleted: true };
}
