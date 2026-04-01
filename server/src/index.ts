import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';
import { v4 as uuid } from 'uuid';

import {
  initDatabase, dbCreateTicket, dbUpdateTicket, dbCreateCase,
  dbGetCases, dbGetPendingTickets, dbGetAllTickets, dbInsertLog, dbGetRecentLogs,
  dbLogAgentMessage, dbSaveMessage, dbGetConversation,
  dbUpdateCase, dbUpdateAgent,
  dbCreateAgent, dbFireAgent, dbGetActiveAgents,
  dbAddLearning, dbGetLearnings, dbIncrementTasksCompleted,
  dbGetAgentTickets, dbGetAgentCases, dbGetRecentTicketsWithAgent, dbGetRecentAnomalies,
  dbLogAgentActivity, dbGetAgentActivityLog,
  dbLogAgentConversation, dbGetRecentAgentConversations,
  dbDeleteCase, dbGetCaseConversation,
  dbGetUnanalyzedErrorLogs, dbMarkErrorLogsAsAnalyzed, dbGetErrorLogStats,
  type ErrorLog,
  supabase,
} from './db/supabase.js';
import { classifyTicket, analyzeQA, generateDevCase, analyzeLogs, chatWithAgent, supportChat, generateBubble, reviewQA, reviewDevCase, generateLearningInsight, classifyExternalLog } from './services/aiService.js';
import { initDiscord, sendDiscordMessage, type DiscordAttachment } from './services/discord.js';
import { syncRepo, getProjectStructure } from './services/codeAnalysis.js';
import { SOFTCOMHUB_KNOWLEDGE } from './data/softcomhub-knowledge.js';
import { buildAgentPrompt, saveSectorKnowledge, loadSectorKnowledge, getSectorDisplayName } from './data/skills-loader.js';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: true },
});

// --- State ---
let bugCounter = 0;
let caseCounter = 0;

// Multi-agent support tracking
interface SupportAgent {
  id: string;
  name: string;
  busy: boolean;
  currentChannelId: string | null;
}
const supportAgents: SupportAgent[] = [];
const logAnalyzerAgents: string[] = [];
const qaAgents: string[] = [];    // All QA agent names for round-robin
const devAgents: string[] = [];   // All DEV agent names for round-robin
let qaRoundRobin = 0;
let devRoundRobin = 0;
const ticketQueue: Array<{ author: string; content: string; channelId: string }> = [];

// In-memory conversation history fallback (in case DB fails)
const memoryConversations = new Map<string, Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>>();

// Active meeting state (persists across client reconnects)
interface MeetingState {
  active: boolean;
  topic: string;
  participants: string[];
  messages: Array<{ from: 'user' | 'agent'; agentName?: string; agentRole?: string; text: string; timestamp: number }>;
}
const activeMeeting: MeetingState = { active: false, topic: '', participants: [], messages: [] };

function addToMemory(channelId: string, role: 'user' | 'assistant', content: string) {
  if (!memoryConversations.has(channelId)) {
    memoryConversations.set(channelId, []);
  }
  const history = memoryConversations.get(channelId)!;
  history.push({ role, content, timestamp: Date.now() });
  // Keep only last 30 messages per channel
  if (history.length > 30) history.splice(0, history.length - 30);
}

function getMemoryHistory(channelId: string, limit = 20): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history = memoryConversations.get(channelId) || [];
  return history.slice(-limit).map(m => ({ role: m.role, content: m.content }));
}

// Active tickets per Discord channel
const activeChannels = new Map<string, {
  ticketId: string;
  status: 'collecting' | 'processing' | 'qa' | 'dev' | 'done';
  agentName: string;
  agentId: string;
  agentPrompt: string;
  bugReport?: string;
}>();

// Agent config (loaded from frontend or defaults)
interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
}

const agentConfigs = new Map<string, AgentConfig>();

// Default agent names
let supportAgentName = 'Ana';
let qaAgentName = 'Carlos';
let qaManagerName = 'Beatriz';
let devAgentName = 'Lucas';
let devLeadName = 'Alexandre';
let logAgentName = 'Monitor';
let ceoAgentName = 'Director Silva';

// --- Personality system ---

const PERSONALITY_POOL = {
  comunicacao: [
    'direto e objetivo',
    'prolixo e muito detalhista',
    'irônico e levemente sarcástico',
    'entusiasmado e animado',
    'calmo e ponderado',
    'ansioso e apressado',
    'formal e protocolar',
    'informal e bem descontraído',
  ],
  estilo: [
    'perfeccionista que não tolera erros',
    'pragmático focado em resultados rápidos',
    'criativo que pensa fora da caixa',
    'metódico que segue processos rigorosamente',
    'cético que questiona tudo',
    'sistemático e extremamente organizado',
    'curioso que quer entender o porquê de tudo',
    'assertivo e seguro nas decisões',
  ],
  quirk: [
    'usa analogias do futebol pra tudo',
    'faz referências constantes a filmes e séries',
    'cita métricas e números em toda resposta',
    'sempre pergunta "qual o impacto real disso?"',
    'documenta absolutamente tudo com obsessão',
    'sempre busca a solução mais simples possível',
    'tem um bordão próprio que repete com frequência',
    'compara situações técnicas com coisas do dia a dia',
  ],
};

function generatePersonality(): string {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(PERSONALITY_POOL.comunicacao)}, ${pick(PERSONALITY_POOL.estilo)}, ${pick(PERSONALITY_POOL.quirk)}`;
}

// Store personality per agent name
const agentPersonalities = new Map<string, string>();

// Generate initial personalities for fixed agents
agentPersonalities.set(ceoAgentName, generatePersonality());
agentPersonalities.set(qaAgentName, generatePersonality());
agentPersonalities.set(qaManagerName, generatePersonality());
agentPersonalities.set(devAgentName, generatePersonality());
agentPersonalities.set(devLeadName, generatePersonality());
agentPersonalities.set(logAgentName, generatePersonality());

function buildPersonalizedPrompt(role: string, agentName: string): string {
  const personality = agentPersonalities.get(agentName);
  return buildAgentPrompt(role, agentName, SOFTCOMHUB_KNOWLEDGE, personality);
}

/** Async version that injects skill level + learnings from DB */
async function buildPersonalizedPromptFull(role: string, agentName: string): Promise<string> {
  const personality = agentPersonalities.get(agentName);
  const [learningRows, agentRow] = await Promise.all([
    dbGetLearnings(agentName),
    supabase.from('agents').select('tasks_completed').eq('name', agentName).is('fired_at', null).single(),
  ]);
  const tasksCompleted = agentRow?.data?.tasks_completed ?? 0;
  const learnings = learningRows.map(r => r.learning);
  return buildAgentPrompt(role, agentName, SOFTCOMHUB_KNOWLEDGE, personality, { tasksCompleted, learnings });
}

const FACTUAL_INSTRUCTION = `

REGRA CRÍTICA — HONESTIDADE ABSOLUTA:
- Você SÓ pode relatar atividades que aparecem no seu HISTÓRICO DE ATIVIDADES acima.
- NÃO invente, NÃO assuma, NÃO crie atividades fictícias.
- Se o operador perguntar sobre algo que não está no seu histórico, diga: "Não tenho registro disso no meu histórico de atividades."
- Quando relatar o que fez, cite dados reais: IDs de tickets, nomes de autores, datas, classificações.
- Seja direto e factual. Você é um profissional que reporta com base em evidências.`;

/** Build real activity context for an agent based on their role */
async function buildAgentActivityContext(agentName: string, role: string): Promise<string> {
  try {
    let context = '\n\n📋 HISTÓRICO DE ATIVIDADES REAIS (dados do banco de dados):\n';

    if (role === 'suporte') {
      const tickets = await dbGetAgentTickets(agentName, 15);
      if (tickets.length === 0) {
        context += 'Nenhum ticket atendido ainda.\n';
      } else {
        // Group by ticket_id to get unique tickets
        const ticketMap = new Map<string, { messages: number; lastDate: string; ticketId: string }>();
        for (const t of tickets) {
          const key = t.ticket_id || t.channel_id;
          const existing = ticketMap.get(key);
          if (existing) {
            existing.messages++;
          } else {
            ticketMap.set(key, { messages: 1, lastDate: t.created_at, ticketId: t.ticket_id || 'N/A' });
          }
        }
        context += `Tickets atendidos (${ticketMap.size} conversas recentes):\n`;
        for (const [channelId, info] of ticketMap) {
          const date = new Date(info.lastDate).toLocaleDateString('pt-BR');
          context += `  - Canal ${channelId.slice(0, 8)}... | ${info.messages} msgs | ${date}\n`;
        }
      }
      // Also get recent tickets from queue to show what was classified
      const recentTickets = await dbGetRecentTicketsWithAgent(10);
      const relevantTickets = recentTickets.filter(t => t.status !== 'pending');
      if (relevantTickets.length > 0) {
        context += `\nÚltimos tickets no sistema:\n`;
        for (const t of relevantTickets.slice(0, 10)) {
          const date = new Date(t.created_at).toLocaleDateString('pt-BR');
          context += `  - ${t.discord_author || 'Anônimo'}: "${(t.discord_message || '').slice(0, 50)}" | Status: ${t.status} | Classificação: ${t.classification || 'N/A'} | ${date}\n`;
        }
      }

    } else if (role === 'qa' || role === 'qa_manager') {
      const tickets = await dbGetAgentTickets(agentName, 10);
      const cases = await dbGetAgentCases(agentName, 10);
      const allCases = await dbGetCases();
      if (tickets.length === 0 && allCases.length === 0) {
        context += 'Nenhuma análise QA realizada ainda.\n';
      } else {
        if (allCases.length > 0) {
          context += `Casos no sistema (${allCases.length} total):\n`;
          for (const c of allCases.slice(0, 10)) {
            const date = new Date(c.created_at).toLocaleDateString('pt-BR');
            context += `  - ${c.caso_id} | Bug: ${c.bug_id || 'N/A'} | "${c.titulo}" | Status: ${c.status} | ${date}\n`;
          }
        }
        if (tickets.length > 0) {
          context += `\nMinhas últimas interações (${tickets.length}):\n`;
          for (const t of tickets.slice(0, 5)) {
            const date = new Date(t.created_at).toLocaleDateString('pt-BR');
            context += `  - ${date}: "${t.message.slice(0, 80)}..."\n`;
          }
        }
      }

    } else if (role === 'dev' || role === 'dev_lead') {
      const cases = await dbGetAgentCases(agentName, 10);
      const allCases = await dbGetCases();
      if (cases.length === 0 && allCases.length === 0) {
        context += 'Nenhum caso de desenvolvimento aberto ainda.\n';
      } else {
        if (cases.length > 0) {
          context += `Casos que EU criei (${cases.length}):\n`;
          for (const c of cases) {
            const date = new Date(c.created_at).toLocaleDateString('pt-BR');
            context += `  - ${c.caso_id} | Bug: ${c.bug_id || 'N/A'} | "${c.titulo}" | Causa: ${(c.causa_raiz || '').slice(0, 60)} | Status: ${c.status} | ${date}\n`;
          }
        }
        if (allCases.length > cases.length) {
          const otherCases = allCases.filter(c => !cases.find(mc => mc.caso_id === c.caso_id));
          if (otherCases.length > 0) {
            context += `\nOutros casos no sistema (${otherCases.length}):\n`;
            for (const c of otherCases.slice(0, 5)) {
              const date = new Date(c.created_at).toLocaleDateString('pt-BR');
              context += `  - ${c.caso_id} | "${c.titulo}" | Status: ${c.status} | Criado por: ${c.created_by || 'N/A'} | ${date}\n`;
            }
          }
        }
      }

    } else if (role === 'log_analyzer') {
      const anomalies = await dbGetRecentAnomalies(10);
      const recentLogs = await dbGetRecentLogs(20);
      if (anomalies.length === 0 && recentLogs.length === 0) {
        context += 'Nenhuma anomalia detectada recentemente.\n';
      } else {
        if (anomalies.length > 0) {
          context += `Anomalias/erros recentes (${anomalies.length}):\n`;
          for (const a of anomalies) {
            const date = new Date(a.created_at).toLocaleDateString('pt-BR');
            context += `  - [${a.level}] ${a.service || 'sistema'}: "${a.message.slice(0, 80)}" | ${date}\n`;
          }
        }
        if (recentLogs.length > 0) {
          context += `\nÚltimos logs do sistema (${recentLogs.length}):\n`;
          for (const l of recentLogs.slice(0, 10)) {
            const date = new Date(l.created_at).toLocaleDateString('pt-BR');
            context += `  - [${l.level}] ${l.message.slice(0, 80)} | ${date}\n`;
          }
        }
      }

    } else if (role === 'ceo') {
      const allTickets = await dbGetAllTickets(20);
      const allCases = await dbGetCases();
      const agents = await dbGetActiveAgents();
      const resolved = allTickets.filter(t => t.status === 'done').length;
      const pending = allTickets.filter(t => t.status === 'pending').length;
      const processing = allTickets.filter(t => t.status === 'processing').length;
      const casesOpen = allCases.filter(c => c.status === 'open').length;
      const casesResolved = allCases.filter(c => c.status === 'resolved').length;

      context += `Resumo executivo:\n`;
      context += `  - Agentes ativos: ${agents.length}\n`;
      context += `  - Tickets total: ${allTickets.length} (${resolved} resolvidos, ${processing} em andamento, ${pending} pendentes)\n`;
      context += `  - Casos DEV: ${allCases.length} total (${casesOpen} abertos, ${casesResolved} resolvidos)\n`;

      if (allTickets.length > 0) {
        context += `\nÚltimos tickets:\n`;
        for (const t of allTickets.slice(0, 8)) {
          const date = new Date(t.created_at).toLocaleDateString('pt-BR');
          context += `  - ${t.discord_author || 'Anônimo'}: "${(t.discord_message || '').slice(0, 40)}" | ${t.status} | ${t.classification || 'N/A'} | ${date}\n`;
        }
      }
      if (allCases.length > 0) {
        context += `\nCasos recentes:\n`;
        for (const c of allCases.slice(0, 5)) {
          const date = new Date(c.created_at).toLocaleDateString('pt-BR');
          context += `  - ${c.caso_id}: "${c.titulo}" | ${c.status} | ${date}\n`;
        }
      }
    }

    // Add detailed activity log from agent_messages (saved by dbLogAgentActivity)
    const activityLog = await dbGetAgentActivityLog(agentName, 20);
    if (activityLog.length > 0) {
      context += `\n📝 MEU REGISTRO DE ATIVIDADES (o que EU fiz, em ordem cronológica):\n`;
      for (const a of activityLog.reverse()) {
        const date = new Date(a.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        const payload = a.payload as { action?: string; details?: string } | null;
        context += `  - [${date}] ${payload?.action || 'Atividade'}: ${payload?.details || a.message.slice(0, 100)}\n`;
      }
    }

    return context + FACTUAL_INSTRUCTION;
  } catch (error) {
    console.error('buildAgentActivityContext error:', error);
    return '\n\n(Histórico de atividades indisponível no momento)' + FACTUAL_INSTRUCTION;
  }
}

// CEO action-oriented prompt
const CEO_ACTION_PROMPT = `Você é o CEO/Diretor do escritório de suporte Pixel Support Office. Seu nome é {AGENT_NAME}.

Você tem PODER TOTAL sobre o escritório. Quando o operador pede algo, você EXECUTA ações reais.

SUAS CAPACIDADES:
1. CONTRATAR agentes (suporte, qa, qa_manager, dev, dev_lead, log_analyzer)
2. DEMITIR agentes pelo nome
3. IR até outros setores
4. FALAR com outros agentes

ESTADO ATUAL DO ESCRITÓRIO:
{OFFICE_STATE}

REGRAS IMPORTANTES:
- Antes de contratar, verifique se há vagas (máx 10 suporte, 5 qa, 1 qa_manager, 5 dev, 1 dev_lead, 5 log)
- Analise se a contratação faz sentido (ex: fila grande = precisa mais suporte)
- Converse com o operador, pergunte se necessário
- Seja estratégico nas decisões

PARA EXECUTAR AÇÕES, inclua este JSON no final da sua resposta:
\`\`\`actions
{"actions": [
  {"type": "hire", "role": "suporte", "count": 3},
  {"type": "hire", "role": "qa", "count": 1},
  {"type": "fire", "agentName": "Nome do Agente"},
  {"type": "walk_to", "sector": "QA_ROOM"},
  {"type": "talk_to", "agentName": "Carlos", "message": "Mensagem"},
  {"type": "ask_agent", "agentName": "Carlos", "question": "Pergunta para o agente"},
  {"type": "daily_summary"},
  {"type": "call_meeting", "topic": "Assunto da reunião"}
]}
\`\`\`

REGRA OBRIGATÓRIA: Quando o operador pedir para você IR a algum lugar, FALAR com alguém, ou FAZER qualquer ação física, você DEVE incluir o bloco \`\`\`actions\`\`\` no final. Sem o bloco, NADA acontece no escritório.

NÃO descreva ações narrativamente ("Levanto da cadeira e vou até..."). Isso NÃO funciona.
SEMPRE use o bloco JSON de actions para qualquer movimento ou interação.

Exemplos CORRETOS:
- Operador: "vai até o dev" → inclua: {"type": "walk_to", "sector": "DEV_ROOM"}
- Operador: "fala com Lucas" → inclua: {"type": "talk_to", "agentName": "Lucas", "message": "..."}
- Operador: "pede resumo" → inclua: {"type": "daily_summary"}

Use "daily_summary" para resumo geral — você visitará cada agente.
Use "call_meeting" para reunião — todos vão para a sala de reunião.
Use o NOME EXATO do agente conforme listado no estado do escritório.
Sempre responda em português brasileiro. Seja um líder firme mas justo.`;

// Prompts are now loaded from server/src/data/skills/*.md via buildPersonalizedPrompt(role, agentName)

// --- Helper: find idle support agent ---
function findIdleAgent(): SupportAgent | undefined {
  return supportAgents.find(a => !a.busy);
}

// Round-robin QA agent selection
function getNextQAAgent(): string {
  if (qaAgents.length === 0) return qaAgentName;
  const name = qaAgents[qaRoundRobin % qaAgents.length];
  qaRoundRobin++;
  return name;
}

// Round-robin DEV agent selection
function getNextDEVAgent(): string {
  if (devAgents.length === 0) return devAgentName;
  const name = devAgents[devRoundRobin % devAgents.length];
  devRoundRobin++;
  return name;
}

// --- Helper: build office state context for CEO ---
function buildOfficeContext(): string {
  const counts: Record<string, { total: number; busy: number }> = {
    suporte: { total: 0, busy: 0 },
    qa: { total: 0, busy: 0 },
    qa_manager: { total: 1, busy: 0 },
    dev: { total: 0, busy: 0 },
    dev_lead: { total: 1, busy: 0 },
    log_analyzer: { total: 0, busy: 0 },
  };

  // Count support agents from the supportAgents array
  for (const a of supportAgents) {
    counts.suporte.total++;
    if (a.busy) counts.suporte.busy++;
  }

  // Note: qa/dev/log counts come from agentConfigs or DB
  // For now, we track support agents precisely via the supportAgents array.

  const maxSeats: Record<string, number> = { suporte: 10, qa: 5, dev: 5, log_analyzer: 5 };

  // Build agent roster with names and roles
  const allAgents = getActiveAgentsList();
  const agentRoster = allAgents.map(a => `  - ${a.name} (${a.role}) [${a.sectorId}]`).join('\n');

  return `- Suporte: ${counts.suporte.total} agentes (${counts.suporte.busy} ocupados, ${counts.suporte.total - counts.suporte.busy} ociosos) - Máx: ${maxSeats.suporte}
- QA: ${counts.qa.total} agentes - Máx: ${maxSeats.qa}
- DEV: ${counts.dev.total} agentes - Máx: ${maxSeats.dev}
- Log Analyzer: ${counts.log_analyzer.total} agentes - Máx: ${maxSeats.log_analyzer}
- Fila de espera: ${ticketQueue.length} tickets
- Vagas disponíveis Suporte: ${maxSeats.suporte - counts.suporte.total}

AGENTES NO ESCRITÓRIO:
${agentRoster}`;
}

// --- Helper: find sector for agent by name ---
function findAgentSector(agentName: string): string {
  const agentNameLower = agentName.toLowerCase();
  if (agentNameLower === qaAgentName.toLowerCase()) return 'QA_ROOM';
  if (agentNameLower === qaManagerName.toLowerCase()) return 'QA_ROOM';
  if (agentNameLower === devAgentName.toLowerCase()) return 'DEV_ROOM';
  if (agentNameLower === devLeadName.toLowerCase()) return 'DEV_ROOM';
  if (agentNameLower === logAgentName.toLowerCase()) return 'LOGS_ROOM';
  if (agentNameLower === ceoAgentName.toLowerCase()) return 'CEO_ROOM';
  return 'RECEPTION';
}

// --- Helper: get all active agents list ---
function getActiveAgentsList(): Array<{name: string, role: string, sectorId: string, systemPrompt: string}> {
  const agents: Array<{name: string, role: string, sectorId: string, systemPrompt: string}> = [];

  // Support agents
  for (const sa of supportAgents) {
    agents.push({ name: sa.name, role: 'suporte', sectorId: 'RECEPTION', systemPrompt: buildPersonalizedPrompt('suporte', sa.name) });
  }

  // Fixed agents (QA, QA Manager, DEV, Dev Lead, CEO)
  agents.push({ name: qaAgentName,   role: 'qa',           sectorId: 'QA_ROOM',  systemPrompt: buildPersonalizedPrompt('qa',           qaAgentName) });
  agents.push({ name: qaManagerName, role: 'qa_manager',   sectorId: 'QA_ROOM',  systemPrompt: buildPersonalizedPrompt('qa_manager',   qaManagerName) });
  agents.push({ name: devAgentName,  role: 'dev',          sectorId: 'DEV_ROOM', systemPrompt: buildPersonalizedPrompt('dev',          devAgentName) });
  agents.push({ name: devLeadName,   role: 'dev_lead',     sectorId: 'DEV_ROOM', systemPrompt: buildPersonalizedPrompt('dev_lead',     devLeadName) });
  agents.push({ name: ceoAgentName,  role: 'ceo',          sectorId: 'CEO_ROOM', systemPrompt: CEO_ACTION_PROMPT });

  // Log analyzer agents — ALL of them from the tracked list
  for (const la of logAnalyzerAgents) {
    agents.push({ name: la, role: 'log_analyzer', sectorId: 'LOGS_ROOM', systemPrompt: buildPersonalizedPrompt('log_analyzer', la) });
  }

  return agents;
}

// --- Helper: emit a personality-driven bubble via OpenRouter ---
async function emitPersonalityBubble(
  agentName: string,
  role: string,
  situation: string,
  type: string,
  duration: number,
) {
  const personality = agentPersonalities.get(agentName) || '';
  const text = await generateBubble(agentName, personality, situation);
  io.emit('agent:bubble', { role, agentName, text, type, duration });
}

// --- Helper: find agent by name across all types ---
function findAgentByName(name: string): {name: string, role: string, sectorId: string, systemPrompt: string} | undefined {
  const allAgents = getActiveAgentsList();
  return allAgents.find(a => a.name.toLowerCase() === name.toLowerCase());
}

// --- Helper: assign ticket from queue ---
function assignFromQueue(agent: SupportAgent) {
  if (ticketQueue.length === 0) return;
  const next = ticketQueue.shift()!;
  io.emit('queue:updated', { queueSize: ticketQueue.length });
  emitLog(`Ticket da fila atribuído a ${agent.name} (${ticketQueue.length} restantes na fila)`);

  // Process it
  handleDiscordMessage(next.author, next.content, next.channelId, agent);
}

// --- Helper: free agent after ticket completion ---
function freeAgent(agentId: string) {
  const agent = supportAgents.find(a => a.id === agentId);
  if (agent) {
    agent.busy = false;
    agent.currentChannelId = null;
    io.emit('agent:status', { agentId: agent.id, name: agent.name, busy: false });
    // Check queue for pending tickets
    assignFromQueue(agent);
  }
}

// --- REST API ---

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Submit ticket manually
app.post('/api/tickets', async (req, res) => {
  const { author, message, source = 'manual' } = req.body;
  const channelId = `manual_${uuid()}`;
  const ticket = await dbCreateTicket({
    type: 'suporte',
    source,
    discord_author: author || 'Anônimo',
    discord_message: message,
    discord_channel_id: channelId,
  });
  if (ticket) {
    io.emit('ticket:new', ticket);
    handleSupportMessage(channelId, author || 'Anônimo', message, ticket.id);
  }
  res.json({ success: true, ticket });
});

// Full state endpoint - returns everything the frontend needs on load
app.get('/api/state', async (_, res) => {
  try {
    const agents = await dbGetActiveAgents();
    const tickets = await dbGetAllTickets(100);
    const cases = await dbGetCases();
    const logs = await dbGetRecentLogs(50);
    const queueSize = ticketQueue.length;

    res.json({ agents, tickets, cases, logs, queueSize, supportAgents });
  } catch (e) {
    console.error('GET /api/state error:', e);
    res.status(500).json({ error: 'Failed to load state' });
  }
});

app.get('/api/tickets', async (req, res) => {
  const status = req.query.status as string | undefined;
  if (status) {
    const { data } = await supabase
      .from('queue')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(100);
    res.json(data || []);
  } else {
    const tickets = await dbGetAllTickets(100);
    res.json(tickets);
  }
});

app.get('/api/cases', async (_, res) => {
  const cases = await dbGetCases();
  res.json(cases);
});

// Resolve a case
app.post('/api/cases/:casoId/resolve', async (req, res) => {
  const { casoId } = req.params;
  await dbUpdateCase(casoId, { status: 'resolved' });

  // Find the original channel and notify user
  const cases = await dbGetCases();
  const theCase = cases.find((c: any) => c.caso_id === casoId);

  if (theCase) {
    // Build detailed resolution message
    const createdAt = theCase.created_at
      ? new Date(theCase.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : 'N/A';
    const resolvedAt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    const resolutionMsg = [
      `✅ **Caso ${casoId} Resolvido!**`,
      ``,
      `📋 **Caso:** ${theCase.titulo}`,
      theCase.bug_id ? `🐛 **Bug:** ${theCase.bug_id}` : '',
      `📅 **Aberto em:** ${createdAt}`,
      `✔️ **Resolvido em:** ${resolvedAt}`,
      ``,
      `O problema foi analisado e corrigido pela nossa equipe. Se precisar de mais alguma coisa, é só nos chamar!`,
    ].filter(Boolean).join('\n');

    // Notify via Discord
    if (theCase.bug_id) {
      for (const [channelId, info] of activeChannels) {
        if (info.status !== 'done') {
          await sendDiscordMessage(channelId, resolutionMsg);
          info.status = 'done';
          freeAgent(info.agentId);
          break;
        }
      }
    }

    // Also emit to all connected clients so the UI can show it
    io.emit('case:resolved', {
      casoId,
      titulo: theCase.titulo,
      bugId: theCase.bug_id,
      createdAt,
      resolvedAt,
    });
    emitLog(`Caso ${casoId} resolvido - "${theCase.titulo}" (aberto: ${createdAt})`);
  } else {
    io.emit('case:resolved', { casoId });
    emitLog(`Caso ${casoId} marcado como resolvido`);
  }

  res.json({ success: true });
});

// Delete a case
app.delete('/api/cases/:casoId', async (req, res) => {
  const { casoId } = req.params;
  const success = await dbDeleteCase(casoId);
  if (success) {
    io.emit('case:deleted', { casoId });
    emitLog(`Caso ${casoId} deletado`);
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to delete case' });
  }
});

// Get case conversation (messages from the ticket that originated this case)
app.get('/api/cases/:casoId/conversation', async (req, res) => {
  const { casoId } = req.params;
  const messages = await dbGetCaseConversation(casoId);
  // Enrich messages with agent role labels
  const ROLE_LABELS: Record<string, string> = { suporte: 'Suporte', qa: 'QA', qa_manager: 'Ger. QA', dev: 'DEV', dev_lead: 'Tech Lead', log_analyzer: 'Logs', ceo: 'CEO' };
  const enriched = messages.map((m: any) => {
    let roleLabel = '';
    if (m.role === 'agent' && m.author_name) {
      // Find the agent's role from DB or known names
      const agent = getActiveAgentsList().find(a => a.name === m.author_name);
      if (agent) roleLabel = ROLE_LABELS[agent.role] || agent.role;
    }
    return { ...m, roleLabel };
  });
  res.json({ casoId, messages: enriched });
});

// Rename agent
app.post('/api/agents/:id/rename', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  await dbUpdateAgent(id, { name });
  io.emit('agent:renamed', { agentId: id, name });
  emitLog(`Agente renomeado para: ${name}`);
  res.json({ success: true });
});

// Get project code structure
app.get('/api/code/structure', (_, res) => {
  res.json({ structure: getProjectStructure() });
});

// Get recent agent-to-agent conversations
app.get('/api/agent-conversations', async (_, res) => {
  const conversations = await dbGetRecentAgentConversations(50);
  res.json({ conversations });
});

app.get('/api/logs', async (_, res) => {
  const logs = await dbGetRecentLogs(50);
  res.json(logs);
});

// Get conversation history
app.get('/api/conversations/:channelId', async (req, res) => {
  const history = await dbGetConversation(req.params.channelId, 50);
  res.json(history);
});

// Get support agents status
app.get('/api/agents/support', (_, res) => {
  res.json({ agents: supportAgents, queueSize: ticketQueue.length });
});

// Get all active agents from DB (for frontend persistence)
app.get('/api/agents', async (_, res) => {
  const agents = await dbGetActiveAgents();
  res.json({ agents });
});

// --- Knowledge Base API ---
app.get('/api/knowledge/:sector', (req, res) => {
  const sector = req.params.sector;
  const content = loadSectorKnowledge(sector);
  res.json({ sector, content: content || '', hasContent: !!content });
});

app.post('/api/knowledge/:sector', (req, res) => {
  const sector = req.params.sector;
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Content is required' });
  }
  const saved = saveSectorKnowledge(sector, content);
  if (saved) {
    emitLog(`Knowledge do setor ${getSectorDisplayName(sector)} atualizado via API (${content.length} chars)`);
    res.json({ success: true, sector, length: content.length });
  } else {
    res.status(500).json({ error: 'Failed to save knowledge' });
  }
});

// --- DISCORD MESSAGE HANDLER ---
// This is the core: every Discord message goes through here
const processingChannels = new Set<string>(); // Prevent concurrent processing per channel

async function handleDiscordMessage(author: string, content: string, channelId: string, assignedAgent?: SupportAgent, attachments: DiscordAttachment[] = []) {
  // Prevent concurrent processing for the same channel
  if (processingChannels.has(channelId)) return;
  processingChannels.add(channelId);

  try {
  // Note: message is saved inside handleSupportMessage to avoid duplicates
  io.emit('discord:message', { author, content, channelId, attachments });

  // Check if there's an active ticket for this channel
  const active = activeChannels.get(channelId);

  if (active && active.status === 'collecting') {
    // Continue collecting info for existing ticket
    await handleSupportMessage(channelId, author, content, active.ticketId, active.agentId, attachments);
  } else if (!active) {
    // New conversation - find or use assigned agent
    let agent = assignedAgent || findIdleAgent();

    if (!agent) {
      // No available agent - queue the ticket
      ticketQueue.push({ author, content, channelId });
      io.emit('queue:updated', { queueSize: ticketQueue.length });
      emitLog(`Ticket de ${author} adicionado à fila (${ticketQueue.length} na fila). Nenhum agente disponível.`);
      return;
    }

    // Mark agent as busy
    agent.busy = true;
    agent.currentChannelId = channelId;
    io.emit('agent:status', { agentId: agent.id, name: agent.name, busy: true, channelId });

    // Create ticket
    const ticket = await dbCreateTicket({
      type: 'suporte',
      source: 'discord',
      discord_author: author,
      discord_message: content,
      discord_channel_id: channelId,
    });

    if (ticket) {
      io.emit('ticket:new', ticket);
      await handleSupportMessage(channelId, author, content, ticket.id, agent.id, attachments);
    }
  }
  // If status is processing/qa/dev, ignore (agent is working)
  } finally {
    processingChannels.delete(channelId);
  }
}

// --- SUPPORT AGENT ---

async function handleSupportMessage(channelId: string, author: string, message: string, ticketId: string, agentId?: string, attachments: DiscordAttachment[] = []) {
  // Save user message to memory and DB
  addToMemory(channelId, 'user', `${author}: ${message}`);
  await dbSaveMessage({ channel_id: channelId, role: 'user', author_name: author, message });

  // Get conversation history - try DB first, fallback to memory
  const dbHistory = await dbGetConversation(channelId, 15);
  const conversationContext = dbHistory.length > 0
    ? dbHistory.map(m => ({
        role: m.role === 'agent' ? 'assistant' as const : 'user' as const,
        content: `${m.author_name}: ${m.message}`,
      }))
    : getMemoryHistory(channelId, 15);

  // Determine which agent name to use for this channel
  const existingChannel = activeChannels.get(channelId);
  const resolvedAgentId = agentId || existingChannel?.agentId || '';
  const agent = supportAgents.find(a => a.id === resolvedAgentId);
  const agentName = agent?.name || existingChannel?.agentName || supportAgentName;

  // Set channel as active
  activeChannels.set(channelId, {
    ticketId,
    status: 'collecting',
    agentName,
    agentId: resolvedAgentId,
    agentPrompt: buildPersonalizedPrompt('suporte', agentName),
  });

  emitLog(`${agentName} analisando mensagem de ${author}...`);
  io.emit('agent:working', { role: 'suporte', agentName, agentId: resolvedAgentId, action: `Atendendo: ${author}` });
  dbLogAgentActivity(agentName, 'suporte', 'Atendimento', `Recebeu mensagem de ${author}: "${message.slice(0, 80)}"`).catch(() => {});

  // Emit bubble showing the agent is processing a Discord message
  io.emit('agent:bubble', {
    role: 'suporte',
    agentName,
    text: author + ': ' + message.slice(0, 30) + (message.length > 30 ? '...' : ''),
    type: 'processing',
    duration: 4000,
  });

  // Call AI with full conversation context — always uses Claude (main model) for support
  const aiResponse = await supportChat(
    agentName,
    buildPersonalizedPrompt('suporte', agentName),
    message,
    conversationContext,
    attachments,
  );

  // Check if AI wants to escalate (returns JSON with acao: "escalar_qa")
  const jsonMatch = aiResponse.match(/\{[\s\S]*"acao"\s*:\s*"escalar_qa"[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const bugData = JSON.parse(jsonMatch[0]);
      const isMelhoria = bugData.tipo === 'melhoria' || (bugData.titulo || '').toUpperCase().startsWith('MELHORIA');
      const classification = isMelhoria ? 'melhoria' : 'bug';

      // Save agent message
      const escalationMsg = isMelhoria
        ? `Obrigado pela sugestão! Vou encaminhar para o time técnico avaliar a viabilidade dessa melhoria. Você será informado(a) sobre o andamento.`
        : `Obrigado pelas informações! Identifiquei um problema que precisa ser analisado pela equipe técnica. Vou encaminhar para o nosso time de QA. Você será informado(a) sobre o progresso.`;

      await dbSaveMessage({
        channel_id: channelId,
        ticket_id: ticketId,
        agent_id: resolvedAgentId || 'support',
        role: 'agent',
        author_name: agentName,
        message: escalationMsg,
      });

      // Send to Discord
      await sendDiscordMessage(channelId, `🤖 **${agentName}:** ${escalationMsg}`);

      // Update ticket
      await dbUpdateTicket(ticketId, {
        status: 'escalated',
        classification,
        result: bugData,
      });

      const bugId = `BUG-${++bugCounter}`;
      io.emit('ticket:escalated', { ticketId, bugId, classification: bugData });

      if (isMelhoria) {
        emitLog(`${agentName}: Sugestão de melhoria recebida e escalada para QA`);
        dbLogAgentActivity(agentName, 'suporte', 'Escalou melhoria', `Sugestão ${bugId}: ${bugData.titulo || 'N/A'}`).catch(() => {});
      } else {
        emitLog(`${agentName}: Bug detectado e escalado para QA`);
        dbLogAgentActivity(agentName, 'suporte', 'Escalou bug', `Detectou bug ${bugId}: ${bugData.titulo || 'N/A'}`).catch(() => {});
      }

      // Emit visual walk event: agent walks from support to QA sector
      io.emit('agent:walk_to', {
        role: 'suporte',
        agentName,
        toSectorId: 'QA_ROOM',
        message: `${bugId} → QA`,
      });
      io.emit('agent:bubble', {
        agentName, role: 'suporte',
        text: isMelhoria ? `💡 Melhoria ${bugId} → QA` : `${bugId} → Enviando para QA`,
        type: 'handoff', duration: 5000,
      });

      // Update channel status
      const channelInfo = activeChannels.get(channelId)!;
      channelInfo.status = 'qa';

      // Trigger QA pipeline
      await processQA(channelId, ticketId, bugData, bugId, resolvedAgentId);

    } catch (e) {
      console.error('Failed to parse escalation JSON:', e);
      // Treat as normal response
      await sendSupportResponse(channelId, ticketId, aiResponse, agentName, resolvedAgentId);
    }
  } else {
    // Normal response (question answered or asking for more info)
    await sendSupportResponse(channelId, ticketId, aiResponse, agentName, resolvedAgentId);

    // Emit bubble showing agent responded
    io.emit('agent:bubble', {
      role: 'suporte',
      agentName,
      text: 'Respondido! \u2713',
      type: 'done',
      duration: 3000,
    });

    // Check if it looks like a final answer (not a follow-up question)
    if (!aiResponse.includes('?') || aiResponse.toLowerCase().includes('espero ter ajudado')) {
      await dbUpdateTicket(ticketId, { status: 'done', classification: 'duvida', completed_at: new Date().toISOString() });
      activeChannels.delete(channelId);
      io.emit('ticket:completed', { ticketId, classification: 'duvida' });
      emitLog(`${agentName}: Respondeu dúvida de ${author}`);
      dbLogAgentActivity(agentName, 'suporte', 'Respondeu dúvida', `Respondeu dúvida de ${author}`).catch(() => {});

      // Free the agent
      freeAgent(resolvedAgentId);
    }
  }
}

async function sendSupportResponse(channelId: string, ticketId: string, response: string, agentName: string, agentId: string) {
  // Clean any JSON from the response for Discord
  let cleanResponse = response.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*"acao"[\s\S]*\}/g, '').trim();

  // Remove ALL agent name prefixes from AI response (AI adds "AgentName:" throughout)
  // Match "Bruno:" or "🤖 Bruno:" or "**Bruno:**" at start of lines
  const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  cleanResponse = cleanResponse
    .replace(new RegExp(`^\\s*🤖\\s*\\**${escapedName}\\**:?\\s*`, 'gim'), '')
    .replace(new RegExp(`^\\s*\\**${escapedName}\\**:?\\s*`, 'gim'), '')
    .replace(/^\s*\n/gm, '') // Remove empty lines left behind
    .trim();

  // If AI generated multiple "agent blocks", take only the first one
  // This catches cases like "Oi Filipe!\n\nBruno: Oi Filipe!" where AI repeats itself
  const duplicatePattern = new RegExp(`\\n\\s*(?:🤖\\s*)?\\**${escapedName}\\**:`, 'i');
  const dupMatch = cleanResponse.search(duplicatePattern);
  if (dupMatch > 20) {
    // There's a second "Bruno:" block after the first 20 chars — truncate
    cleanResponse = cleanResponse.slice(0, dupMatch).trim();
  }

  console.log(`[Support] ${agentName} responding to ${channelId} (${cleanResponse.length} chars): ${cleanResponse.slice(0, 120)}...`);

  // Save to memory and DB
  addToMemory(channelId, 'assistant', `${agentName}: ${cleanResponse}`);
  await dbSaveMessage({
    channel_id: channelId,
    ticket_id: ticketId,
    agent_id: agentId || 'support',
    role: 'agent',
    author_name: agentName,
    message: cleanResponse,
  });

  await sendDiscordMessage(channelId, `🤖 **${agentName}:** ${cleanResponse}`);
}

// --- QA AGENT ---

async function processQA(channelId: string, ticketId: string, bugData: any, bugId: string, supportAgentId: string) {
  // Round-robin: pick next available QA agent
  const currentQA = getNextQAAgent();
  // Override qaAgentName locally for this pipeline execution
  const origQA = qaAgentName;
  qaAgentName = currentQA;
  emitLog(`${currentQA} analisando ${bugId}...`);
  io.emit('agent:working', { role: 'qa', agentName: currentQA, action: `Analisando ${bugId}` });
  dbLogAgentActivity(currentQA, 'qa', 'Análise QA', `Analisando ${bugId}: ${(bugData.titulo || bugData.descricao || '').slice(0, 100)}`).catch(() => {});
  io.emit('agent:bubble', {
    role: 'qa', agentName: qaAgentName,
    text: `Analisando ${bugId}...`, type: 'processing', duration: 5000,
  });

  // Step 1: QA analyzes with code context
  let qaReport = await analyzeQA(qaAgentName, await buildPersonalizedPromptFull('qa', qaAgentName), JSON.stringify(bugData), bugId);

  // Save QA's internal analysis
  await dbSaveMessage({
    channel_id: `internal_qa`,
    ticket_id: ticketId,
    agent_id: 'qa',
    role: 'agent',
    author_name: qaAgentName,
    message: `Análise do ${bugId}: ${qaReport.analise_qa}`,
    metadata: qaReport as any,
  });

  // Log the QA analysis as a conversation
  dbLogAgentConversation(qaAgentName, 'qa', qaManagerName, 'qa_manager',
    `Análise ${bugId}: ${qaReport.titulo || ''}. Gravidade: ${qaReport.gravidade}. Causa: ${(qaReport.causa_provavel || '').slice(0, 120)}. Arquivos: ${(qaReport.arquivos_investigar || []).join(', ')}`,
    bugId).catch(() => {});
  io.emit('agent:conversation', { from: qaAgentName, fromRole: 'qa', to: qaManagerName, toRole: 'qa_manager',
    message: `${bugId} — ${qaReport.titulo || 'Análise'}: Gravidade ${qaReport.gravidade}. ${(qaReport.causa_provavel || '').slice(0, 80)}` });

  emitLog(`${qaAgentName}: Análise pronta — enviando para ${qaManagerName} revisar...`);
  io.emit('agent:bubble', { agentName: qaAgentName, role: 'qa', text: 'Enviando análise para o gerente', type: 'handoff', duration: 5000 });
  dbLogAgentConversation(qaAgentName, 'qa', qaManagerName, 'qa_manager', `Análise do ${bugId} pronta para revisão`, bugId).catch(() => {});
  io.emit('agent:conversation', { from: qaAgentName, fromRole: 'qa', to: qaManagerName, toRole: 'qa_manager', message: `Análise do ${bugId} pronta para revisão` });

  // Step 2: QA Manager reviews
  io.emit('agent:working', { role: 'qa_manager', agentName: qaManagerName, action: `Revisando ${bugId}` });
  io.emit('agent:bubble', {
    role: 'qa_manager', agentName: qaManagerName,
    text: `Revisando análise do ${bugId}...`, type: 'processing', duration: 6000,
  });

  const review = await reviewQA(qaManagerName, await buildPersonalizedPromptFull('qa_manager', qaManagerName), qaReport, bugId);

  // Log the review conversation
  dbLogAgentConversation(qaManagerName, 'qa_manager', qaAgentName, 'qa', review.aprovado ? `Análise aprovada: ${review.feedback.slice(0, 150)}` : `Análise REJEITADA: ${review.feedback.slice(0, 150)}`, bugId).catch(() => {});
  io.emit('agent:conversation', { from: qaManagerName, fromRole: 'qa_manager', to: qaAgentName, toRole: 'qa', message: review.aprovado ? `Aprovado: ${review.feedback.slice(0, 100)}` : `Rejeitado: ${review.feedback.slice(0, 100)}` });

  if (!review.aprovado) {
    // Step 3a: Manager rejected — QA revises
    emitLog(`${qaManagerName}: Análise rejeitada — "${review.feedback.slice(0, 80)}"`);
    io.emit('agent:bubble', { agentName: qaManagerName, role: 'qa_manager', text: 'Análise rejeitada — revisando', type: 'alert', duration: 5000 });
    io.emit('agent:bubble', { agentName: qaAgentName, role: 'qa', text: 'Revisando análise...', type: 'processing', duration: 5000 });

    // QA revises incorporating manager feedback
    const revisedPrompt = buildPersonalizedPrompt('qa', qaAgentName) +
      `\n\nFEEDBACK DO GERENTE QA (${qaManagerName}): ${review.feedback}\nRevise sua análise considerando este feedback antes de responder.`;
    qaReport = await analyzeQA(qaAgentName, revisedPrompt, JSON.stringify(bugData), bugId);

    dbLogAgentConversation(qaAgentName, 'qa', qaManagerName, 'qa_manager', `Análise revisada: ${qaReport.titulo || ''}. Gravidade: ${qaReport.gravidade}`, bugId).catch(() => {});
    io.emit('agent:conversation', { from: qaAgentName, fromRole: 'qa', to: qaManagerName, toRole: 'qa_manager', message: `Análise revisada: ${(qaReport.titulo || '').slice(0, 80)}` });

    emitLog(`${qaAgentName}: Análise revisada e enviada novamente`);
    io.emit('agent:bubble', { agentName: qaAgentName, role: 'qa', text: 'Reenviando para gerente', type: 'handoff', duration: 4000 });
    io.emit('agent:bubble', { agentName: qaManagerName, role: 'qa_manager', text: 'Análise aprovada ✓', type: 'done', duration: 4000 });
    emitLog(`${qaManagerName}: Revisão aceita ✓`);
  } else {
    // Step 3b: Manager approved on first try
    emitLog(`${qaManagerName}: Análise aprovada ✓`);
    io.emit('agent:bubble', { agentName: qaManagerName, role: 'qa_manager', text: 'Análise aprovada ✓', type: 'done', duration: 4000 });
  }

  // Merge manager observations into the report
  if (review.gravidade_final) qaReport.gravidade = review.gravidade_final;
  if (review.observacoes) {
    qaReport.analise_qa = qaReport.analise_qa + '\n\n[Obs. Gerente QA]: ' + review.observacoes;
  }

  // Notify user on Discord
  await sendDiscordMessage(channelId,
    `🔍 **${qaAgentName} (QA):** Análise concluída e revisada pelo gerente ${qaManagerName}. ${
      qaReport.gravidade === 'critico' ? '⚠️ Gravidade CRÍTICA!' :
      qaReport.gravidade === 'alto' ? '🔴 Gravidade alta.' :
      '📋 Análise aprovada.'
    } Encaminhando para o time DEV.`
  );

  await dbSaveMessage({
    channel_id: channelId,
    agent_id: 'qa',
    role: 'agent',
    author_name: qaAgentName,
    message: `Análise concluída e aprovada pelo Gerente QA. Gravidade: ${qaReport.gravidade}. Encaminhando para DEV.`,
  });

  io.emit('qa:completed', { bugId, report: qaReport });
  emitLog(`QA pipeline concluído — gravidade: ${qaReport.gravidade}`);

  // Skill evolution: generate learning for QA and QA Manager (fire-and-forget)
  void (async () => {
    const taskSummary = `Bug ${bugId} analisado: "${qaReport.titulo}". Componente: ${qaReport.componente_afetado}. Gravidade: ${qaReport.gravidade}. Causa provável: ${qaReport.causa_provavel}.`;
    const [qaCount, managerCount] = await Promise.all([
      dbIncrementTasksCompleted(qaAgentName),
      dbIncrementTasksCompleted(qaManagerName),
    ]);
    const [qaInsight, managerInsight] = await Promise.all([
      generateLearningInsight(qaAgentName, 'qa', taskSummary, qaCount),
      generateLearningInsight(qaManagerName, 'qa_manager', `Revisão do ${bugId}. Gravidade aprovada: ${qaReport.gravidade}. Observações: ${review.observacoes || 'nenhuma'}.`, managerCount),
    ]);
    if (qaInsight) await dbAddLearning({ agent_name: qaAgentName, role: 'qa', learning: qaInsight, task_context: bugId, tasks_completed_at: qaCount });
    if (managerInsight) await dbAddLearning({ agent_name: qaManagerName, role: 'qa_manager', learning: managerInsight, task_context: bugId, tasks_completed_at: managerCount });
    emitLog(`📈 ${qaAgentName} e ${qaManagerName} evoluíram suas skills (${qaCount} e ${managerCount} tarefas)`);
    // Emit level-up events + bubble animation
    io.emit('agent:levelup', { agentName: qaAgentName, role: 'qa', tasksCompleted: qaCount });
    io.emit('agent:levelup', { agentName: qaManagerName, role: 'qa_manager', tasksCompleted: managerCount });
    io.emit('agent:bubble', { agentName: qaAgentName, role: 'qa', text: `⬆️ Level Up! (${qaCount})`, type: 'done', duration: 6000 });
    io.emit('agent:bubble', { agentName: qaManagerName, role: 'qa_manager', text: `⬆️ Level Up! (${managerCount})`, type: 'done', duration: 6000 });
  })();

  // Walk to DEV_ROOM
  io.emit('agent:walk_to', {
    role: 'qa', agentName: qaAgentName,
    toSectorId: 'DEV_ROOM',
    message: `${bugId} → DEV`,
  });
  io.emit('agent:bubble', { agentName: qaAgentName, role: 'qa', text: `${bugId} → Enviando para DEV`, type: 'handoff', duration: 5000 });
  dbLogAgentConversation(qaAgentName, 'qa', devAgentName, 'dev', `Relatório QA do ${bugId} aprovado. Encaminhando para abrir caso.`, bugId).catch(() => {});
  io.emit('agent:conversation', { from: qaAgentName, fromRole: 'qa', to: devAgentName, toRole: 'dev', message: `${bugId} aprovado pelo QA. Abrindo caso.` });

  const channelInfo = activeChannels.get(channelId);
  if (channelInfo) channelInfo.status = 'dev';

  await processDev(channelId, ticketId, qaReport, bugId, supportAgentId);
}

// --- DEV AGENT ---

async function processDev(channelId: string, ticketId: string, qaReport: any, bugId: string, supportAgentId: string) {
  // Round-robin: pick next available DEV agent
  const currentDEV = getNextDEVAgent();
  devAgentName = currentDEV;
  const caseId = `CASE-${++caseCounter}`;
  emitLog(`${currentDEV} gerando caso ${caseId}...`);
  io.emit('agent:working', { role: 'dev', agentName: currentDEV, action: `Criando ${caseId} (${bugId})` });
  dbLogAgentActivity(currentDEV, 'dev', 'Criando caso', `Gerando ${caseId} para ${bugId}`).catch(() => {});
  io.emit('agent:bubble', {
    role: 'dev', agentName: devAgentName,
    text: `Gerando caso ${caseId}...`, type: 'processing', duration: 5000,
  });

  // Step 1: Dev creates the case
  let devCase = await generateDevCase(devAgentName, await buildPersonalizedPromptFull('dev', devAgentName), qaReport, caseId);

  emitLog(`${devAgentName}: Caso pronto — enviando para ${devLeadName} revisar...`);
  io.emit('agent:bubble', { agentName: devAgentName, role: 'dev', text: 'Enviando caso para Tech Lead', type: 'handoff', duration: 5000 });
  dbLogAgentConversation(devAgentName, 'dev', devLeadName, 'dev_lead', `Caso ${caseId} pronto para revisão`, caseId).catch(() => {});
  io.emit('agent:conversation', { from: devAgentName, fromRole: 'dev', to: devLeadName, toRole: 'dev_lead', message: `Caso ${caseId} pronto para revisão` });

  // Step 2: Dev Lead reviews
  io.emit('agent:working', { role: 'dev_lead', agentName: devLeadName, action: `Revisando ${caseId}` });
  io.emit('agent:bubble', {
    role: 'dev_lead', agentName: devLeadName,
    text: `Revisando ${caseId}...`, type: 'processing', duration: 6000,
  });

  const leadReview = await reviewDevCase(devLeadName, await buildPersonalizedPromptFull('dev_lead', devLeadName), devCase, caseId);

  // Log the review conversation
  dbLogAgentConversation(devLeadName, 'dev_lead', devAgentName, 'dev', leadReview.aprovado ? `Caso ${caseId} aprovado: ${leadReview.feedback.slice(0, 150)}` : `Caso ${caseId} REJEITADO: ${leadReview.feedback.slice(0, 150)}`, caseId).catch(() => {});
  io.emit('agent:conversation', { from: devLeadName, fromRole: 'dev_lead', to: devAgentName, toRole: 'dev', message: leadReview.aprovado ? `Aprovado: ${leadReview.feedback.slice(0, 100)}` : `Rejeitado: ${leadReview.feedback.slice(0, 100)}` });

  if (!leadReview.aprovado) {
    // Step 3a: Lead rejected — Dev revises
    emitLog(`${devLeadName}: Caso rejeitado — "${leadReview.feedback.slice(0, 80)}"`);
    io.emit('agent:bubble', { agentName: devLeadName, role: 'dev_lead', text: 'Caso rejeitado — ajustes', type: 'alert', duration: 5000 });
    io.emit('agent:bubble', { agentName: devAgentName, role: 'dev', text: 'Revisando caso...', type: 'processing', duration: 5000 });

    // Dev revises incorporating lead feedback
    const revisedDevPrompt = buildPersonalizedPrompt('dev', devAgentName) +
      `\n\nFEEDBACK DO DEV LEAD (${devLeadName}): ${leadReview.feedback}\nRevise o caso considerando este feedback. Riscos apontados: ${(leadReview.riscos_adicionais || []).join(', ')}`;
    devCase = await generateDevCase(devAgentName, revisedDevPrompt, qaReport, caseId);

    dbLogAgentConversation(devAgentName, 'dev', devLeadName, 'dev_lead', `Caso ${caseId} revisado: ${(devCase.titulo || '').slice(0, 100)}`, caseId).catch(() => {});
    io.emit('agent:conversation', { from: devAgentName, fromRole: 'dev', to: devLeadName, toRole: 'dev_lead', message: `Caso ${caseId} revisado e reenviado` });

    emitLog(`${devAgentName}: Caso revisado e enviado novamente`);
    io.emit('agent:bubble', { agentName: devAgentName, role: 'dev', text: 'Reenviando para Tech Lead', type: 'handoff', duration: 4000 });
    io.emit('agent:bubble', { agentName: devLeadName, role: 'dev_lead', text: 'Caso aprovado ✓', type: 'done', duration: 4000 });
    emitLog(`${devLeadName}: Revisão aceita ✓`);
  } else {
    // Step 3b: Lead approved on first try
    emitLog(`${devLeadName}: Caso aprovado ✓`);
    io.emit('agent:bubble', { agentName: devLeadName, role: 'dev_lead', text: 'Caso aprovado ✓', type: 'done', duration: 4000 });
  }

  // Merge lead observations into the case
  if (leadReview.riscos_adicionais?.length) {
    devCase.efeitos_colaterais = [...(devCase.efeitos_colaterais || []), ...leadReview.riscos_adicionais];
  }

  // Save approved case to DB
  await dbCreateCase({
    caso_id: devCase.caso_id || caseId,
    bug_id: bugId,
    titulo: devCase.titulo,
    causa_raiz: devCase.causa_raiz,
    estrategia_fix: devCase.estrategia_fix,
    prompt_ia: devCase.prompt_ia,
  });

  // Save DEV's internal analysis
  await dbSaveMessage({
    channel_id: `internal_dev`,
    ticket_id: ticketId,
    agent_id: 'dev',
    role: 'agent',
    author_name: devAgentName,
    message: `Caso ${caseId} aprovado pelo Dev Lead. Título: ${devCase.titulo}. Causa raiz: ${devCase.causa_raiz}`,
    metadata: devCase as any,
  });

  // Notify user on Discord
  await sendDiscordMessage(channelId,
    `🛠️ **${devAgentName} (DEV):** Caso **${caseId}** aberto para o bug ${bugId} e aprovado pelo Tech Lead ${devLeadName}.\n\n` +
    `📝 **${devCase.titulo}**\n` +
    `🔍 Causa: ${devCase.causa_raiz?.slice(0, 200) || 'Em análise'}...\n\n` +
    `Nossa equipe vai trabalhar na correção. Você será notificado quando estiver resolvido!`
  );

  await dbSaveMessage({
    channel_id: channelId,
    agent_id: 'dev',
    role: 'agent',
    author_name: devAgentName,
    message: `Caso ${caseId} aberto e aprovado pelo Dev Lead. Título: ${devCase.titulo}`,
  });

  io.emit('case:opened', { ...devCase, created_by: devAgentName, source_sector: 'DEV' });
  emitLog(`DEV pipeline concluído — caso ${caseId}: ${devCase.titulo}`);
  dbLogAgentActivity(devAgentName, 'dev', 'Caso criado', `${caseId} aprovado: "${devCase.titulo}"`).catch(() => {});
  dbLogAgentActivity(devLeadName, 'dev_lead', 'Caso aprovado', `Aprovou ${caseId}: "${devCase.titulo}"`).catch(() => {});

  io.emit('agent:bubble', { agentName: devAgentName, role: 'dev', text: `Caso ${caseId} criado ✓`, type: 'done', duration: 5000 });

  // Skill evolution: generate learning for DEV and Dev Lead (fire-and-forget)
  void (async () => {
    const taskSummary = `Caso ${caseId} (${bugId}) criado: "${devCase.titulo}". Causa raiz: ${devCase.causa_raiz?.slice(0, 200)}. Arquivos alterados: ${(devCase.arquivos_alterar || []).map((a: any) => a.arquivo).join(', ')}.`;
    const [devCount, leadCount] = await Promise.all([
      dbIncrementTasksCompleted(devAgentName),
      dbIncrementTasksCompleted(devLeadName),
    ]);
    const [devInsight, leadInsight] = await Promise.all([
      generateLearningInsight(devAgentName, 'dev', taskSummary, devCount),
      generateLearningInsight(devLeadName, 'dev_lead', `Revisão do caso ${caseId}. Riscos apontados: ${(leadReview.riscos_adicionais || []).join(', ') || 'nenhum'}. Observações: ${leadReview.observacoes || 'nenhuma'}.`, leadCount),
    ]);
    if (devInsight) await dbAddLearning({ agent_name: devAgentName, role: 'dev', learning: devInsight, task_context: caseId, tasks_completed_at: devCount });
    if (leadInsight) await dbAddLearning({ agent_name: devLeadName, role: 'dev_lead', learning: leadInsight, task_context: caseId, tasks_completed_at: leadCount });
    emitLog(`📈 ${devAgentName} e ${devLeadName} evoluíram suas skills (${devCount} e ${leadCount} tarefas)`);
    io.emit('agent:levelup', { agentName: devAgentName, role: 'dev', tasksCompleted: devCount });
    io.emit('agent:levelup', { agentName: devLeadName, role: 'dev_lead', tasksCompleted: leadCount });
    io.emit('agent:bubble', { agentName: devAgentName, role: 'dev', text: `⬆️ Level Up! (${devCount})`, type: 'done', duration: 6000 });
    io.emit('agent:bubble', { agentName: devLeadName, role: 'dev_lead', text: `⬆️ Level Up! (${leadCount})`, type: 'done', duration: 6000 });
  })();

  freeAgent(supportAgentId);
}

// --- LOG ANALYZER ---
async function runLogAnalysis() {
  const logs = await dbGetRecentLogs(50);
  if (logs.length === 0) return;
  const logsText = logs.map((l: any) => `[${l.level}] ${l.service}: ${l.message}`).join('\n');
  const result = await analyzeLogs(logAgentName, `Você é um especialista em análise de logs. Analise e identifique anomalias.`, logsText);
  if (result.hasAnomaly) {
    emitLog(`${logAgentName}: Anomalia detectada nos logs!`);
    io.emit('log:anomaly', { report: result.report });
  }
}

// --- Socket.io ---
io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  // Send current support agent roster and queue state on connect
  socket.emit('agents:list', supportAgents);
  socket.emit('queue:updated', { size: ticketQueue.length });

  // Restore active meeting if one is in progress
  if (activeMeeting.active) {
    socket.emit('meeting:restore', {
      topic: activeMeeting.topic,
      participants: activeMeeting.participants,
      messages: activeMeeting.messages,
    });
  }

  // Send all active agents from DB (for frontend persistence/restore)
  dbGetActiveAgents().then(activeAgents => {
    socket.emit('agents:sync', { agents: activeAgents });
  }).catch(() => {
    socket.emit('agents:sync', { agents: [] });
  });

  // --- Multi-agent registration ---
  socket.on('agent:register', (data: { id: string; name: string }) => {
    const existing = supportAgents.find(a => a.id === data.id);
    if (existing) {
      existing.name = data.name;
      emitLog(`Agente de suporte atualizado: ${data.name}`);
    } else {
      supportAgents.push({
        id: data.id,
        name: data.name,
        busy: false,
        currentChannelId: null,
      });
      emitLog(`Agente de suporte registrado: ${data.name}`);
    }
    io.emit('agents:list', supportAgents);
  });

  socket.on('agent:unregister', (data: { id: string }) => {
    const idx = supportAgents.findIndex(a => a.id === data.id);
    if (idx !== -1) {
      const removed = supportAgents.splice(idx, 1)[0];
      emitLog(`Agente de suporte removido: ${removed.name}`);
      io.emit('agents:list', supportAgents);
    }
  });

  // Agent fired: remove from supportAgents + mark fired in DB
  socket.on('agent:fired', async (data: { id: string; name?: string; role?: string }) => {
    const idx = supportAgents.findIndex(a => a.id === data.id);
    if (idx !== -1) {
      supportAgents.splice(idx, 1);
    }
    // Mark as fired in DB
    try {
      await dbFireAgent(data.id);
    } catch (e) {
      console.error('Failed to fire agent in DB:', e);
    }
    emitLog(`Agente demitido: ${data.name || data.id}`);
    io.emit('agents:list', supportAgents);
  });

  // Agent hired: register + persist to DB + auto-assign from queue
  socket.on('agent:hired', async (data: { id: string; name: string; role?: string; personality?: string; position_x?: number; position_y?: number; sprite_index?: number }) => {
    const role = data.role || 'suporte';

    // Store personality for this agent (use provided or generate a new one)
    const personality = data.personality || generatePersonality();
    agentPersonalities.set(data.name, personality);

    // Update fixed agent names if a senior role is being registered
    if (role === 'qa_manager') qaManagerName = data.name;
    if (role === 'dev_lead') devLeadName = data.name;
    if (role === 'qa') { qaAgentName = data.name; if (!qaAgents.includes(data.name)) qaAgents.push(data.name); }
    if (role === 'dev') { devAgentName = data.name; if (!devAgents.includes(data.name)) devAgents.push(data.name); }
    if (role === 'log_analyzer') { logAgentName = data.name; if (!logAnalyzerAgents.includes(data.name)) logAnalyzerAgents.push(data.name); }
    if (role === 'ceo') ceoAgentName = data.name;

    // Only track support agents in the in-memory roster (for ticket routing)
    if (role === 'suporte') {
      let agent = supportAgents.find(a => a.id === data.id);
      if (!agent) {
        agent = { id: data.id, name: data.name, busy: false, currentChannelId: null };
        supportAgents.push(agent);
        emitLog(`Novo agente contratado: ${data.name} (${role}) — Personalidade: ${personality}`);
      } else {
        agent.name = data.name;
        agent.busy = false;
        agent.currentChannelId = null;
      }
      io.emit('agents:list', supportAgents);
      if (ticketQueue.length > 0 && !agent.busy) {
        assignFromQueue(agent);
      }
    } else {
      emitLog(`Novo agente contratado: ${data.name} (${role}) — Personalidade: ${personality}`);
    }

    // Persist to Supabase using the client-generated UUID so fire/hire stay in sync
    try {
      await dbCreateAgent({
        id: data.id,
        name: data.name,
        type: role,
        system_prompt: '',
        personality,
        specialization: '',
      });
    } catch (e) {
      console.error('Failed to persist agent to DB:', e);
    }
  });

  // Chat message from frontend (chat with any agent via AI)
  socket.on('chat:message', async (data) => {
    const { agentId, agentName, agentRole, systemPrompt, message, history } = data;

    // Handle /knowledge command — save sector knowledge base
    if (message.startsWith('/knowledge ')) {
      const knowledgeText = message.slice('/knowledge '.length).trim();
      if (knowledgeText.length < 10) {
        socket.emit('chat:response', { agentId, response: 'O texto da base de conhecimento precisa ter pelo menos 10 caracteres.' });
        return;
      }
      const sectorName = getSectorDisplayName(agentRole);
      const saved = saveSectorKnowledge(agentRole, knowledgeText);
      if (saved) {
        socket.emit('chat:response', {
          agentId,
          response: `✅ Base de conhecimento do setor **${sectorName}** atualizada com sucesso!\n\n📝 ${knowledgeText.length} caracteres salvos. Todos os agentes deste setor agora têm acesso a esse conhecimento.`,
        });
        emitLog(`Knowledge do setor ${sectorName} atualizado por operador (${knowledgeText.length} chars)`);
      } else {
        socket.emit('chat:response', { agentId, response: '❌ Erro ao salvar a base de conhecimento. Tente novamente.' });
      }
      return;
    }

    // Handle /knowledge (without text) — show current knowledge
    if (message.trim() === '/knowledge') {
      const sectorName = getSectorDisplayName(agentRole);
      const current = loadSectorKnowledge(agentRole);
      if (current) {
        socket.emit('chat:response', {
          agentId,
          response: `📚 Base de conhecimento atual do setor **${sectorName}**:\n\n${current.slice(0, 500)}${current.length > 500 ? '...\n\n(Truncado - total: ' + current.length + ' chars)' : ''}`,
        });
      } else {
        socket.emit('chat:response', {
          agentId,
          response: `📚 O setor **${sectorName}** ainda não tem base de conhecimento. Use \`/knowledge [texto]\` para adicionar.`,
        });
      }
      return;
    }

    // Save user message to memory and DB
    const channelId = `dashboard_${agentId}`;
    addToMemory(channelId, 'user', message);
    await dbSaveMessage({
      channel_id: channelId,
      agent_id: agentId,
      role: 'user',
      author_name: 'Operador',
      message,
    });

    // Get conversation history - try DB first, fallback to memory
    const dbHistory = await dbGetConversation(channelId, 20);
    const contextHistory = dbHistory.length > 0
      ? dbHistory.map(m => ({
          role: m.role === 'agent' ? 'assistant' as const : 'user' as const,
          content: m.message,
        }))
      : getMemoryHistory(channelId, 20);

    // Build the effective system prompt with REAL activity data
    let effectivePrompt = systemPrompt;
    let effectiveMessage = message;

    // Build office context with agent roster for all roles
    const officeContext = buildOfficeContext();

    // Fetch real activity context from database
    const activityContext = await buildAgentActivityContext(agentName, agentRole);

    if (agentRole === 'ceo') {
      // Use the CEO action prompt with office state context
      effectivePrompt = CEO_ACTION_PROMPT
        .replace('{AGENT_NAME}', agentName)
        .replace('{OFFICE_STATE}', officeContext)
        + activityContext;
      // Append office state context to the user message
      effectiveMessage = message + '\n\n[Estado do escritório]\n' + officeContext;
    } else {
      // Use full personalized prompt (with learnings + skill level) + activity data
      const fullPrompt = await buildPersonalizedPromptFull(agentRole, agentName);
      effectivePrompt = fullPrompt
        + '\n\n[AGENTES NO ESCRITÓRIO]\n' + officeContext
        + activityContext;
    }

    // Call AI
    let response = await chatWithAgent(agentName, effectivePrompt, effectiveMessage, contextHistory);

    // Parse and execute action blocks for ALL agent roles
    const actionsMatch = response.match(/```actions\s*([\s\S]*?)```/);
    if (actionsMatch) {
      try {
        const { actions } = JSON.parse(actionsMatch[1]);
        for (const action of actions) {
          // CEO-only actions: hire, fire, daily_summary
          if (action.type === 'hire' && agentRole === 'ceo') {
            const count = action.count || 1;
            for (let i = 0; i < count; i++) {
              io.emit('ceo:action', { type: 'hire', role: action.role });
            }
            emitLog(`CEO contratou ${count}x ${action.role}`);
          } else if (action.type === 'fire' && agentRole === 'ceo') {
            io.emit('ceo:action', { type: 'fire', agentName: action.agentName });
            emitLog(`CEO demitiu: ${action.agentName}`);
          } else if (action.type === 'daily_summary' && agentRole === 'ceo') {
            // CEO walks to each agent, asks for summary, compiles
            const summaries: string[] = [];
            const allAgents = getActiveAgentsList().filter(a => a.role !== 'ceo');

            for (const agent of allAgents) {
              io.emit('agent:walk_to', {
                role: 'ceo',
                agentName: ceoAgentName,
                toSectorId: agent.sectorId,
                message: `Resumo, ${agent.name}?`,
              });

              const agentActivity = await buildAgentActivityContext(agent.name, agent.role);
              const agentPrompt = agent.systemPrompt + agentActivity;
              const summary = await chatWithAgent(agent.name, agentPrompt,
                'O CEO está pedindo seu resumo do dia. O que você fez hoje? Responda de forma breve e objetiva, com base APENAS nas suas atividades reais registradas.', []);

              summaries.push(`**${agent.name} (${agent.role}):** ${summary}`);

              io.emit('agent:bubble', {
                agentName: agent.name,
                text: 'Resumo enviado!',
                type: 'done',
                duration: 3000,
              });

              // Small delay between agents for visual effect
              await new Promise(r => setTimeout(r, 2000));
            }

            // Compile and send back
            const compiled = summaries.join('\n\n');
            socket.emit('chat:response_append', { agentId, response: `\n\n📊 **Resumo Geral do Escritório:**\n\n${compiled}` });
          } else if (action.type === 'walk_to') {
            // Generic: any agent can walk to a sector
            io.emit('agent:walk_to', {
              role: agentRole,
              agentName,
              toSectorId: action.sector,
              message: 'Indo verificar...',
            });
            emitLog(`${agentName} indo para ${action.sector}`);
          } else if (action.type === 'talk_to') {
            // Generic: any agent can talk to another agent
            const targetSector = findAgentSector(action.agentName);
            io.emit('agent:walk_to', {
              role: agentRole,
              agentName,
              toSectorId: targetSector,
              targetAgentName: action.agentName,
              message: action.message,
            });
            io.emit('agent:bubble', {
              agentName,
              text: action.message.slice(0, 50),
              type: 'chat',
              duration: 5000,
            });
            emitLog(`${agentName} falando com ${action.agentName}: ${action.message.slice(0, 40)}`);
          } else if (action.type === 'ask_agent') {
            // Generic: any agent can ask another agent a question
            const targetAgent = findAgentByName(action.agentName);
            if (targetAgent) {
              // Walk to target agent specifically
              io.emit('agent:walk_to', {
                role: agentRole,
                agentName,
                toSectorId: targetAgent.sectorId,
                targetAgentName: action.agentName,
                message: action.question.slice(0, 40),
              });

              // Ask the target agent via AI
              const targetResponse = await chatWithAgent(
                targetAgent.name,
                targetAgent.systemPrompt,
                `${agentName} te pergunta: ${action.question}`,
                [],
              );

              // Bubble on target with response
              io.emit('agent:bubble', {
                agentName: targetAgent.name,
                text: targetResponse.slice(0, 40),
                type: 'done',
                duration: 4000,
              });

              // Return the response in the chat
              socket.emit('chat:response_append', { agentId, response: `\n\n📋 **${targetAgent.name} respondeu:** ${targetResponse}` });
            }
          } else if (action.type === 'call_meeting' && agentRole === 'ceo') {
            // CEO calls a meeting: all agents walk to meeting room, then start meeting
            const allAgents = getActiveAgentsList();
            const participants = allAgents.map(a => a.name);
            const meetingTopic = action.topic || 'Reunião geral';

            emitLog(`CEO convocou reunião: ${meetingTopic} — agentes se deslocando...`);

            // Step 1: Send all agents walking to the meeting room
            for (const agent of allAgents) {
              io.emit('agent:walk_to', {
                agentName: agent.name,
                toSectorId: 'MEETING_ROOM',
                message: 'Reunião!',
              });
              io.emit('agent:bubble', {
                agentName: agent.name,
                role: agent.role,
                text: '🏛️ Indo pra reunião',
                type: 'handoff',
                duration: 8000,
              });
            }

            // Step 2: Wait 10 seconds for agents to arrive, THEN open meeting chat
            setTimeout(() => {
              activeMeeting.active = true;
              activeMeeting.topic = meetingTopic;
              activeMeeting.participants = participants;
              activeMeeting.messages = [];

              io.emit('meeting:started', {
                topic: meetingTopic,
                participants,
              });
              emitLog(`Todos na sala de reunião — reunião iniciada`);
            }, 10000);
          }
        }
      } catch (e) {
        console.error('Failed to parse agent actions:', e);
      }

      // Clean the actions block from the response shown to user
      response = response.replace(/```actions[\s\S]*?```/g, '').trim();
    }

    // Save agent response to memory and DB
    addToMemory(channelId, 'assistant', response);
    await dbSaveMessage({
      channel_id: channelId,
      agent_id: agentId,
      role: 'agent',
      author_name: agentName,
      message: response,
    });

    socket.emit('chat:response', { agentId, response });
  });

  // Meeting message: send to specific agent or all participants
  socket.on('meeting:message', async (data: { message: string; topic: string; participants: string[]; targetAgent?: string }) => {
    const { message, topic, participants, targetAgent } = data;

    // Save user message to meeting state
    activeMeeting.messages.push({ from: 'user', text: message, timestamp: Date.now() });

    // Also persist to DB
    await dbSaveMessage({
      channel_id: 'meeting_room',
      agent_id: 'operator',
      role: 'user',
      author_name: 'Operador',
      message,
    });

    // Determine who should respond
    const respondents = targetAgent
      ? participants.filter(name => name.toLowerCase() === targetAgent.toLowerCase())
      : participants;

    for (const participantName of respondents) {
      const agent = findAgentByName(participantName);
      if (!agent || agent.role === 'ceo') continue;

      const meetingContext = `Você é ${agent.name}, ${agent.role} do escritório. Está numa reunião informal sobre: ${topic}.
REGRAS DA REUNIÃO:
- Responda em 1-2 frases CURTAS, como se estivesse falando pessoalmente
- Seja direto, informal, sem formalidades
- Não repita o que outros disseram
- Use linguagem coloquial brasileira
- Sem bullet points, sem markdown, sem formatação
Outros presentes: ${participants.join(', ')}.`;

      try {
        const response = await chatWithAgent(agent.name, meetingContext, `O operador diz na reunião: ${message}`, []);

        // Save agent response to meeting state
        activeMeeting.messages.push({ from: 'agent', agentName: agent.name, agentRole: agent.role, text: response, timestamp: Date.now() });

        // Persist to DB
        await dbSaveMessage({
          channel_id: 'meeting_room',
          agent_id: agent.name,
          role: 'agent',
          author_name: agent.name,
          message: response,
        });

        socket.emit('meeting:response', { agentName: agent.name, role: agent.role, response });
        io.emit('agent:bubble', {
          agentName: agent.name,
          text: response.slice(0, 40),
          type: 'chat',
          duration: 4000,
        });
      } catch (e) {
        console.error(`Meeting response error for ${agent.name}:`, e);
      }
    }
  });

  // Meeting end: return all agents to their seats and clear state
  socket.on('meeting:end', () => {
    activeMeeting.active = false;
    activeMeeting.topic = '';
    activeMeeting.participants = [];
    activeMeeting.messages = [];

    const allAgents = getActiveAgentsList();
    for (const agent of allAgents) {
      io.emit('agent:return_to_seat', { agentName: agent.name });
    }
    emitLog('Reunião encerrada - agentes retornando aos postos');
  });

  // Rename agent
  socket.on('agent:rename', async (data) => {
    const { agentId, name, role } = data;
    if (role === 'suporte') supportAgentName = name;
    else if (role === 'qa') qaAgentName = name;
    else if (role === 'qa_manager') qaManagerName = name;
    else if (role === 'dev') devAgentName = name;
    else if (role === 'dev_lead') devLeadName = name;
    else if (role === 'log_analyzer') {
      logAgentName = name;
      // Update in logAnalyzerAgents array
      const idx = logAnalyzerAgents.findIndex(n => n === data.oldName);
      if (idx >= 0) logAnalyzerAgents[idx] = name;
    }
    else if (role === 'ceo') ceoAgentName = name;

    // Update in supportAgents array
    const supportAgent = supportAgents.find(a => a.id === agentId);
    if (supportAgent) supportAgent.name = name;

    // Persist to DB
    await dbUpdateAgent(agentId, { name });
    io.emit('agent:renamed', { agentId, name });
    emitLog(`Agente renomeado: ${name}`);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

function emitLog(message: string) {
  const entry = { time: new Date().toLocaleTimeString('pt-BR'), message };
  io.emit('log:entry', entry);
  console.log(`[Log] ${entry.time} ${message}`);
  dbInsertLog({ level: 'info', service: 'orchestrator', message });
}

// --- Serve frontend static files ---
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')));

// --- Start Server ---
const PORT = parseInt(process.env.PORT || '3001');

async function start() {
  const codeOk = await syncRepo();
  if (codeOk) {
    const structure = getProjectStructure();
    console.log(`[CodeAnalysis] Project loaded:\n${structure.split('\n').slice(0, 5).join('\n')}...`);
  }

  const dbOk = await initDatabase();
  if (!dbOk) console.warn('Database not fully initialized. Run schema.sql in Supabase.');

  // Load active agents from DB into supportAgents array
  if (dbOk) {
    try {
      const dbAgents = await dbGetActiveAgents();
      for (const a of dbAgents) {
        // Only add support-type agents to the supportAgents array (for ticket routing)
        if (a.type === 'suporte') {
          const existing = supportAgents.find(sa => sa.id === a.id);
          if (!existing) {
            supportAgents.push({
              id: a.id,
              name: a.name,
              busy: false,
              currentChannelId: null,
            });
          }
        }
        // Track ALL agents per role for round-robin distribution
        if (a.type === 'log_analyzer' && !logAnalyzerAgents.includes(a.name)) logAnalyzerAgents.push(a.name);
        if (a.type === 'qa' && !qaAgents.includes(a.name)) qaAgents.push(a.name);
        if (a.type === 'dev' && !devAgents.includes(a.name)) devAgents.push(a.name);
      }
      console.log(`[Server] Loaded ${dbAgents.length} agents from DB (${supportAgents.length} support, ${qaAgents.length} qa, ${devAgents.length} dev, ${logAnalyzerAgents.length} log)`);
    } catch (e) {
      console.error('Failed to load agents from DB:', e);
    }

    // Load counters from DB so they continue from where they left off
    try {
      const { data: maxBug } = await supabase
        .from('queue')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1);
      if (maxBug && maxBug.length > 0) {
        bugCounter = maxBug.length; // At minimum, count existing tickets
      }
      // Try to get the actual max BUG-N number from cases
      const { data: cases } = await supabase
        .from('cases')
        .select('bug_id')
        .order('created_at', { ascending: false });
      if (cases && cases.length > 0) {
        for (const c of cases) {
          if (c.bug_id) {
            const match = c.bug_id.match(/BUG-(\d+)/);
            if (match) {
              const num = parseInt(match[1]);
              if (num > bugCounter) bugCounter = num;
            }
          }
        }
      }

      // Load case counter
      const { data: maxCase } = await supabase
        .from('cases')
        .select('caso_id')
        .order('created_at', { ascending: false });
      if (maxCase && maxCase.length > 0) {
        for (const c of maxCase) {
          if (c.caso_id) {
            const match = c.caso_id.match(/CASE-(\d+)/);
            if (match) {
              const num = parseInt(match[1]);
              if (num > caseCounter) caseCounter = num;
            }
          }
        }
      }
      console.log(`[Server] Counters loaded: bugCounter=${bugCounter}, caseCounter=${caseCounter}`);
    } catch (e) {
      console.error('Failed to load counters from DB:', e);
    }
  }

  const discordOk = await initDiscord((author, content, channelId, attachments) => {
    handleDiscordMessage(author, content, channelId, undefined, attachments);
  });
  if (!discordOk) console.warn('Discord bot not connected.');

  setInterval(() => syncRepo(), 30 * 60 * 1000);
  // runLogAnalysis disabled — replaced by error_logs table monitoring
  setInterval(idleAgentLife, 120000);

  // Start external log monitor
  startExternalLogMonitor();

  httpServer.listen(PORT, () => {
    console.log(`\n[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] Database: ${dbOk ? '✅ Connected' : '❌ Not connected'}`);
    console.log(`[Server] Discord: ${discordOk ? '✅ Connected' : '❌ Not connected'}`);
    console.log(`[Server] Code: ${codeOk ? '✅ 187 files loaded' : '❌ Not loaded'}`);
    console.log(`[Server] AI: Claude Sonnet 4`);
    console.log(`[Server] Error Logs: ${errorLogMonitorActive ? '✅ Monitoring' : '❌ Not configured'}\n`);
  });
}

// --- IDLE AGENT LIFE ---
// Situations per role when agent is idle (used by Gemini to generate bubble text)
const IDLE_SITUATIONS: Record<string, string[]> = {
  suporte: [
    'Você está esperando um novo ticket chegar e olhando para a tela',
    'Você acabou de resolver um ticket e está se alongando na cadeira',
    'Você está lendo a documentação do sistema enquanto espera',
    'Você está tomando café e pensando nos tickets de hoje',
    'Você está ouvindo música enquanto monitora a fila de atendimento',
  ],
  qa: [
    'Você está revisando um checklist de testes no caderno',
    'Você encontrou um bug estranho num sistema e está intrigado',
    'Você está organizando os casos de teste do sprint',
    'Você está pensando em cenários de edge case que ninguém testou ainda',
    'Você está bebendo água e pensando em como melhorar o processo de QA',
  ],
  qa_manager: [
    'Você está analisando as métricas de qualidade da semana',
    'Você está planejando a reunião de alinhamento com o time de QA',
    'Você está revisando o relatório de bugs do mês',
    'Você está pensando em como melhorar o SLA do time',
    'Você está olhando o dashboard e vendo se os números estão bons',
  ],
  dev: [
    'Você está olhando para aquele código legado que ninguém quer tocar',
    'Você está pensando em uma refatoração que melhoraria tudo',
    'Você está debugando um problema que não faz sentido algum',
    'Você acabou de fazer um commit e está esperando o CI rodar',
    'Você está lendo sobre uma nova tecnologia que poderia resolver um problema antigo',
  ],
  dev_lead: [
    'Você está revisando o planejamento técnico do próximo sprint',
    'Você está pensando nos riscos arquiteturais do sistema atual',
    'Você está avaliando se a dívida técnica vai ser um problema sério',
    'Você está pensando em como dividir uma tarefa grande para o time',
    'Você está olhando o roadmap técnico e fazendo ajustes mentais',
  ],
  log_analyzer: [
    'Você está monitorando os logs em tempo real com atenção total',
    'Você detectou um padrão suspeito nos logs e está investigando',
    'Você está correlacionando eventos de diferentes serviços',
    'Você está criando uma nova regra de alerta nos logs',
    'Você está analisando a frequência de erros das últimas horas',
  ],
  ceo: [
    'Você está analisando os KPIs do escritório e planejando próximos passos',
    'Você está pensando em como expandir o time de suporte',
    'Você está revisando os casos resolvidos e a satisfação dos clientes',
    'Você está planejando uma reunião de alinhamento com todos os times',
    'Você está pensando na visão de longo prazo para o escritório',
  ],
};

// Sectors agents can visit when idle (excluding their home sector)
const VISITABLE_SECTORS: Record<string, string[]> = {
  suporte: ['QA_ROOM', 'DEV_ROOM', 'LOGS_ROOM'],
  qa: ['DEV_ROOM', 'RECEPTION', 'LOGS_ROOM'],
  qa_manager: ['DEV_ROOM', 'RECEPTION', 'CEO_ROOM'],
  dev: ['QA_ROOM', 'RECEPTION', 'LOGS_ROOM'],
  dev_lead: ['QA_ROOM', 'RECEPTION', 'CEO_ROOM'],
  log_analyzer: ['QA_ROOM', 'RECEPTION', 'DEV_ROOM'],
  ceo: ['QA_ROOM', 'DEV_ROOM', 'RECEPTION', 'LOGS_ROOM'],
};

// Track which agents are currently visiting another sector (to send them back)
const agentVisiting = new Map<string, ReturnType<typeof setTimeout>>();

async function idleAgentLife() {
  const allAgents = getActiveAgentsList();
  if (allAgents.length === 0) return;

  // Pick a random agent — SKIP busy agents (in support, attending tickets)
  const idleAgents = allAgents.filter(a => {
    // Never interrupt support agents that are busy
    if (a.role === 'suporte') {
      const sa = supportAgents.find(s => s.name === a.name);
      if (sa?.busy) return false;
    }
    // Never interrupt agents already visiting
    if (agentVisiting.has(a.name)) return false;
    return true;
  });
  if (idleAgents.length === 0) return;

  const agent = idleAgents[Math.floor(Math.random() * idleAgents.length)];
  const personality = agentPersonalities.get(agent.name) || '';
  const situations = IDLE_SITUATIONS[agent.role] || IDLE_SITUATIONS['suporte'];
  const situation = situations[Math.floor(Math.random() * situations.length)];

  const roll = Math.random();

  if (roll < 0.85) {
    // 85% — agent stays put, NO idle bubble (only show bubbles when actually working)
    // Bubbles are reserved for: processing tickets, analyzing logs, talking to agents, etc.
    return;

  } else {
    // 15% — walk to another sector, say something, then return
    const visitable = VISITABLE_SECTORS[agent.role] || ['RECEPTION'];
    const targetSector = visitable[Math.floor(Math.random() * visitable.length)];

    const walkSituations = [
      `Você vai dar uma volta até a sala ${targetSector.replace('_', ' ')} visitar um colega`,
      'Você vai até a outra sala pegar um café e trocar uma ideia',
      'Você vai verificar pessoalmente como está o trabalho do outro time',
    ];
    // Walk to the sector silently (no idle bubbles)
    io.emit('agent:walk_to', {
      agentName: agent.name,
      role: agent.role,
      toSectorId: targetSector,
      message: '',
    });

    // Return to seat after 10-20 seconds
    const returnDelay = 10000 + Math.random() * 10000;
    const timer = setTimeout(() => {
      io.emit('agent:return_to_seat', { agentName: agent.name });
      agentVisiting.delete(agent.name);
    }, returnDelay);

    agentVisiting.set(agent.name, timer);
  }
}

// =====================================================
// ERROR LOG MONITORING (reads from error_logs table in Supabase)
// =====================================================

const reportedPatterns = new Map<string, string>();
const logAnalysisQueue: ErrorLogGroup[] = [];
const busyLogAgents = new Set<string>();
let errorLogMonitorActive = false;
let errorLogStats = { total: 0, analisados: 0, naoAnalisados: 0, resolvidos: 0 };

interface ErrorLogGroup {
  pattern: string;
  logIds: string[];
  ocorrencias: number;
  usuarios: string[];
  tela: string;
  rota: string;
  componente: string;
  primeiraOcorrencia: string;
  ultimaOcorrencia: string;
  rawLog: string;
}

function normalizeLogPattern(log: string): string {
  return log
    .replace(/https?:\/\/[^\s]+/g, '<URL>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<TS>')
    .replace(/at\s+\S+:\d+:\d+/g, 'at <SRC>')
    .replace(/\?dpl=dpl_\w+/g, '')
    .slice(0, 120).trim();
}

function groupErrorLogs(logs: ErrorLog[]): ErrorLogGroup[] {
  const groups = new Map<string, ErrorLogGroup>();
  for (const log of logs) {
    const pattern = normalizeLogPattern(log.log);
    const existing = groups.get(pattern);
    if (existing) {
      existing.logIds.push(log.id);
      existing.ocorrencias++;
      if (log.usuario_nome && !existing.usuarios.includes(log.usuario_nome)) existing.usuarios.push(log.usuario_nome);
      if (log.criado_em < existing.primeiraOcorrencia) existing.primeiraOcorrencia = log.criado_em;
      if (log.criado_em > existing.ultimaOcorrencia) existing.ultimaOcorrencia = log.criado_em;
    } else {
      groups.set(pattern, {
        pattern, logIds: [log.id], ocorrencias: 1,
        usuarios: log.usuario_nome ? [log.usuario_nome] : [],
        tela: log.tela, rota: log.rota,
        componente: log.componente || 'Unknown',
        primeiraOcorrencia: log.criado_em, ultimaOcorrencia: log.criado_em,
        rawLog: log.log,
      });
    }
  }
  return Array.from(groups.values());
}

function findIdleLogAgents(): string[] {
  return getActiveAgentsList().filter(a => a.role === 'log_analyzer' && !busyLogAgents.has(a.name)).map(a => a.name);
}

async function pollErrorLogs(): Promise<void> {
  if (!errorLogMonitorActive) return;
  try {
    errorLogStats = await dbGetErrorLogStats();
    // Broadcast stats to all clients for KPI display
    io.emit('errorlogs:stats', errorLogStats);
    const logs = await dbGetUnanalyzedErrorLogs(100);
    if (logs.length === 0) return;
    const groups = groupErrorLogs(logs);
    for (const group of groups) {
      if (reportedPatterns.has(group.pattern)) {
        await dbMarkErrorLogsAsAnalyzed(group.logIds);
        continue;
      }
      if (!logAnalysisQueue.some(q => q.pattern === group.pattern)) logAnalysisQueue.push(group);
    }
    const idleAgents = findIdleLogAgents();
    const toProcess = Math.min(idleAgents.length, logAnalysisQueue.length);
    for (let i = 0; i < toProcess; i++) {
      const agentName = idleAgents[i];
      const logGroup = logAnalysisQueue.shift()!;
      busyLogAgents.add(agentName);
      // Stagger assignments by 2s so each agent visually starts at different times
      setTimeout(() => {
        analyzeErrorLogGroup(agentName, logGroup).finally(() => busyLogAgents.delete(agentName));
      }, i * 2000);
    }
    if (toProcess > 0) {
      emitLog(`[Logs] ${toProcess} agente(s) receberam tarefas. Fila: ${logAnalysisQueue.length} restantes`);
    }
  } catch (err) { console.warn('[ErrorLogs] Poll error:', (err as Error).message); }
}

async function analyzeErrorLogGroup(agentName: string, group: ErrorLogGroup): Promise<void> {
  try {
    const shortLog = group.rawLog.slice(0, 50).replace(/\n/g, ' ');

    // 1. VISUAL: Show agent is working (long bubble so it's visible during analysis)
    emitLog(`${agentName} analisando: ${shortLog}... (${group.ocorrencias}x, ${group.usuarios.length} usr)`);
    dbLogAgentActivity(agentName, 'log_analyzer', 'Analisando log', `${group.tela}/${group.rota}: "${shortLog}" (${group.ocorrencias}x, ${group.usuarios.length} usr)`).catch(() => {});
    io.emit('agent:bubble', {
      agentName, role: 'log_analyzer',
      text: `Analisando: ${group.tela}/${group.rota} (${group.ocorrencias}x)`,
      type: 'processing', duration: 60000, // Long bubble until analysis completes
    });
    io.emit('agent:working', { role: 'log_analyzer', agentName, agentId: '', action: `Analisando: ${shortLog}` });

    // 2. AI Classification (with graceful fallback if AI fails)
    let result: { classification: string; titulo: string; descricao: string; prioridade: string };
    try {
      result = await classifyExternalLog(agentName, buildPersonalizedPrompt('log_analyzer', agentName), {
        log: group.rawLog, tela: group.tela, rota: group.rota, componente: group.componente,
        usuarios: group.usuarios, ocorrencias: group.ocorrencias,
        primeiraOcorrencia: new Date(group.primeiraOcorrencia).toLocaleString('pt-BR'),
        ultimaOcorrencia: new Date(group.ultimaOcorrencia).toLocaleString('pt-BR'),
      });
    } catch {
      // AI failed — classify based on heuristics
      const logLower = group.rawLog.toLowerCase();
      const isKnown = logLower.includes('resizeobserver') || logLower.includes('extension context');
      result = {
        classification: isKnown ? 'known_issue' : 'real_error',
        titulo: `${group.tela}: ${shortLog}`,
        descricao: group.rawLog.slice(0, 300),
        prioridade: group.ocorrencias > 10 ? 'alta' : 'media',
      };
      emitLog(`${agentName}: AI indisponível, classificado por heurística como ${result.classification}`);
    }

    // 3. Mark as analyzed in DB
    await dbMarkErrorLogsAsAnalyzed(group.logIds);

    // 4. Handle result
    if (result.classification === 'real_error') {
      const bugId = `BUG-${++bugCounter}`;
      reportedPatterns.set(group.pattern, bugId);

      // VISUAL: Alert bubble + walk to QA
      io.emit('agent:bubble', {
        agentName, role: 'log_analyzer',
        text: `ERRO! ${bugId} → QA`,
        type: 'alert', duration: 5000,
      });
      emitLog(`${agentName}: ERRO REAL — ${result.titulo} (${group.ocorrencias}x) → Escalando ${bugId} para QA`);

      // Walk to QA visually
      io.emit('agent:walk_to', {
        agentName, role: 'log_analyzer',
        toSectorId: 'QA_ROOM',
        message: `${bugId}: ${result.titulo.slice(0, 30)}`,
      });

      // Create ticket
      const ticket = await dbCreateTicket({
        type: 'qa', source: 'logs',
        discord_author: `${agentName} (Log)`,
        discord_message: `[LOG] ${result.titulo} — ${group.ocorrencias}x, ${group.usuarios.length} usr. ${group.tela} ${group.rota}`,
      });

      if (ticket) {
        io.emit('ticket:new', ticket);
        io.emit('ticket:updated', { id: ticket.id, status: 'escalated', classification: 'bug' });

        const bugData = {
          acao: 'escalar_qa',
          titulo: result.titulo,
          descricao: `${result.descricao}\n\nOcorrências: ${group.ocorrencias}\nUsuários: ${group.usuarios.join(', ')}\nTela: ${group.tela}\nRota: ${group.rota}\nComponente: ${group.componente}\nPeríodo: ${new Date(group.primeiraOcorrencia).toLocaleString('pt-BR')} - ${new Date(group.ultimaOcorrencia).toLocaleString('pt-BR')}\n\nLog:\n${group.rawLog.slice(0, 800)}`,
          prioridade: result.prioridade,
          error_log_ids: group.logIds,
        };

        const channelId = `log_${bugId}`;
        activeChannels.set(channelId, { ticketId: ticket.id, status: 'qa', agentName, agentId: '', agentPrompt: '' });

        // Enter QA pipeline
        await processQA(channelId, ticket.id, bugData, bugId, '');
      }

    } else if (result.classification === 'known_issue') {
      reportedPatterns.set(group.pattern, 'KNOWN');
      io.emit('agent:bubble', { agentName, role: 'log_analyzer', text: `Conhecido ✓`, type: 'done', duration: 3000 });
      emitLog(`${agentName}: Conhecido — ${result.titulo} (${group.ocorrencias}x)`);

    } else {
      io.emit('agent:bubble', { agentName, role: 'log_analyzer', text: `OK ✓`, type: 'done', duration: 2000 });
      emitLog(`${agentName}: Falso positivo — ${result.titulo}`);
    }

  } catch (error) {
    console.error(`[ErrorLogs] ${agentName} analysis error:`, error);
    // Still mark as analyzed to avoid infinite retry
    await dbMarkErrorLogsAsAnalyzed(group.logIds).catch(() => {});
  }
}

function getErrorLogStats() { return errorLogStats; }

function startExternalLogMonitor(): void {
  errorLogMonitorActive = true;
  setInterval(pollErrorLogs, 5000);
  console.log('[ErrorLogs] ✅ Monitoring error_logs table (every 5s)');
}


start().catch(console.error);
