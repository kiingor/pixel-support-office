import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, 'skills');
const KNOWLEDGE_DIR = join(__dirname, '..', '..', 'data', 'knowledge');

function loadSkill(filename: string): string {
  return readFileSync(join(SKILLS_DIR, filename), 'utf-8');
}

export const SKILLS: Record<string, string> = {
  suporte:      loadSkill('suporte.md'),
  qa:           loadSkill('qa.md'),
  qa_manager:   loadSkill('qa_manager.md'),
  dev:          loadSkill('dev.md'),
  dev_lead:     loadSkill('dev_lead.md'),
  log_analyzer: loadSkill('log_analyzer.md'),
  ceo:          loadSkill('ceo.md'),
};

export type SkillLevel = 'Júnior' | 'Pleno' | 'Sênior' | 'Especialista';

export function getSkillLevel(tasksCompleted: number): SkillLevel {
  if (tasksCompleted < 5)  return 'Júnior';
  if (tasksCompleted < 20) return 'Pleno';
  if (tasksCompleted < 50) return 'Sênior';
  return 'Especialista';
}

/**
 * Build the full system prompt for an agent by combining:
 *   skill .md + skill level + accumulated learnings + personality + SoftcomHub knowledge
 */
export function buildAgentPrompt(
  role: string,
  agentName: string,
  softcomKnowledge: string,
  personality?: string,
  options?: {
    tasksCompleted?: number;
    learnings?: string[];
  },
): string {
  const skill = SKILLS[role] ?? SKILLS['suporte'];
  const base = skill.replace('{AGENT_NAME}', agentName);

  const tasksCompleted = options?.tasksCompleted ?? 0;
  const level = getSkillLevel(tasksCompleted);

  const levelBlock = `\n\n## Nível de Habilidade\n**${level}** — ${tasksCompleted} tarefa(s) concluída(s)`;

  const learnings = options?.learnings ?? [];
  const learningsBlock = learnings.length > 0
    ? `\n\n## Experiência Acumulada\nCom base em tarefas anteriores, você aprendeu:\n${learnings.map((l, i) => `${i + 1}. ${l}`).join('\n')}`
    : '';

  const personalityBlock = personality
    ? `\n\n## Sua Personalidade Única\n${personality}`
    : '';

  const sectorKnowledge = loadSectorKnowledge(role);
  const sectorBlock = sectorKnowledge
    ? `\n\n## Conhecimento Específico do Setor\n\n${sectorKnowledge}`
    : '';

  return `${base}${levelBlock}${learningsBlock}${personalityBlock}\n\n## Conhecimento do Sistema SoftcomHub\n\n${softcomKnowledge}${sectorBlock}`;
}

/** Map roles to their knowledge file (qa_manager shares qa, dev_lead shares dev) */
function roleToKnowledgeFile(role: string): string {
  const mapping: Record<string, string> = {
    suporte: 'suporte',
    qa: 'qa',
    qa_manager: 'qa',
    dev: 'dev',
    dev_lead: 'dev',
    log_analyzer: 'log_analyzer',
    ceo: 'ceo',
  };
  return mapping[role] || 'suporte';
}

/** Load sector-specific knowledge from .md file (read fresh each time for live updates) */
export function loadSectorKnowledge(role: string): string {
  try {
    const filename = roleToKnowledgeFile(role) + '.md';
    const filePath = join(KNOWLEDGE_DIR, filename);
    if (!existsSync(filePath)) return '';
    const content = readFileSync(filePath, 'utf-8').trim();
    // Skip if it's just the default placeholder
    if (content.includes('Nenhum conteudo adicionado ainda')) return '';
    return content;
  } catch {
    return '';
  }
}

/** Save sector knowledge to .md file */
export function saveSectorKnowledge(role: string, content: string): boolean {
  try {
    if (!existsSync(KNOWLEDGE_DIR)) {
      mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    }
    const filename = roleToKnowledgeFile(role) + '.md';
    const filePath = join(KNOWLEDGE_DIR, filename);
    writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error('saveSectorKnowledge error:', err);
    return false;
  }
}

/** Get the sector name in Portuguese for display */
export function getSectorDisplayName(role: string): string {
  const names: Record<string, string> = {
    suporte: 'Suporte',
    qa: 'QA',
    qa_manager: 'QA',
    dev: 'Desenvolvimento',
    dev_lead: 'Desenvolvimento',
    log_analyzer: 'Log/Infraestrutura',
    ceo: 'CEO/Executivo',
  };
  return names[role] || role;
}
