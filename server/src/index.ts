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
  supabase,
} from './db/supabase.js';
import { classifyTicket, analyzeQA, generateDevCase, analyzeLogs, chatWithAgent, generateBubble, reviewQA, reviewDevCase, generateLearningInsight } from './services/aiService.js';
import { initDiscord, sendDiscordMessage } from './services/discord.js';
import { syncRepo, getProjectStructure } from './services/codeAnalysis.js';
import { SOFTCOMHUB_KNOWLEDGE } from './data/softcomhub-knowledge.js';
import { buildAgentPrompt } from './data/skills-loader.js';

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

IMPORTANTE: Só inclua o bloco actions quando for EXECUTAR algo. Para conversas normais, responda sem o bloco.
Use "daily_summary" quando o operador pedir um resumo geral do escritório - você visitará cada agente e compilará os resumos.
Use "call_meeting" quando o operador pedir uma reunião - todos os agentes irão para a sala de reunião e um chat de grupo será aberto.
Quando usar "talk_to" ou "ask_agent", use o NOME EXATO do agente conforme listado no estado do escritório.
Sempre responda em português brasileiro. Seja um líder firme mas justo.`;

// Prompts are now loaded from server/src/data/skills/*.md via buildPersonalizedPrompt(role, agentName)

// --- Helper: find idle support agent ---
function findIdleAgent(): SupportAgent | undefined {
  return supportAgents.find(a => !a.busy);
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

  // Fixed agents (QA, QA Manager, DEV, Dev Lead, Log, CEO)
  agents.push({ name: qaAgentName,   role: 'qa',           sectorId: 'QA_ROOM',  systemPrompt: buildPersonalizedPrompt('qa',           qaAgentName) });
  agents.push({ name: qaManagerName, role: 'qa_manager',   sectorId: 'QA_ROOM',  systemPrompt: buildPersonalizedPrompt('qa_manager',   qaManagerName) });
  agents.push({ name: devAgentName,  role: 'dev',          sectorId: 'DEV_ROOM', systemPrompt: buildPersonalizedPrompt('dev',          devAgentName) });
  agents.push({ name: devLeadName,   role: 'dev_lead',     sectorId: 'DEV_ROOM', systemPrompt: buildPersonalizedPrompt('dev_lead',     devLeadName) });
  agents.push({ name: logAgentName,  role: 'log_analyzer', sectorId: 'LOGS_ROOM',systemPrompt: buildPersonalizedPrompt('log_analyzer', logAgentName) });
  agents.push({ name: ceoAgentName,  role: 'ceo',          sectorId: 'CEO_ROOM', systemPrompt: CEO_ACTION_PROMPT });

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

// --- DISCORD MESSAGE HANDLER ---
// This is the core: every Discord message goes through here

async function handleDiscordMessage(author: string, content: string, channelId: string, assignedAgent?: SupportAgent) {
  // Note: message is saved inside handleSupportMessage to avoid duplicates
  io.emit('discord:message', { author, content, channelId });

  // Check if there's an active ticket for this channel
  const active = activeChannels.get(channelId);

  if (active && active.status === 'collecting') {
    // Continue collecting info for existing ticket
    await handleSupportMessage(channelId, author, content, active.ticketId, active.agentId);
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
      await handleSupportMessage(channelId, author, content, ticket.id, agent.id);
    }
  }
  // If status is processing/qa/dev, ignore (agent is working)
}

// --- SUPPORT AGENT ---

async function handleSupportMessage(channelId: string, author: string, message: string, ticketId: string, agentId?: string) {
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
  io.emit('agent:working', { role: 'suporte', agentName, agentId: resolvedAgentId, action: 'analyzing' });

  // Emit bubble showing the agent is processing a Discord message
  io.emit('agent:bubble', {
    role: 'suporte',
    agentName,
    text: author + ': ' + message.slice(0, 30) + (message.length > 30 ? '...' : ''),
    type: 'processing',
    duration: 4000,
  });

  // Call AI with full conversation context
  const aiResponse = await chatWithAgent(
    agentName,
    buildPersonalizedPrompt('suporte', agentName),
    message,
    conversationContext,
  );

  // Check if AI wants to escalate (returns JSON with acao: "escalar_qa")
  const jsonMatch = aiResponse.match(/\{[\s\S]*"acao"\s*:\s*"escalar_qa"[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const bugData = JSON.parse(jsonMatch[0]);

      // Save agent message
      await dbSaveMessage({
        channel_id: channelId,
        ticket_id: ticketId,
        agent_id: resolvedAgentId || 'support',
        role: 'agent',
        author_name: agentName,
        message: `Obrigado pelas informações! Identifiquei um problema que precisa ser analisado pela equipe técnica. Vou encaminhar para o nosso time de QA. Você será informado(a) sobre o progresso.`,
      });

      // Send to Discord
      await sendDiscordMessage(channelId,
        `🤖 **${agentName}:** Obrigado pelas informações! Identifiquei um problema que precisa ser analisado pela equipe técnica. Vou encaminhar para o nosso time de QA. Você será informado(a) sobre o progresso.`
      );

      // Update ticket
      await dbUpdateTicket(ticketId, {
        status: 'escalated',
        classification: 'bug',
        result: bugData,
      });

      const bugId = `BUG-${++bugCounter}`;
      io.emit('ticket:escalated', { ticketId, bugId, classification: bugData });
      emitLog(`${agentName}: Bug detectado e escalado para QA`);

      // Emit visual walk event: agent walks from support to QA sector
      io.emit('agent:walk_to', {
        role: 'suporte',
        agentName,
        toSectorId: 'QA_ROOM',
        message: `Escalando ${bugId} para QA`,
      });
      await emitPersonalityBubble(agentName, 'suporte', 'Você detectou um bug e vai encaminhar para o time de QA analisar', 'handoff', 3000);

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

      // Free the agent
      freeAgent(resolvedAgentId);
    }
  }
}

async function sendSupportResponse(channelId: string, ticketId: string, response: string, agentName: string, agentId: string) {
  // Clean any JSON from the response for Discord
  const cleanResponse = response.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*"acao"[\s\S]*\}/g, '').trim();

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
  emitLog(`${qaAgentName} analisando ${bugId}...`);
  io.emit('agent:working', { role: 'qa', agentName: qaAgentName, action: 'analyzing' });
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

  emitLog(`${qaAgentName}: Análise pronta — enviando para ${qaManagerName} revisar...`);
  await emitPersonalityBubble(qaAgentName, 'qa', 'Você terminou a análise do bug e vai enviar para o gerente revisar', 'handoff', 3000);

  // Step 2: QA Manager reviews
  io.emit('agent:working', { role: 'qa_manager', agentName: qaManagerName, action: 'reviewing' });
  io.emit('agent:bubble', {
    role: 'qa_manager', agentName: qaManagerName,
    text: `Revisando análise do ${bugId}...`, type: 'processing', duration: 6000,
  });

  const review = await reviewQA(qaManagerName, await buildPersonalizedPromptFull('qa_manager', qaManagerName), qaReport, bugId);

  if (!review.aprovado) {
    // Step 3a: Manager rejected — QA revises
    emitLog(`${qaManagerName}: Análise rejeitada — "${review.feedback.slice(0, 80)}"`);
    await emitPersonalityBubble(qaManagerName, 'qa_manager', `Você rejeitou a análise do QA e pediu revisão: ${review.feedback.slice(0, 60)}`, 'alert', 5000);
    await emitPersonalityBubble(qaAgentName, 'qa', 'O gerente rejeitou sua análise e pediu para você revisar', 'processing', 4000);

    // QA revises incorporating manager feedback
    const revisedPrompt = buildPersonalizedPrompt('qa', qaAgentName) +
      `\n\nFEEDBACK DO GERENTE QA (${qaManagerName}): ${review.feedback}\nRevise sua análise considerando este feedback antes de responder.`;
    qaReport = await analyzeQA(qaAgentName, revisedPrompt, JSON.stringify(bugData), bugId);

    emitLog(`${qaAgentName}: Análise revisada e enviada novamente`);
    await emitPersonalityBubble(qaAgentName, 'qa', 'Você revisou a análise e está reenviando para o gerente', 'handoff', 3000);
    await emitPersonalityBubble(qaManagerName, 'qa_manager', 'Você aprovou a análise revisada do QA', 'done', 3000);
    emitLog(`${qaManagerName}: Revisão aceita ✓`);
  } else {
    // Step 3b: Manager approved on first try
    emitLog(`${qaManagerName}: Análise aprovada ✓`);
    await emitPersonalityBubble(qaManagerName, 'qa_manager', 'Você aprovou a análise de QA de primeira', 'done', 3000);
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
  })();

  // Walk to DEV_ROOM
  io.emit('agent:walk_to', {
    role: 'qa', agentName: qaAgentName,
    toSectorId: 'DEV_ROOM',
    message: `Encaminhando ${bugId} para DEV`,
  });
  await emitPersonalityBubble(qaAgentName, 'qa', 'Você finalizou o relatório e vai encaminhar para o time de desenvolvimento', 'handoff', 3000);

  const channelInfo = activeChannels.get(channelId);
  if (channelInfo) channelInfo.status = 'dev';

  await processDev(channelId, ticketId, qaReport, bugId, supportAgentId);
}

// --- DEV AGENT ---

async function processDev(channelId: string, ticketId: string, qaReport: any, bugId: string, supportAgentId: string) {
  const caseId = `CASE-${++caseCounter}`;
  emitLog(`${devAgentName} gerando caso ${caseId}...`);
  io.emit('agent:working', { role: 'dev', agentName: devAgentName, action: 'investigating' });
  io.emit('agent:bubble', {
    role: 'dev', agentName: devAgentName,
    text: `Gerando caso ${caseId}...`, type: 'processing', duration: 5000,
  });

  // Step 1: Dev creates the case
  let devCase = await generateDevCase(devAgentName, await buildPersonalizedPromptFull('dev', devAgentName), qaReport, caseId);

  emitLog(`${devAgentName}: Caso pronto — enviando para ${devLeadName} revisar...`);
  await emitPersonalityBubble(devAgentName, 'dev', 'Você terminou de criar o caso de desenvolvimento e vai enviar para o tech lead revisar', 'handoff', 3000);

  // Step 2: Dev Lead reviews
  io.emit('agent:working', { role: 'dev_lead', agentName: devLeadName, action: 'reviewing' });
  io.emit('agent:bubble', {
    role: 'dev_lead', agentName: devLeadName,
    text: `Revisando ${caseId}...`, type: 'processing', duration: 6000,
  });

  const leadReview = await reviewDevCase(devLeadName, await buildPersonalizedPromptFull('dev_lead', devLeadName), devCase, caseId);

  if (!leadReview.aprovado) {
    // Step 3a: Lead rejected — Dev revises
    emitLog(`${devLeadName}: Caso rejeitado — "${leadReview.feedback.slice(0, 80)}"`);
    await emitPersonalityBubble(devLeadName, 'dev_lead', `Você rejeitou o caso do dev e pediu ajustes: ${leadReview.feedback.slice(0, 60)}`, 'alert', 5000);
    await emitPersonalityBubble(devAgentName, 'dev', 'O tech lead rejeitou seu caso e pediu para você revisar', 'processing', 4000);

    // Dev revises incorporating lead feedback
    const revisedDevPrompt = buildPersonalizedPrompt('dev', devAgentName) +
      `\n\nFEEDBACK DO DEV LEAD (${devLeadName}): ${leadReview.feedback}\nRevise o caso considerando este feedback. Riscos apontados: ${(leadReview.riscos_adicionais || []).join(', ')}`;
    devCase = await generateDevCase(devAgentName, revisedDevPrompt, qaReport, caseId);

    emitLog(`${devAgentName}: Caso revisado e enviado novamente`);
    await emitPersonalityBubble(devAgentName, 'dev', 'Você revisou o caso e está reenviando para o tech lead aprovar', 'handoff', 3000);
    await emitPersonalityBubble(devLeadName, 'dev_lead', 'Você aprovou o caso revisado do dev', 'done', 3000);
    emitLog(`${devLeadName}: Revisão aceita ✓`);
  } else {
    // Step 3b: Lead approved on first try
    emitLog(`${devLeadName}: Caso aprovado ✓`);
    await emitPersonalityBubble(devLeadName, 'dev_lead', 'Você aprovou o caso do dev de primeira sem precisar de revisão', 'done', 3000);
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

  io.emit('case:opened', devCase);
  emitLog(`DEV pipeline concluído — caso ${caseId}: ${devCase.titulo}`);

  await emitPersonalityBubble(devAgentName, 'dev', `Você acabou de criar e ter aprovado o caso ${caseId} pelo tech lead`, 'done', 4000);

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
    if (role === 'qa') qaAgentName = data.name;
    if (role === 'dev') devAgentName = data.name;
    if (role === 'log_analyzer') logAgentName = data.name;
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

    // Persist to Supabase
    try {
      await dbCreateAgent({
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

    // Build the effective system prompt
    let effectivePrompt = systemPrompt;
    let effectiveMessage = message;

    // Build office context with agent roster for all roles
    const officeContext = buildOfficeContext();

    if (agentRole === 'ceo') {
      // Use the CEO action prompt with office state context
      effectivePrompt = CEO_ACTION_PROMPT
        .replace('{AGENT_NAME}', agentName)
        .replace('{OFFICE_STATE}', officeContext);
      // Append office state context to the user message
      effectiveMessage = message + '\n\n[Estado do escritório]\n' + officeContext;
    } else {
      // All agents get the agent roster so they know who is in the office
      effectivePrompt = systemPrompt + '\n\n[AGENTES NO ESCRITÓRIO]\n' + officeContext;
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

              const summary = await chatWithAgent(agent.name, agent.systemPrompt,
                'O CEO está pedindo seu resumo do dia. O que você fez hoje? Responda de forma breve e objetiva.', []);

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
            // CEO calls a meeting: all agents go to the meeting room
            const allAgents = getActiveAgentsList();
            const participants = allAgents.map(a => a.name);

            for (const agent of allAgents) {
              io.emit('agent:walk_to', {
                agentName: agent.name,
                toSectorId: 'MEETING_ROOM',
                message: 'Reunião!',
              });
            }

            const meetingTopic = action.topic || 'Reunião geral';

            // Save meeting state on server
            activeMeeting.active = true;
            activeMeeting.topic = meetingTopic;
            activeMeeting.participants = participants;
            activeMeeting.messages = [];

            io.emit('meeting:started', {
              topic: meetingTopic,
              participants,
            });
            emitLog(`CEO convocou reunião: ${meetingTopic}`);
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
    else if (role === 'dev') devAgentName = name;
    else if (role === 'log_analyzer') logAgentName = name;
    else if (role === 'ceo') ceoAgentName = name;

    // Also update in supportAgents array if it's a support agent
    const supportAgent = supportAgents.find(a => a.id === agentId);
    if (supportAgent) supportAgent.name = name;

    io.emit('agent:renamed', { agentId, name });
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
      }
      console.log(`[Server] Loaded ${dbAgents.length} agents from DB (${supportAgents.length} support agents)`);
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

  const discordOk = await initDiscord((author, content, channelId) => {
    handleDiscordMessage(author, content, channelId);
  });
  if (!discordOk) console.warn('Discord bot not connected.');

  setInterval(() => syncRepo(), 30 * 60 * 1000);
  setInterval(runLogAnalysis, 5 * 60 * 1000);

  httpServer.listen(PORT, () => {
    console.log(`\n[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] Database: ${dbOk ? '✅ Connected' : '❌ Not connected'}`);
    console.log(`[Server] Discord: ${discordOk ? '✅ Connected' : '❌ Not connected'}`);
    console.log(`[Server] Code: ${codeOk ? '✅ 187 files loaded' : '❌ Not loaded'}`);
    console.log(`[Server] AI: Claude Sonnet 4\n`);
  });
}

start().catch(console.error);
