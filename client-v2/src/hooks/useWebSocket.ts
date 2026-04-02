import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { OfficeState } from '../office/engine/officeState.js';

// ── Server URL ────────────────────────────────────────────────────────
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

// ── Role type (matches backend) ──────────────────────────────────────
export type AgentRole =
  | 'ceo'
  | 'suporte'
  | 'qa'
  | 'qa_manager'
  | 'dev'
  | 'dev_lead'
  | 'log_analyzer';

// ── Bubble types we expose for the UI ────────────────────────────────
export type BubbleType = 'processing' | 'done' | 'handoff' | 'alert' | 'chat';

export interface BubbleEvent {
  agentName: string;
  text: string;
  type: BubbleType;
  duration: number; // seconds
}

// ── Log entry ────────────────────────────────────────────────────────
export interface LogEntry {
  time: string;
  message: string;
}

// ── Ticket ───────────────────────────────────────────────────────────
export interface TicketInfo {
  id: string;
  discordAuthor?: string;
  discordMessage?: string;
  status: string;
  classification?: string;
  createdAt: number;
}

// ── Case ─────────────────────────────────────────────────────────────
export interface CaseInfo {
  id: string;
  casoId: string;
  bugId?: string;
  titulo: string;
  promptIa?: string;
  status: string;
  createdBy?: string;
  sourceSector?: string;
}

// ── Meeting ──────────────────────────────────────────────────────────
export interface MeetingMessage {
  id: string;
  from: 'user' | 'agent';
  agentName?: string;
  agentRole?: string;
  text: string;
  timestamp: number;
}

// ── Chat ─────────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  timestamp: number;
}

// ── Agent conversation ───────────────────────────────────────────────
export interface AgentConversation {
  from: string;
  fromRole: string;
  to: string;
  toRole: string;
  message: string;
}

// ── Callbacks the consumer provides ──────────────────────────────────
export interface WebSocketCallbacks {
  /** Log line to display in the activity log */
  onLog: (message: string) => void;
  /** Ticket lifecycle */
  onTicketNew: (ticket: TicketInfo) => void;
  onTicketUpdated: (id: string, patch: Partial<TicketInfo>) => void;
  onTicketCompleted: (ticketId: string, classification: string) => void;
  onTicketAssigned: (agentName: string, author: string) => void;
  /** Case lifecycle */
  onCaseOpened: (c: CaseInfo) => void;
  onCaseResolved: (casoId: string, titulo?: string, createdAt?: string) => void;
  onCaseDeleted: (casoId: string) => void;
  /** Agent work status */
  onAgentWorking: (agentName: string, role: string, action: string) => void;
  /** Bubble on an agent */
  onBubble: (evt: BubbleEvent) => void;
  /** Meeting */
  onMeetingStarted: (topic: string, participants: string[]) => void;
  onMeetingResponse: (agentName: string, role: string, response: string) => void;
  onMeetingRestore: (topic: string, participants: string[], messages: MeetingMessage[]) => void;
  /** CEO actions */
  onCeoHire: (role: AgentRole) => void;
  onCeoFire: (agentName: string) => void;
  /** Error log KPIs */
  onLogStats: (stats: { total: number; naoAnalisados: number; analisados: number; resolvidos: number }) => void;
  /** Agent-to-agent conversations */
  onAgentConversation: (data: AgentConversation) => void;
  /** Agent level-up */
  onAgentLevelUp: (agentName: string, role: string, tasksCompleted: number) => void;
  /** Chat response from backend AI */
  onChatResponse: (agentId: string, response: string) => void;
  onChatResponseAppend: (agentId: string, response: string) => void;
  /** Agent sync from DB (initial load / reconnect) */
  onAgentsSync: (agents: Array<{ id: string; name: string; type: string }>) => void;
  /** Queue size */
  onQueueUpdated: (queueSize: number) => void;
}

// ── Helper: find a pixel-agents character by backend name ────────────
function findCharByName(os: OfficeState, name: string) {
  for (const ch of os.characters.values()) {
    if ((ch as any).backendName === name) return ch;
  }
  return null;
}

function findCharByRole(os: OfficeState, role: string) {
  for (const ch of os.characters.values()) {
    if ((ch as any).backendRole === role) return ch;
  }
  return null;
}

function findChar(os: OfficeState, agentName?: string, role?: string) {
  let ch = null;
  if (agentName) ch = findCharByName(os, agentName);
  if (!ch && role) ch = findCharByRole(os, role);
  return ch;
}

// ── Meeting seat cycling ─────────────────────────────────────────────
let meetingSeatCounter = 0;

/**
 * Socket.IO integration hook.
 *
 * Connects to the Nexus Agents backend and dispatches events both to
 * the pixel-agents OfficeState (for visual character actions) and to
 * a set of callbacks (for UI state like tickets, cases, logs, chat).
 */
export function useWebSocket(
  getOfficeState: () => OfficeState | null,
  callbacks: WebSocketCallbacks,
) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const isProduction = window.location.hostname !== 'localhost';
    const socket = io(SERVER_URL, {
      transports: isProduction ? ['polling'] : ['websocket', 'polling'],
      reconnection: true,
    });

    socketRef.current = socket;

    // ── Connection lifecycle ──────────────────────────────────────
    socket.on('connect', () => {
      console.log('[WS] Connected to server');
      callbacks.onLog('Conectado ao servidor backend');
    });

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected');
      callbacks.onLog('Desconectado do servidor');
    });

    // ── Tickets ──────────────────────────────────────────────────
    socket.on('ticket:new', (ticket: any) => {
      callbacks.onTicketNew({
        id: ticket.id,
        discordAuthor: ticket.discord_author,
        discordMessage: ticket.discord_message,
        status: ticket.status,
        createdAt: Date.now(),
      });
      callbacks.onLog(`Novo ticket de ${ticket.discord_author} (${ticket.source})`);
    });

    socket.on('ticket:updated', (data: any) => {
      callbacks.onTicketUpdated(data.id || data.ticketId, {
        status: data.status,
        classification: data.classification,
      });
    });

    socket.on('ticket:completed', (data: any) => {
      callbacks.onTicketCompleted(data.ticketId, data.classification);
      callbacks.onLog(`Ticket resolvido: ${data.classification}`);
    });

    socket.on('ticket:escalated', (data: any) => {
      callbacks.onTicketUpdated(data.ticketId, { status: 'processing', classification: 'bug' });
      callbacks.onLog(`Bug ${data.bugId} escalado para QA`);
    });

    socket.on('ticket:assigned', (data: { agentName: string; author: string }) => {
      callbacks.onTicketAssigned(data.agentName, data.author);
      callbacks.onLog(`${data.agentName} atendendo ticket de ${data.author}`);

      // Show bubble on the character
      const os = getOfficeState();
      if (os) {
        const ch = findCharByName(os, data.agentName);
        if (ch) {
          ch.bubbleType = 'waiting';
          ch.bubbleTimer = 5;
        }
      }
    });

    // ── Agent working ────────────────────────────────────────────
    socket.on('agent:working', (data: { agentName: string; role: string; action: string }) => {
      callbacks.onAgentWorking(data.agentName, data.role, data.action);
      callbacks.onLog(`${data.agentName} (${data.role}): ${data.action}`);

      // Mark the character as active
      const os = getOfficeState();
      if (os) {
        const ch = findCharByName(os, data.agentName);
        if (ch) {
          os.setAgentActive(ch.id, true);
        }
      }
    });

    socket.on('agent:renamed', () => {
      // Trigger a re-sync from the consumer if needed
    });

    // ── QA ───────────────────────────────────────────────────────
    socket.on('qa:completed', (data: any) => {
      callbacks.onLog(`QA concluiu: ${data.bugId} (${data.report.gravidade})`);
    });

    // ── Cases ────────────────────────────────────────────────────
    socket.on('case:opened', (devCase: any) => {
      callbacks.onCaseOpened({
        id: devCase.caso_id,
        casoId: devCase.caso_id,
        bugId: devCase.bug_id,
        titulo: devCase.titulo,
        promptIa: devCase.prompt_ia,
        status: 'open',
        createdBy: devCase.created_by,
        sourceSector: devCase.source_sector || 'DEV',
      });
      callbacks.onLog(`Caso ${devCase.caso_id} aberto por ${devCase.created_by || 'DEV'}: ${devCase.titulo}`);
    });

    socket.on('case:resolved', (data: { casoId: string; titulo?: string; bugId?: string; createdAt?: string; resolvedAt?: string }) => {
      callbacks.onCaseResolved(data.casoId, data.titulo, data.createdAt);
      if (data.titulo) {
        callbacks.onLog(`Caso ${data.casoId} resolvido - "${data.titulo}" (aberto: ${data.createdAt})`);
      } else {
        callbacks.onLog(`Caso ${data.casoId} resolvido!`);
      }
    });

    socket.on('case:deleted', (data: { casoId: string }) => {
      callbacks.onCaseDeleted(data.casoId);
    });

    // ── Agent conversations ──────────────────────────────────────
    socket.on('agent:conversation', (data: AgentConversation) => {
      callbacks.onAgentConversation(data);
    });

    // ── Agent level-up ───────────────────────────────────────────
    socket.on('agent:levelup', (data: { agentName: string; role: string; tasksCompleted: number }) => {
      callbacks.onAgentLevelUp(data.agentName, data.role, data.tasksCompleted);
      callbacks.onLog(`${data.agentName} subiu de nivel! (${data.tasksCompleted} tarefas)`);
    });

    // ── Error log stats ──────────────────────────────────────────
    socket.on('errorlogs:stats', (data: { total: number; naoAnalisados: number; analisados: number; resolvidos: number }) => {
      callbacks.onLogStats(data);
    });

    // ── Discord messages ─────────────────────────────────────────
    socket.on('discord:message', (data: any) => {
      callbacks.onLog(`[Discord] ${data.author}: ${data.content.slice(0, 60)}`);
    });

    // ── Server log entries ───────────────────────────────────────
    socket.on('log:entry', (entry: any) => {
      callbacks.onLog(`[Server] ${entry.message}`);
    });

    // ── Chat responses ───────────────────────────────────────────
    socket.on('chat:response', (data: { agentId: string; response: string }) => {
      callbacks.onChatResponse(data.agentId, data.response);
    });

    socket.on('chat:response_append', (data: { agentId: string; response: string }) => {
      callbacks.onChatResponseAppend(data.agentId, data.response);
    });

    // ── Agent walk-to ────────────────────────────────────────────
    socket.on('agent:walk_to', (data: { role?: string; agentName?: string; toSectorId: string; targetAgentName?: string; message?: string }) => {
      const os = getOfficeState();
      if (!os) {
        console.warn('[Walk] No officeState');
        return;
      }

      const ch = findChar(os, data.agentName, data.role);
      if (!ch) {
        console.warn(`[Walk] Agent not found: name="${data.agentName}" role="${data.role}"`);
        return;
      }
      console.log(`[Walk] ${(ch as any).backendName || ch.id} -> ${data.toSectorId}`);

      // If targeting a specific agent, walk near them
      if (data.targetAgentName) {
        const target = findCharByName(os, data.targetAgentName);
        if (target) {
          const success = os.walkToTile(ch.id, target.tileCol, target.tileRow);
          if (!success) {
            // Try adjacent tiles
            const offsets = [
              { col: 1, row: 0 }, { col: -1, row: 0 },
              { col: 0, row: 1 }, { col: 0, row: -1 },
            ];
            for (const off of offsets) {
              if (os.walkToTile(ch.id, target.tileCol + off.col, target.tileRow + off.row)) break;
            }
          }
        }
        callbacks.onLog(`${(ch as any).backendName || ch.id} indo falar com ${data.targetAgentName}`);
      } else {
        // Walk to a random walkable tile (we don't have sector positions in pixel-agents)
        // The character will just wander if no specific seat logic applies
        if (os.walkableTiles.length > 0) {
          const target = os.walkableTiles[Math.floor(Math.random() * os.walkableTiles.length)];
          os.walkToTile(ch.id, target.col, target.row);
        }
        callbacks.onLog(`${(ch as any).backendName || ch.id} caminhando para ${data.toSectorId}`);
      }

      if (data.message) {
        callbacks.onBubble({
          agentName: (ch as any).backendName || String(ch.id),
          text: data.message,
          type: 'handoff',
          duration: 4,
        });
      }
    });

    // ── Agent return-to-seat ─────────────────────────────────────
    socket.on('agent:return_to_seat', (data: { agentName: string }) => {
      const os = getOfficeState();
      if (!os) return;
      meetingSeatCounter = 0;

      const ch = findCharByName(os, data.agentName);
      if (ch) {
        os.sendToSeat(ch.id);
      }
    });

    // ── Agent bubble ─────────────────────────────────────────────
    socket.on('agent:bubble', (data: { role?: string; agentName?: string; text: string; type?: string; duration?: number }) => {
      const os = getOfficeState();
      if (!os) return;

      const ch = findChar(os, data.agentName, data.role);
      if (ch) {
        // The pixel-agents Character only supports 'permission' | 'waiting' | null for bubbleType.
        // Map our richer bubble types to the available types:
        // 'processing' / 'chat' -> 'waiting' (shows a temporary bubble)
        // 'done' / 'alert' / 'handoff' -> 'waiting' (shows a temporary bubble)
        ch.bubbleType = 'waiting';
        ch.bubbleTimer = (data.duration || 4000) / 1000;

        // Also emit to the UI callback for richer rendering
        callbacks.onBubble({
          agentName: (ch as any).backendName || String(ch.id),
          text: data.text || '',
          type: (data.type || 'processing') as BubbleType,
          duration: (data.duration || 4000) / 1000,
        });
      }
    });

    // ── CEO actions ──────────────────────────────────────────────
    socket.on('ceo:action', (data: { type: string; role?: string; agentName?: string }) => {
      if (data.type === 'hire' && data.role) {
        callbacks.onCeoHire(data.role as AgentRole);
        callbacks.onLog(`CEO contratou: ${data.role}`);
      } else if (data.type === 'fire' && data.agentName) {
        callbacks.onCeoFire(data.agentName);
        callbacks.onLog(`CEO demitiu: ${data.agentName}`);
      }
    });

    // ── Meetings ─────────────────────────────────────────────────
    socket.on('meeting:started', (data: { topic: string; participants: string[] }) => {
      callbacks.onMeetingStarted(data.topic, data.participants);
    });

    socket.on('meeting:response', (data: { agentName: string; role: string; response: string }) => {
      callbacks.onMeetingResponse(data.agentName, data.role, data.response);
    });

    socket.on('meeting:restore', (data: { topic: string; participants: string[]; messages: MeetingMessage[] }) => {
      callbacks.onMeetingRestore(data.topic, data.participants, data.messages);
    });

    // ── Agent sync (reconnect / initial load) ────────────────────
    socket.on('agents:sync', (data: { agents: Array<{ id: string; name: string; type: string }> }) => {
      callbacks.onAgentsSync(data.agents);
    });

    // ── Queue ────────────────────────────────────────────────────
    socket.on('queue:updated', (data: { queueSize: number }) => {
      callbacks.onQueueUpdated(data.queueSize);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return socketRef;
}
