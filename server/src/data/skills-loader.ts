import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, 'skills');

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

  return `${base}${levelBlock}${learningsBlock}${personalityBlock}\n\n## Conhecimento do Sistema SoftcomHub\n\n${softcomKnowledge}`;
}
