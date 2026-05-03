import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, '../prompts');

let SYSTEM_PROMPTS = {};

try {
    const files = fs.readdirSync(PROMPTS_DIR);
    for (const file of files) {
        if (file.endsWith('.md')) {
            const version = file.replace('.md', '');
            SYSTEM_PROMPTS[version] = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf-8');
        }
    }
} catch (error) {
    console.error('Error loading prompts from markdown files:', error);
}

/**
 * Executes a deterministic or pseudo-random selection to pull the currently
 * active system prompt variation for A/B (Shadow) testing.
 */
export function getShadowPrompt() {
    const keys = Object.keys(SYSTEM_PROMPTS);
    if (keys.length === 0) {
        return { id: 'fallback', content: 'Eres un asistente académico.' };
    }
    const selectedVersion = keys[Math.floor(Math.random() * keys.length)];
    return {
        id: selectedVersion,
        content: SYSTEM_PROMPTS[selectedVersion]
    };
}
