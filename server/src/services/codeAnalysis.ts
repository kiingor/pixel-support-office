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
    if (fs.existsSync(CODE_DIR)) {
      // Pull latest
      execSync('git pull --ff-only', { cwd: CODE_DIR, stdio: 'pipe', timeout: 30000 });
      console.log('[CodeAnalysis] Repo updated via git pull');
    } else {
      // Clone
      execSync(`git clone ${REPO_URL} "${CODE_DIR}"`, { stdio: 'pipe', timeout: 60000 });
      console.log('[CodeAnalysis] Repo cloned');
    }
    return true;
  } catch (error) {
    console.warn('[CodeAnalysis] Git sync failed, using existing copy:', (error as Error).message);
    return fs.existsSync(CODE_DIR);
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

    // Truncate very large files
    const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n... [arquivo truncado]' : content;
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
