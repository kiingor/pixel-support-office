/**
 * Simulation script — runs a full support pipeline without server/DB/Discord.
 * Usage: npx tsx src/simulate.ts
 * Requires: ANTHROPIC_API_KEY in .env
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, 'data/skills');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

// --- Cenários de teste ---
const SCENARIOS = [
  {
    label: '🐛 BUG — Transferência de ticket não funciona',
    author: 'Supervisora Camila (Atendimento)',
    message: 'Oi, estou com um problema sério no WorkDesk. Quando tento transferir um ticket de um atendente para outro do mesmo setor, aparece mensagem de sucesso mas o ticket continua aparecendo para o atendente original. O destinatário não recebe nada. Acontece desde ontem, já afetou 5 transferências hoje de manhã. Estou usando Chrome.',
  },
  {
    label: '❓ DÚVIDA — Como configurar transmissão de setor',
    author: 'Analista João (Operações)',
    message: 'Boa tarde! Quero entender como funciona a transmissão entre setores. Quando ativo o campo "transmissão ativa" no painel do setor, o que exatamente acontece com os tickets? Eles vão automaticamente para o setor receptor se não há atendentes disponíveis?',
  },
  {
    label: '🐛 BUG — Atendente não recebe alerta sonoro de novo ticket',
    author: 'Atendente Pedro (Suporte N1)',
    message: 'Oi, preciso de ajuda. Desde a última atualização, quando chega um ticket novo no WorkDesk eu não ouço mais o alerta sonoro. Meu colega ao lado ouve normalmente. Tentei deslogar e logar de novo, não resolveu. Tenho permissão normal de atendente.',
  },
];

function loadSkill(filename: string): string {
  return readFileSync(join(SKILLS_DIR, filename), 'utf-8');
}

function buildPrompt(skill: string, agentName: string, personality: string): string {
  return skill.replace('{AGENT_NAME}', agentName) +
    `\n\n## Sua Personalidade\n${personality}`;
}

async function callAgent(systemPrompt: string, userMessage: string, maxTokens = 1024): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  return response.content[0].type === 'text' ? response.content[0].text : '';
}

function parseJSON<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function divider(label: string) {
  console.log('\n' + '─'.repeat(60));
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
}

function agentSays(name: string, role: string, text: string) {
  console.log(`\n[${role.toUpperCase()} — ${name}]`);
  console.log(text);
}

// --- Agentes com personalidades aleatórias ---
const AGENTS = {
  suporte:    { name: 'Ana',       personality: 'direta e objetiva, pragmática focada em resultados rápidos, usa analogias do futebol pra tudo' },
  qa:         { name: 'Carlos',    personality: 'ansioso e apressado, perfeccionista que não tolera erros, cita métricas e números em toda resposta' },
  qa_manager: { name: 'Beatriz',   personality: 'formal e protocolar, assertiva e segura nas decisões, documenta absolutamente tudo com obsessão' },
  dev:        { name: 'Lucas',     personality: 'calmo e ponderado, criativo que pensa fora da caixa, sempre busca a solução mais simples possível' },
  dev_lead:   { name: 'Alexandre', personality: 'irônico e levemente sarcástico, sistemático e extremamente organizado, sempre pergunta "qual o impacto real disso?"' },
};

// --- Pipeline principal ---
async function runSimulation(scenario: typeof SCENARIOS[0]) {
  console.log('\n\n' + '═'.repeat(60));
  console.log(`  CENÁRIO: ${scenario.label}`);
  console.log(`  Usuário: ${scenario.author}`);
  console.log('═'.repeat(60));
  console.log(`\nMensagem: "${scenario.message}"`);

  // ── SUPORTE ──────────────────────────────────────────────
  divider('SUPORTE — Classificação e primeiro contato');
  const suportePrompt = buildPrompt(loadSkill('suporte.md'), AGENTS.suporte.name, AGENTS.suporte.personality);
  const suporteRaw = await callAgent(suportePrompt, scenario.message);
  agentSays(AGENTS.suporte.name, 'Suporte', suporteRaw);

  // Detectar se é bug (via JSON de escalação)
  const escalacao = parseJSON<{ acao: string; titulo: string; descricao: string; prioridade: string }>(suporteRaw);
  if (!escalacao || escalacao.acao !== 'escalar_qa') {
    console.log('\n✅ Dúvida resolvida diretamente pelo Suporte. Pipeline encerrado.');
    return;
  }

  console.log(`\n⬆️  Escalando para QA: "${escalacao.titulo}" [${escalacao.prioridade}]`);

  // ── QA ───────────────────────────────────────────────────
  divider('QA — Análise técnica do bug');
  const qaPrompt = buildPrompt(loadSkill('qa.md'), AGENTS.qa.name, AGENTS.qa.personality);
  const qaInput = `RELATÓRIO DO SUPORTE:\nTítulo: ${escalacao.titulo}\nDescrição: ${escalacao.descricao}\nPrioridade: ${escalacao.prioridade}\nMensagem original do usuário: ${scenario.message}`;
  const qaRaw = await callAgent(qaPrompt, qaInput, 1500);
  agentSays(AGENTS.qa.name, 'QA', qaRaw);

  const qaReport = parseJSON<Record<string, unknown>>(qaRaw);
  if (!qaReport) {
    console.log('\n⚠️  QA não retornou JSON válido. Abortando.');
    return;
  }

  // ── QA MANAGER ───────────────────────────────────────────
  divider('QA MANAGER — Revisão da análise');
  const managerPrompt = buildPrompt(loadSkill('qa_manager.md'), AGENTS.qa_manager.name, AGENTS.qa_manager.personality);
  const managerInput = `RELATÓRIO DO QA ${AGENTS.qa.name} para revisão:\n${JSON.stringify(qaReport, null, 2)}`;
  const managerRaw = await callAgent(managerPrompt, managerInput, 800);
  agentSays(AGENTS.qa_manager.name, 'QA Manager', managerRaw);

  const managerReview = parseJSON<{ aprovado: boolean; feedback: string; gravidade_final: string; observacoes: string }>(managerRaw);

  if (managerReview && !managerReview.aprovado) {
    console.log(`\n❌ Gerente não aprovou. Feedback: ${managerReview.feedback}`);
    divider('QA — Revisão com feedback do Gerente');
    const revisedInput = qaInput + `\n\nFEEDBACK DO GERENTE QA: ${managerReview.feedback}\nRevise sua análise considerando este feedback.`;
    const qaRevisedRaw = await callAgent(qaPrompt, revisedInput, 1500);
    agentSays(AGENTS.qa.name, 'QA (revisado)', qaRevisedRaw);
    const qaRevised = parseJSON<Record<string, unknown>>(qaRevisedRaw);
    if (qaRevised) Object.assign(qaReport, qaRevised);
    console.log('\n✅ Revisão aceita pelo Gerente QA.');
  } else {
    console.log('\n✅ Análise aprovada pelo Gerente QA na primeira revisão.');
  }

  if (managerReview?.gravidade_final) qaReport['gravidade'] = managerReview.gravidade_final;
  if (managerReview?.observacoes) qaReport['analise_qa'] = String(qaReport['analise_qa'] || '') + '\n[Gerente QA]: ' + managerReview.observacoes;

  // ── DEV ──────────────────────────────────────────────────
  divider('DEV — Criação do caso técnico');
  const devPrompt = buildPrompt(loadSkill('dev.md'), AGENTS.dev.name, AGENTS.dev.personality);
  const devInput = `RELATÓRIO DE QA APROVADO:\n${JSON.stringify(qaReport, null, 2)}`;
  const devRaw = await callAgent(devPrompt, devInput, 2000);
  agentSays(AGENTS.dev.name, 'DEV', devRaw);

  const devCase = parseJSON<Record<string, unknown>>(devRaw);
  if (!devCase) {
    console.log('\n⚠️  DEV não retornou JSON válido. Abortando.');
    return;
  }

  // ── DEV LEAD ─────────────────────────────────────────────
  divider('DEV LEAD — Revisão do caso');
  const leadPrompt = buildPrompt(loadSkill('dev_lead.md'), AGENTS.dev_lead.name, AGENTS.dev_lead.personality);
  const leadInput = `CASO CRIADO PELO DEV ${AGENTS.dev.name} para revisão:\n${JSON.stringify(devCase, null, 2)}`;
  const leadRaw = await callAgent(leadPrompt, leadInput, 800);
  agentSays(AGENTS.dev_lead.name, 'Dev Lead', leadRaw);

  const leadReview = parseJSON<{ aprovado: boolean; feedback: string; riscos_adicionais: string[]; observacoes: string }>(leadRaw);

  if (leadReview && !leadReview.aprovado) {
    console.log(`\n❌ Dev Lead não aprovou. Feedback: ${leadReview.feedback}`);
    divider('DEV — Revisão com feedback do Tech Lead');
    const revisedDevInput = devInput + `\n\nFEEDBACK DO DEV LEAD: ${leadReview.feedback}\nRiscos apontados: ${(leadReview.riscos_adicionais || []).join(', ')}`;
    const devRevisedRaw = await callAgent(devPrompt, revisedDevInput, 2000);
    agentSays(AGENTS.dev.name, 'DEV (revisado)', devRevisedRaw);
    console.log('\n✅ Revisão aceita pelo Dev Lead.');
  } else {
    console.log('\n✅ Caso aprovado pelo Dev Lead na primeira revisão.');
  }

  // ── RESUMO FINAL ─────────────────────────────────────────
  divider('RESUMO DO PIPELINE');
  console.log(`Usuário:     ${scenario.author}`);
  console.log(`Título:      ${devCase['titulo'] || escalacao.titulo}`);
  console.log(`Bug ID:      ${qaReport['bug_id'] || 'BUG-?'}`);
  console.log(`Caso ID:     ${devCase['caso_id'] || 'CASE-?'}`);
  console.log(`Gravidade:   ${qaReport['gravidade'] || '?'}`);
  console.log(`Causa raiz:  ${String(devCase['causa_raiz'] || '').slice(0, 120)}...`);
  console.log(`\nAgentes que evoluíram: ${AGENTS.qa.name} (QA), ${AGENTS.qa_manager.name} (Gerente), ${AGENTS.dev.name} (DEV), ${AGENTS.dev_lead.name} (Lead)`);
  console.log('\n' + '═'.repeat(60));
}

// --- Executar todos os cenários ---
async function main() {
  console.log('\n🏢 PIXEL SUPPORT OFFICE — Simulação de Pipeline');
  console.log('Agentes: ' + Object.entries(AGENTS).map(([role, a]) => `${a.name} (${role})`).join(', '));

  for (const scenario of SCENARIOS) {
    await runSimulation(scenario);
    // Pequena pausa entre cenários para não saturar rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n✅ Simulação concluída!');
}

main().catch(console.error);
