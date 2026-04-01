import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const REPO_URL = 'https://github.com/kiingor/SoftcomHub.git';
const CODE_DIR = path.resolve(process.cwd(), '../_project-code');

const IGNORE_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '.vercel', 'coverage', '__pycache__']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.sql', '.env.example', '.md']);

/** Ensure the repo is cloned and up to date. */
export async function syncRepo(): Promise<boolean> {
  try {
    const gitDir = path.join(CODE_DIR, '.git');
    let needsClone = false;

    if (fs.existsSync(gitDir)) {
      // Verify it's the correct repo (not a wrong clone)
      try {
        const remote = execSync('git remote get-url origin', { cwd: CODE_DIR, stdio: 'pipe', timeout: 5000 }).toString().trim();
        if (remote.includes('SoftcomHub')) {
          // Correct repo — pull latest
          execSync('git pull --ff-only', { cwd: CODE_DIR, stdio: 'pipe', timeout: 30000 });
          console.log('[CodeAnalysis] Repo updated via git pull');
        } else {
          // Wrong repo — needs re-clone
          console.warn(`[CodeAnalysis] Wrong repo detected (${remote}), re-cloning SoftcomHub...`);
          needsClone = true;
        }
      } catch {
        needsClone = true;
      }
    } else {
      needsClone = true;
    }

    if (needsClone) {
      // Remove old directory and clone fresh
      if (fs.existsSync(CODE_DIR)) {
        fs.rmSync(CODE_DIR, { recursive: true, force: true });
      }
      execSync(`git clone ${REPO_URL} "${CODE_DIR}"`, { stdio: 'pipe', timeout: 120000 });
      console.log('[CodeAnalysis] SoftcomHub repo cloned successfully');
    }

    // Count indexed files
    const files = listCodeFiles();
    console.log(`[CodeAnalysis] Indexed ${files.length} code files`);

    return true;
  } catch (error) {
    console.warn('[CodeAnalysis] Git sync failed:', (error as Error).message);
    return false;
  }
}

/** List all code files in the project (relative paths). */
export function listCodeFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string, relative: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relative, entry.name).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          files.push(relPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  if (fs.existsSync(CODE_DIR)) {
    walk(CODE_DIR, '');
  }
  return files;
}

/** Read a specific file from the project. */
export function readCodeFile(relativePath: string): string | null {
  try {
    const fullPath = path.join(CODE_DIR, relativePath);
    // Security: ensure we stay within the code dir
    if (!fullPath.startsWith(CODE_DIR)) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/** Search for files matching a keyword in their path or content. */
export function searchCode(query: string, maxResults = 20): Array<{ file: string; matches: string[] }> {
  const results: Array<{ file: string; matches: string[] }> = [];
  const queryLower = query.toLowerCase();
  const files = listCodeFiles();

  for (const file of files) {
    if (results.length >= maxResults) break;

    // Check filename match
    if (file.toLowerCase().includes(queryLower)) {
      const content = readCodeFile(file);
      results.push({ file, matches: content ? findMatchingLines(content, queryLower, 3) : ['[filename match]'] });
      continue;
    }

    // Check content match
    const content = readCodeFile(file);
    if (content && content.toLowerCase().includes(queryLower)) {
      results.push({ file, matches: findMatchingLines(content, queryLower, 3) });
    }
  }

  return results;
}

function findMatchingLines(content: string, query: string, maxLines: number): string[] {
  const lines = content.split('\n');
  const matches: string[] = [];
  for (let i = 0; i < lines.length && matches.length < maxLines; i++) {
    if (lines[i].toLowerCase().includes(query)) {
      matches.push(`L${i + 1}: ${lines[i].trim().slice(0, 120)}`);
    }
  }
  return matches;
}

/** Get project structure as a tree string (for AI context). */
export function getProjectStructure(): string {
  const files = listCodeFiles();
  // Group by top-level directory
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.split('/');
    const group = parts.length > 1 ? parts[0] : '.';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(file);
  }

  let tree = `Project: SoftcomHub (${files.length} files)\n`;
  for (const [group, groupFiles] of groups) {
    tree += `\n📁 ${group}/ (${groupFiles.length} files)\n`;
    for (const f of groupFiles.slice(0, 15)) {
      tree += `  ${f}\n`;
    }
    if (groupFiles.length > 15) {
      tree += `  ... e mais ${groupFiles.length - 15} arquivos\n`;
    }
  }
  return tree;
}

/**
 * Build a code context for AI agents analyzing a bug.
 * Searches for relevant files based on bug keywords and returns
 * file contents formatted for the AI prompt.
 */
export function buildCodeContextForBug(bugDescription: string, maxTokens = 8000): string {
  // Extract keywords from bug description
  const keywords = extractKeywords(bugDescription);
  let context = `\n=== CÓDIGO FONTE DO PROJETO (SoftcomHub) ===\n`;
  context += `Estrutura do projeto:\n${getProjectStructure()}\n`;

  let totalChars = context.length;
  const maxChars = maxTokens * 4; // rough token-to-char ratio

  // Search for relevant files
  const relevantFiles = new Set<string>();

  // Always include key files if bug mentions specific areas
  const descLower = bugDescription.toLowerCase();
  if (descLower.includes('workdesk')) {
    relevantFiles.add('app/workdesk/page.tsx');
    relevantFiles.add('app/workdesk/layout.tsx');
  }
  if (descLower.includes('dashboard')) relevantFiles.add('app/dashboard/page.tsx');
  if (descLower.includes('login')) relevantFiles.add('app/workdesk/login/page.tsx');
  if (descLower.includes('supabase') || descLower.includes('realtime')) {
    relevantFiles.add('lib/supabase/client.ts');
    relevantFiles.add('lib/supabase/server.ts');
  }
  if (descLower.includes('ticket')) {
    relevantFiles.add('lib/ticket-distribution.ts');
    relevantFiles.add('lib/ticket-queue-processor.ts');
  }
  if (descLower.includes('whatsapp') || descLower.includes('webhook')) {
    relevantFiles.add('app/api/whatsapp/webhook/route.ts');
  }

  for (const keyword of keywords) {
    const results = searchCode(keyword, 5);
    for (const r of results) {
      relevantFiles.add(r.file);
    }
  }

  // Add relevant file contents
  context += `\n--- Arquivos Relevantes ao Bug ---\n`;
  for (const file of relevantFiles) {
    if (totalChars > maxChars) {
      context += `\n[TRUNCADO - mais ${relevantFiles.size} arquivos relevantes encontrados]\n`;
      break;
    }

    const content = readCodeFile(file);
    if (!content) continue;

    // Truncate very large files (4000 chars = ~1000 tokens per file)
    const truncated = content.length > 4000 ? content.slice(0, 4000) + '\n... [arquivo truncado — total: ' + content.length + ' chars]' : content;
    const section = `\n📄 ${file}:\n\`\`\`\n${truncated}\n\`\`\`\n`;
    context += section;
    totalChars += section.length;
  }

  return context;
}

function extractKeywords(text: string): string[] {
  // Extract meaningful keywords from bug description
  const stopWords = new Set(['o', 'a', 'de', 'da', 'do', 'em', 'um', 'uma', 'é', 'que', 'e', 'para', 'com', 'não', 'se', 'no', 'na', 'por', 'ao', 'os', 'as', 'dos', 'das', 'quando', 'como', 'mais', 'mas', 'eu', 'ele', 'ela', 'isso', 'este', 'esta', 'esse', 'essa', 'todo', 'toda', 'muito', 'tem', 'ter', 'ser', 'está', 'estou', 'são', 'foi', 'fazer', 'pode', 'minha', 'meu']);

  const words = text.toLowerCase()
    .replace(/[^a-záàâãéèêíïóôõúüç_\-/.\s0-9]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Also look for common code terms
  const codeTerms: string[] = [];
  const patterns = [
    /(?:\/api\/\S+)/gi,     // API routes
    /(?:route|page|component)/gi, // Next.js concepts
    /(?:login|auth|ticket|usuario|setor|whatsapp|webhook|discord)/gi, // Domain terms
    /(?:erro|error|500|403|404|null|undefined|crash)/gi, // Error terms
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) codeTerms.push(...matches.map(m => m.toLowerCase()));
  }

  // Deduplicate and return top keywords
  const unique = [...new Set([...codeTerms, ...words])];
  return unique.slice(0, 10);
}
