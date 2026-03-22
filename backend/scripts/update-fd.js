import fs from 'fs';
import path from 'path';

const dir = 'c:/Users/lucas/Downloads/uade-innova/backend/src/functions';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'));

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  if (content.includes('app.http') && !content.includes('validateFrontDoorId')) {
    // 1. Add import
    if (content.includes("from '../services/auth-utils.js'")) {
      content = content.replace(/import \{ (.*?) \} from '\.\.\/services\/auth-utils\.js';/, "import { $1, validateFrontDoorId } from '../services/auth-utils.js';");
    } else {
      content = `import { validateFrontDoorId } from '../services/auth-utils.js';\n` + content;
    }
    
    // 2. Insert check at beginning of handler
    // Matches handler: async (request, context) => {
    // and inserts the check right after
    const regex = /(handler:\s*async\s*\([^)]*\)\s*=>\s*\{)/g;
    content = content.replace(regex, `$1\n        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };`);
    
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${file}`);
  }
}
