import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';
import { v4 as uuid } from 'uuid';

import {
  initDatabase, dbCreateTicket, dbUpdateTicket, dbCreateCase,
  dbGetCases, dbGetPendingTickets, dbInsertLog, dbGetRecentLogs,
  dbLogAgentMessage, dbSaveMessage, dbGetConversation,
  dbUpdateCase, dbUpdateAgent,
  dbCreateAgent, dbFireAgent, dbGetActiveAgents,
  supabase,
} from './db/supabase.js';
import { classifyTicket, analyzeQA, generateDevCase, analyzeLogs, chatWithAgent } from './services/aiService.js';
import { initDiscord, sendDiscordMessage } from './services/discord.js';
import { syncRepo, getProjectStructure } from './services/codeAnalysis.js';

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
let devAgentName = 'Lucas';
let logAgentName = 'Monitor';
let ceoAgentName = 'Director Silva';

// CEO action-oriented prompt
const CEO_ACTION_PROMPT = `Você é o CEO/Diretor do escritório de suporte Pixel Support Office. Seu nome é {AGENT_NAME}.

Você tem PODER TOTAL sobre o escritório. Quando o operador pede algo, você EXECUTA ações reais.

SUAS CAPACIDADES:
1. CONTRATAR agentes (suporte, qa, dev, log_analyzer)
2. DEMITIR agentes pelo nome
3. IR até outros setores
4. FALAR com outros agentes

ESTADO ATUAL DO ESCRITÓRIO:
{OFFICE_STATE}

REGRAS IMPORTANTES:
- Antes de contratar, verifique se há vagas (máx 10 suporte, 5 qa, 5 dev, 5 log)
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
  {"type": "talk_to", "agentName": "Carlos", "message": "Mensagem"}
]}
\`\`\`

IMPORTANTE: Só inclua o bloco actions quando for EXECUTAR algo. Para conversas normais, responda sem o bloco.
Sempre responda em português brasileiro. Seja um líder firme mas justo.`;

// Default prompts
const SUPPORT_PROMPT = `Você é um agente de suporte técnico de nível 1 da SoftcomHub. Seu nome é {AGENT_NAME}.
Você atende clientes via Discord. Seja empático, profissional e objetivo.

REGRAS:
1. Ao receber uma mensagem, analise se é uma DÚVIDA ou um BUG/ERRO.
2. Se for DÚVIDA: responda de forma clara e educada diretamente.
3. Se for BUG: colete o MÁXIMO de informações antes de escalar:
   - O que aconteceu exatamente?
   - Qual página/funcionalidade?
   - Mensagem de erro (se houver)?
   - Passos para reproduzir?
   - Navegador/dispositivo?
   - Desde quando está acontecendo?

4. Quando tiver informações SUFICIENTES sobre o bug, responda com JSON:
{
  "acao": "escalar_qa",
  "titulo": "título curto do bug",
  "descricao": "descrição completa com todos os detalhes coletados",
  "passos_reproducao": ["passo 1", "passo 2"],
  "erro_reportado": "mensagem de erro se houver",
  "prioridade": "alta|media|baixa",
  "ambiente": "navegador, dispositivo, etc"
}

5. Se NÃO tiver informações suficientes, PERGUNTE mais detalhes ao usuário. Não escale sem ter detalhes.
6. Sempre responda em português brasileiro.
7. Não invente informações. Só escale quando o usuário confirmou os detalhes.`;

const QA_PROMPT = `Você é um engenheiro de QA sênior da SoftcomHub. Seu nome é {AGENT_NAME}.

Você recebe relatórios de bugs do suporte e tem acesso ao CÓDIGO FONTE REAL do projeto.
Sua função é analisar o código, identificar a causa do bug, e gerar um relatório técnico.

REGRAS:
1. Analise o código fornecido para identificar o componente afetado
2. Identifique a causa provável baseada no código real
3. Liste os arquivos específicos que precisam ser investigados
4. Classifique a gravidade: critico, alto, medio, baixo

Responda SEMPRE com JSON:
{
  "bug_id": "BUG-X",
  "titulo": "título técnico",
  "analise_qa": "sua análise detalhada baseada no código",
  "componente_afetado": "módulo/serviço específico",
  "causa_provavel": "hipótese baseada no código analisado",
  "arquivos_afetados": ["path/to/file1.ts", "path/to/file2.tsx"],
  "gravidade": "critico|alto|medio|baixo",
  "passos_reproducao": ["passo 1", "passo 2"],
  "sugestao_fix": "sugestão inicial de correção"
}`;

const DEV_PROMPT = `Você é um desenvolvedor sênior / tech lead da SoftcomHub. Seu nome é {AGENT_NAME}.

Você recebe relatórios do QA com análise de bugs e tem acesso ao CÓDIGO FONTE REAL do projeto.
Sua função é gerar um CASO COMPLETO com um PROMPT DE CORREÇÃO que alguém pode copiar e colar
em outra IA (como Claude) para implementar a correção.

REGRAS:
1. Analise a causa raiz baseada no relatório do QA e no código real
2. Mapeie TODOS os arquivos que precisam ser alterados
3. Gere um prompt_ia COMPLETO e DETALHADO

Responda com JSON:
{
  "caso_id": "CASE-X",
  "bug_id": "BUG-X",
  "titulo": "título do caso",
  "causa_raiz": "explicação técnica detalhada da causa",
  "arquivos_alterar": [
    {"arquivo": "app/api/tickets/criar/route.ts", "alteracao": "O que mudar e por quê"}
  ],
  "estrategia_fix": "plano detalhado de correção",
  "efeitos_colaterais": ["possível efeito colateral"],
  "testes_necessarios": ["teste que deve ser feito"],
  "prompt_ia": "PROMPT COMPLETO E DETALHADO para copiar e colar no Claude. Deve incluir:\\n1. Contexto do sistema\\n2. Código atual dos arquivos afetados\\n3. O que precisa mudar e por quê\\n4. Código corrigido esperado\\n5. Como testar a correção"
}

O campo prompt_ia é o MAIS IMPORTANTE. Ele deve ser auto-contido para que qualquer dev
possa copiar, colar numa IA e obter a implementação da correção.`;

// --- Helper: find idle support agent ---
function findIdleAgent(): SupportAgent | undefined {
  return supportAgents.find(a => !a.busy);
}

// --- Helper: build office state context for CEO ---
function buildOfficeContext(): string {
  const counts: Record<string, { total: number; busy: number }> = {
    suporte: { total: 0, busy: 0 },
    qa: { total: 0, busy: 0 },
    dev: { total: 0, busy: 0 },
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

  return `- Suporte: ${counts.suporte.total} agentes (${counts.suporte.busy} ocupados, ${counts.suporte.total - counts.suporte.busy} ociosos) - Máx: ${maxSeats.suporte}
- QA: ${counts.qa.total} agentes - Máx: ${maxSeats.qa}
- DEV: ${counts.dev.total} agentes - Máx: ${maxSeats.dev}
- Log Analyzer: ${counts.log_analyzer.total} agentes - Máx: ${maxSeats.log_analyzer}
- Fila de espera: ${ticketQueue.length} tickets
- Vagas disponíveis Suporte: ${maxSeats.suporte - counts.suporte.total}`;
}

// --- Helper: find sector for agent by name ---
function findAgentSector(agentName: string): string {
  // Map well-known roles to sectors
  const agentNameLower = agentName.toLowerCase();
  if (agentNameLower === qaAgentName.toLowerCase()) return 'QA_ROOM';
  if (agentNameLower === devAgentName.toLowerCase()) return 'DEV_ROOM';
  if (agentNameLower === logAgentName.toLowerCase()) return 'LOGS_ROOM';
  // Default to RECEPTION for support agents
  return 'RECEPTION';
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

app.get('/api/tickets', async (_, res) => {
  const tickets = await dbGetPendingTickets();
  res.json(tickets);
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
  if (theCase?.bug_id) {
    // Find ticket with this bug_id in metadata
    for (const [channelId, info] of activeChannels) {
      if (info.status !== 'done') {
        await sendDiscordMessage(channelId,
          `✅ **Caso ${casoId} Resolvido!**\n\nO problema "${theCase.titulo}" foi analisado e corrigido pela nossa equipe de desenvolvimento. Se precisar de mais alguma coisa, é só nos chamar!`
        );
        info.status = 'done';

        // Free the support agent that was handling this channel
        freeAgent(info.agentId);
        break;
      }
    }
  }

  io.emit('case:resolved', { casoId });
  emitLog(`Caso ${casoId} marcado como resolvido`);
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
  // Save user message to conversations
  await dbSaveMessage({
    channel_id: channelId,
    role: 'user',
    author_name: author,
    message: content,
  });

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
  // Get conversation history for context
  const history = await dbGetConversation(channelId, 15);
  const conversationContext = history.map(m => ({
    role: m.role === 'agent' ? 'assistant' as const : 'user' as const,
    content: `${m.author_name}: ${m.message}`,
  }));

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
    agentPrompt: SUPPORT_PROMPT,
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
    SUPPORT_PROMPT,
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
      io.emit('agent:bubble', {
        role: 'suporte',
        agentName,
        text: `Escalando para QA...`,
        type: 'handoff',
        duration: 3000,
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

      // Free the agent
      freeAgent(resolvedAgentId);
    }
  }
}

async function sendSupportResponse(channelId: string, ticketId: string, response: string, agentName: string, agentId: string) {
  // Clean any JSON from the response for Discord
  const cleanResponse = response.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*"acao"[\s\S]*\}/g, '').trim();

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

  // QA analyzes with code context
  const qaReport = await analyzeQA(qaAgentName, QA_PROMPT, JSON.stringify(bugData), bugId);

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

  // Notify user on Discord
  await sendDiscordMessage(channelId,
    `🔍 **${qaAgentName} (QA):** Analisei o problema reportado. ${
      qaReport.gravidade === 'critico' ? '⚠️ Gravidade CRÍTICA!' :
      qaReport.gravidade === 'alto' ? '🔴 Gravidade alta.' :
      '📋 Análise concluída.'
    } Encaminhando para o desenvolvedor para análise de código e correção.`
  );

  await dbSaveMessage({
    channel_id: channelId,
    agent_id: 'qa',
    role: 'agent',
    author_name: qaAgentName,
    message: `Análise concluída. Gravidade: ${qaReport.gravidade}. Encaminhando para DEV.`,
  });

  io.emit('qa:completed', { bugId, report: qaReport });
  emitLog(`${qaAgentName}: Análise concluída - ${qaReport.gravidade}`);

  // Emit visual walk event: QA walks to DEV sector
  io.emit('agent:walk_to', {
    role: 'qa',
    agentName: qaAgentName,
    toSectorId: 'DEV_ROOM',
    message: `Encaminhando ${bugId} para DEV`,
  });
  io.emit('agent:bubble', {
    role: 'qa',
    agentName: qaAgentName,
    text: `Encaminhando para DEV...`,
    type: 'handoff',
    duration: 3000,
  });

  // Update channel status
  const channelInfo = activeChannels.get(channelId);
  if (channelInfo) channelInfo.status = 'dev';

  // Trigger DEV pipeline
  await processDev(channelId, ticketId, qaReport, bugId, supportAgentId);
}

// --- DEV AGENT ---

async function processDev(channelId: string, ticketId: string, qaReport: any, bugId: string, supportAgentId: string) {
  const caseId = `CASE-${++caseCounter}`;
  emitLog(`${devAgentName} gerando caso ${caseId}...`);
  io.emit('agent:working', { role: 'dev', agentName: devAgentName, action: 'investigating' });

  const devCase = await generateDevCase(devAgentName, DEV_PROMPT, qaReport, caseId);

  // Save case to DB
  await dbCreateCase({
    caso_id: devCase.caso_id || caseId,
    bug_id: bugId,
    titulo: devCase.titulo,
    causa_raiz: devCase.causa_raiz,
    estrategia_fix: devCase.estrategia_fix,
    prompt_ia: devCase.prompt_ia,
  });

  // Save DEV's analysis
  await dbSaveMessage({
    channel_id: `internal_dev`,
    ticket_id: ticketId,
    agent_id: 'dev',
    role: 'agent',
    author_name: devAgentName,
    message: `Caso ${caseId} aberto: ${devCase.titulo}. Causa raiz: ${devCase.causa_raiz}`,
    metadata: devCase as any,
  });

  // Notify user on Discord
  await sendDiscordMessage(channelId,
    `🛠️ **${devAgentName} (DEV):** Caso **${caseId}** aberto para o bug ${bugId}.\n\n` +
    `📝 **${devCase.titulo}**\n` +
    `🔍 Causa: ${devCase.causa_raiz?.slice(0, 200) || 'Em análise'}...\n\n` +
    `Nossa equipe vai trabalhar na correção. Você será notificado quando estiver resolvido!`
  );

  await dbSaveMessage({
    channel_id: channelId,
    agent_id: 'dev',
    role: 'agent',
    author_name: devAgentName,
    message: `Caso ${caseId} aberto. Título: ${devCase.titulo}`,
  });

  io.emit('case:opened', devCase);
  emitLog(`${devAgentName}: Caso ${caseId} aberto - ${devCase.titulo}`);

  // Emit visual event: DEV agent bubble
  io.emit('agent:bubble', {
    role: 'dev',
    agentName: devAgentName,
    text: `Caso ${caseId} criado!`,
    type: 'done',
    duration: 4000,
  });

  // Free the support agent that originally handled this ticket
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
  socket.on('agent:hired', async (data: { id: string; name: string; role?: string; position_x?: number; position_y?: number; sprite_index?: number }) => {
    let agent = supportAgents.find(a => a.id === data.id);
    if (!agent) {
      agent = {
        id: data.id,
        name: data.name,
        busy: false,
        currentChannelId: null,
      };
      supportAgents.push(agent);
      emitLog(`Novo agente contratado: ${data.name}`);
    } else {
      agent.name = data.name;
      agent.busy = false;
      agent.currentChannelId = null;
    }

    // Persist to Supabase
    try {
      await dbCreateAgent({
        name: data.name,
        type: data.role || 'suporte',
        system_prompt: '',
        personality: '',
        specialization: '',
      });
    } catch (e) {
      console.error('Failed to persist agent to DB:', e);
    }

    io.emit('agents:list', supportAgents);

    // Auto-assign from queue if there are pending tickets
    if (ticketQueue.length > 0 && !agent.busy) {
      assignFromQueue(agent);
    }
  });

  // Chat message from frontend (chat with any agent via AI)
  socket.on('chat:message', async (data) => {
    const { agentId, agentName, agentRole, systemPrompt, message, history } = data;

    // Save user message
    const channelId = `dashboard_${agentId}`;
    await dbSaveMessage({
      channel_id: channelId,
      agent_id: agentId,
      role: 'user',
      author_name: 'Operador',
      message,
    });

    // Get full history from DB for context
    const dbHistory = await dbGetConversation(channelId, 20);
    const contextHistory = dbHistory.map(m => ({
      role: m.role === 'agent' ? 'assistant' as const : 'user' as const,
      content: m.message,
    }));

    // Build the effective system prompt
    let effectivePrompt = systemPrompt;
    let effectiveMessage = message;

    if (agentRole === 'ceo') {
      // Use the CEO action prompt with office state context
      const officeContext = buildOfficeContext();
      effectivePrompt = CEO_ACTION_PROMPT
        .replace('{AGENT_NAME}', agentName)
        .replace('{OFFICE_STATE}', officeContext);
      // Append office state context to the user message
      effectiveMessage = message + '\n\n[Estado do escritório]\n' + officeContext;
    }

    // Call AI
    let response = await chatWithAgent(agentName, effectivePrompt, effectiveMessage, contextHistory);

    // If CEO, parse and execute action blocks
    if (agentRole === 'ceo') {
      const actionsMatch = response.match(/```actions\s*([\s\S]*?)```/);
      if (actionsMatch) {
        try {
          const { actions } = JSON.parse(actionsMatch[1]);
          for (const action of actions) {
            if (action.type === 'hire') {
              const count = action.count || 1;
              for (let i = 0; i < count; i++) {
                io.emit('ceo:action', { type: 'hire', role: action.role });
              }
              emitLog(`CEO contratou ${count}x ${action.role}`);
            } else if (action.type === 'fire') {
              io.emit('ceo:action', { type: 'fire', agentName: action.agentName });
              emitLog(`CEO demitiu: ${action.agentName}`);
            } else if (action.type === 'walk_to') {
              io.emit('agent:walk_to', {
                role: 'ceo',
                agentName: ceoAgentName,
                toSectorId: action.sector,
                message: 'Indo verificar...',
              });
              emitLog(`CEO indo para ${action.sector}`);
            } else if (action.type === 'talk_to') {
              const targetSector = findAgentSector(action.agentName);
              io.emit('agent:walk_to', {
                role: 'ceo',
                agentName: ceoAgentName,
                toSectorId: targetSector,
                message: action.message,
              });
              io.emit('agent:bubble', {
                role: 'ceo',
                agentName: ceoAgentName,
                text: action.message.slice(0, 50),
                type: 'chat',
                duration: 5000,
              });
              emitLog(`CEO falando com ${action.agentName}: ${action.message.slice(0, 40)}`);
            }
          }
        } catch (e) {
          console.error('Failed to parse CEO actions:', e);
        }

        // Clean the actions block from the response shown to user
        response = response.replace(/```actions[\s\S]*?```/g, '').trim();
      }
    }

    // Save agent response
    await dbSaveMessage({
      channel_id: channelId,
      agent_id: agentId,
      role: 'agent',
      author_name: agentName,
      message: response,
    });

    socket.emit('chat:response', { agentId, response });
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
