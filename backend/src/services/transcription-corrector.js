import { chatCompletion } from './ai.js';
import { getGlossary } from './glossary-store.js';
import { getTableClient } from './storage.js';
import { getActivePrompt } from './prompts.js';
import { CONFIG } from '../config.js';

const CORRECTIONS_TABLE = CONFIG.tables.transcriptionCorrections;

async function ensureCorrectionsTable() {
  const client = getTableClient(CORRECTIONS_TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
}

export async function detectGlossaryErrors(subjectId, transcriptText, materialId, classId, context) {
  const glossary = await getGlossary(subjectId);
  if (!glossary || !Array.isArray(glossary.terms) || glossary.terms.length === 0) {
    context.log(`[TranscriptionCorrector] No glossary found for subjectId=${subjectId}, skipping correction detection.`);
    return [];
  }

  const termsList = glossary.terms
    .map((t) => {
      const aliases = Array.isArray(t.aliases) && t.aliases.length > 0
        ? ` (alias: ${t.aliases.join(', ')})`
        : '';
      return `- ${t.term}${aliases}`;
    })
    .join('\n');

  const promptConfig = await getActivePrompt('transcription-correction').catch(() => null);
  const systemContent = promptConfig?.systemPrompt || 'Eres un revisor de transcripciones académicas. Respondes SOLO con JSON válido.';
  const userTemplate = promptConfig?.userPromptTemplate || '';
  const prompt = userTemplate
    .replace('{glossaryTerms}', termsList)
    .replace('{transcriptText}', transcriptText.substring(0, 15000));

  let response;
  try {
    response = await chatCompletion([
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ], false, { temperature: 0.1, max_tokens: 3000 });
  } catch (err) {
    context.error(`[TranscriptionCorrector] DeepSeek error for materialId=${materialId}:`, err.message);
    return [];
  }

  let result;
  try {
    const cleaned = response.content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/g, '')
      .trim();
    result = JSON.parse(cleaned);
  } catch (err) {
    context.warn(`[TranscriptionCorrector] Failed to parse AI response for materialId=${materialId}: ${err.message}`);
    return [];
  }

  if (!Array.isArray(result.errors) || result.errors.length === 0) {
    return [];
  }

  await ensureCorrectionsTable();
  const client = getTableClient(CORRECTIONS_TABLE);
  const suggestions = [];

  for (let i = 0; i < result.errors.length; i++) {
    const errItem = result.errors[i];
    const suggestionId = `tc-${materialId}-${i}`;
    const now = new Date().toISOString();

    const entity = {
      partitionKey: subjectId,
      rowKey: suggestionId,
      materialId,
      classId: classId || '',
      fragment: errItem.fragment || '',
      correctTerm: errItem.correctTerm || '',
      suggestedFix: errItem.suggestedFix || '',
      explanation: errItem.explanation || '',
      status: 'pending',
      detectedAt: now,
      resolvedAt: '',
    };

    try {
      await client.upsertEntity(entity, 'Merge');
    } catch (err) {
      context.error(`[TranscriptionCorrector] Failed to save suggestion ${suggestionId}:`, err.message);
      continue;
    }

    suggestions.push({
      id: suggestionId,
      ...entity,
    });

    context.log(`[TranscriptionCorrector] Detected error in ${materialId}: "${errItem.fragment}" -> "${errItem.suggestedFix}"`);
  }

  return suggestions;
}
