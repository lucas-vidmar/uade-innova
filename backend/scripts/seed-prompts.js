/**
 * scripts/seed-prompts.js — Migra prompts existentes (archivos + hardcodeados)
 * a la tabla PromptVersions en Azure Table Storage.
 *
 * Uso:
 *   node scripts/seed-prompts.js
 *
 * Requiere las mismas env vars que la app (AZURE_STORAGE_ACCOUNT_NAME, etc.)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getTableClient } from '../src/services/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPTS_TABLE = process.env.AZURE_TABLE_PROMPTS || 'PromptVersions';

const promptsDir = join(__dirname, '..', 'src', 'prompts');

const SEED_DATA = [
  {
    type: 'rag-master',
    versions: [
      {
        versionId: 'v1-baseline',
        content: readFileSync(join(promptsDir, 'v1-baseline.md'), 'utf-8'),
        systemPrompt: '',
        userPromptTemplate: '',
        variables: [],
        isActive: true,
        description: 'Prompt RAG baseline — estricto, formal, solo contexto RAG',
        createdBy: 'system',
      },
      {
        versionId: 'v2-empathetic',
        content: readFileSync(join(promptsDir, 'v2-empathetic.md'), 'utf-8'),
        systemPrompt: '',
        userPromptTemplate: '',
        variables: [],
        isActive: false,
        description: 'Prompt RAG v2 — empático, tono más cálido (actualmente idéntico a baseline)',
        createdBy: 'system',
      },
    ],
  },
  {
    type: 'rewrite',
    versions: [
      {
        versionId: 'v1',
        content: 'Reescribe la ultima pregunta del estudiante para que sea autonoma y clara.\nDebes conservar fielmente el significado original sin agregar informacion nueva.\nDevuelve unicamente la pregunta reescrita en espanol, sin comillas ni explicaciones.',
        systemPrompt: '',
        userPromptTemplate: '',
        variables: [],
        isActive: true,
        description: 'Reescritura de preguntas de seguimiento para hacerlas autónomas',
        createdBy: 'system',
      },
    ],
  },
  {
    type: 'class-summary',
    versions: [
      {
        versionId: 'v1',
        content: '',
        systemPrompt: 'Generas resumenes academicos profesionales.',
        userPromptTemplate: 'Eres un asistente academico experto en la UADE. Genera un resumen estructurado... [Materia: ${subjectName}]\n\nTEXTO:\n${text}',
        variables: ['subjectName', 'text'],
        isActive: true,
        description: 'Genera resúmenes estructurados de materiales de clase',
        createdBy: 'system',
      },
    ],
  },
  {
    type: 'mermaid',
    versions: [
      {
        versionId: 'v1',
        content: '',
        systemPrompt: 'Generas diagramas Mermaid.js precisos. Siempre usa comillas dobles en labels con paréntesis.',
        userPromptTemplate: 'Genera un mapa conceptual Mermaid.js (graph TD) para:\n${text}. IMPORTANTE: Usa comillas dobles en los labels que contengan paréntesis, ej: A["texto (año)"] en lugar de A[texto (año)].',
        variables: ['text'],
        isActive: true,
        description: 'Genera diagramas conceptuales en formato Mermaid.js',
        createdBy: 'system',
      },
    ],
  },
  {
    type: 'transcription-correction',
    versions: [
      {
        versionId: 'v1',
        content: '',
        systemPrompt: 'Eres un revisor de transcripciones académicas. Respondes SOLO con JSON válido.',
        userPromptTemplate: readFileSync(join(promptsDir, 'grade-transcription-prompt.txt'), 'utf-8'),
        variables: ['glossaryTerms', 'transcriptText'],
        isActive: true,
        description: 'Detecta errores en transcripciones usando el glosario de la materia',
        createdBy: 'system',
      },
    ],
  },
];

async function seed() {
  console.log('🌱 Seeding prompts to Azure Table Storage...\n');
  const client = getTableClient(PROMPTS_TABLE);
  await client.createTable().catch(() => {});

  let created = 0;
  let skipped = 0;

  for (const group of SEED_DATA) {
    for (const version of group.versions) {
      try {
        const existing = await client.getEntity(group.type, version.versionId);
        if (existing) {
          console.log(`  ⏭️  ${group.type}/${version.versionId} — ya existe, se saltea`);
          skipped++;
          continue;
        }
      } catch {
        // No existe, lo creamos
      }

      const now = new Date().toISOString();
      await client.createEntity({
        partitionKey: group.type,
        rowKey: version.versionId,
        content: version.content || '',
        systemPrompt: version.systemPrompt || '',
        userPromptTemplate: version.userPromptTemplate || '',
        variables: JSON.stringify(version.variables || []),
        isActive: version.isActive,
        description: version.description || '',
        createdAt: now,
        updatedAt: now,
        createdBy: version.createdBy || 'system',
      });

      const status = version.isActive ? '✅ activo' : '📄 inactivo';
      console.log(`  ${status} ${group.type}/${version.versionId} — ${version.description}`);
      created++;
    }
  }

  console.log(`\n✨ Completado: ${created} creados, ${skipped} saltados`);
}

seed().catch((err) => {
  console.error('❌ Error seeding prompts:', err);
  process.exit(1);
});
