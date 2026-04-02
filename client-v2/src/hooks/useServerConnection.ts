import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useOfficeStore } from '../stores/officeStore';
import type { OfficeState } from '../office/engine/officeState.js';

// ── Server URL ────────────────────────────────────────────────────────
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

// ── Helper: find a pixel-agents character by backend name ─────────────
function findCharByName(os: OfficeState, name: string) {
  for (const ch of os.characters.values()) {
    if ((ch as any).backendName === name) return ch;
  }
  return null;
}

function findChar(os: OfficeState, agentName?: string, role?: string) {
  if (agentName) {
    const ch = findCharByName(os, agentName);
    if (ch) return ch;
  }
  if (role) {
    for (const ch of os.characters.values()) {
      if ((ch as any).backendRole === role) return ch;
    }
  }
  return null;
}

/**
 * Creates a Socket.IO connection to the Nexus Agents backend and wires
 * ALL server events into the zustand officeStore so the sidebar (ControlPanel)
 * and other UI components receive live data.
 *
 * Returns a ref to the socket so useBackendSync can also listen on it.
 */
export function useServerConnection(
  getOfficeState: () => OfficeState | null,
) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const store = useOfficeStore.getState();
    const isProduction = window.location.hostname !== 'localhost';

    const socket = io(SERVER_URL, {
      transports: isProduction ? ['polling'] : ['websocket', 'polling'],
      reconnection: true,
    });

    socketRef.current = socket;
    store.setSocket(socket);

    // ── Connection lifecycle ──────────────────────────────────────
    socket.on('connect', () => {
      console.log('[ServerConnection] Connected to server');
      useOfficeStore.getState().addLogEntry('Conectado ao servidor backend');
    });

    socket.on('disconnect', () => {
      console.log('[ServerConnection] Disconnected');
      useOfficeStore.getState().addLogEntry('Desconectado do servidor');
    });

    // ── Agents sync ──────────────────────────────────────────────
    socket.on('agents:sync', (data: { agents: Array<{ id: string; name: string; type: string; system_prompt?: string; specialization?: string }> }) => {
      const mapped = data.agents.map(a => ({
        id: a.id,
        name: a.name,
        role: (a.type || 'suporte') as any,
        status: 'active',
        system_prompt: a.system_prompt,
        specialization: a.specialization,
      }));
      useOfficeStore.getState().setAgents(mapped);
    });

    // ── Tickets ──────────────────────────────────────────────────
    socket.on('ticket:new', (ticket: any) => {
      useOfficeStore.getState().addTicket({
        id: ticket.id,
        discordAuthor: ticket.discord_author,
        discordMessage: ticket.discord_message,
        status: ticket.status || 'pending',
        createdAt: Date.now(),
      });
      useOfficeStore.getState().addLogEntry(`Novo ticket de ${ticket.discord_author} (${ticket.source})`);
    });

    socket.on('ticket:updated', (data: any) => {
      useOfficeStore.getState().updateTicket(data.id || data.ticketId, {
        status: data.status,
        classification: data.classification,
      });
    });

    socket.on('ticket:completed', (data: any) => {
      useOfficeStore.getState().updateTicket(data.ticketId, { status: 'done', classification: data.classification });
      useOfficeStore.getState().addLogEntry(`Ticket resolvido: ${data.classification}`);
    });

    socket.on('ticket:escalated', (data: any) => {
      useOfficeStore.getState().updateTicket(data.ticketId, { status: 'processing', classification: 'bug' });
      useOfficeStore.getState().addLogEntry(`Bug ${data.bugId} escalado para QA`);
    });

    socket.on('ticket:assigned', (data: { agentName: string; author: string }) => {
      useOfficeStore.getState().addLogEntry(`${data.agentName} atendendo ticket de ${data.author}`);
      const os = getOfficeState();
      if (os) {
        const ch = findCharByName(os, data.agentName);
        if (ch) {
          ch.bubbleType = 'waiting';
          ch.bubbleTimer = 5;
        }
      }
    });

    // ── Cases ────────────────────────────────────────────────────
    socket.on('case:opened', (devCase: any) => {
      useOfficeStore.getState().addCase({
        id: devCase.caso_id,
        casoId: devCase.caso_id,
        bugId: devCase.bug_id,
        titulo: devCase.titulo,
        promptIa: devCase.prompt_ia,
        status: 'open',
        createdBy: devCase.created_by,
        sourceSector: devCase.source_sector || 'DEV',
      });
      useOfficeStore.getState().addLogEntry(`Caso ${devCase.caso_id} aberto por ${devCase.created_by || 'DEV'}: ${devCase.titulo}`);
    });

    socket.on('case:resolved', (data: { casoId: string; titulo?: string; createdAt?: string }) => {
      useOfficeStore.getState().updateCase(data.casoId, { status: 'resolved' });
      useOfficeStore.getState().addLogEntry(
        data.titulo
          ? `Caso ${data.casoId} resolvido - "${data.titulo}"`
          : `Caso ${data.casoId} resolvido!`
      );
    });

    socket.on('case:deleted', (data: { casoId: string }) => {
      useOfficeStore.getState().removeCase(data.casoId);
    });

    // ── Agent working status ─────────────────────────────────────
    socket.on('agent:working', (data: { agentName: string; role: string; action: string }) => {
      useOfficeStore.getState().setAgentWorkStatus(data.agentName, data.action);
      useOfficeStore.getState().addLogEntry(`${data.agentName} (${data.role}): ${data.action}`);

      const os = getOfficeState();
      if (os) {
        const ch = findCharByName(os, data.agentName);
        if (ch) os.setAgentActive(ch.id, true);
      }
    });

    // ── Agent conversations ──────────────────────────────────────
    socket.on('agent:conversation', (data: { from: string; fromRole: string; to: string; toRole: string; message: string }) => {
      useOfficeStore.getState().addAgentConversation(data);
    });

    // ── Log entries from server ──────────────────────────────────
    socket.on('log:entry', (entry: any) => {
      useOfficeStore.getState().addLogEntry(`[Server] ${entry.message}`);
    });

    // ── Queue ────────────────────────────────────────────────────
    socket.on('queue:updated', (data: { queueSize: number }) => {
      useOfficeStore.getState().setQueueSize(data.queueSize);
    });

    // ── Chat responses ───────────────────────────────────────────
    socket.on('chat:response', (data: { agentId: string; response: string }) => {
      useOfficeStore.getState().onChatResponse(data.agentId, data.response);
    });

    socket.on('chat:response_append', (data: { agentId: string; response: string }) => {
      // Treat appends as full responses for now
      useOfficeStore.getState().onChatResponse(data.agentId, data.response);
    });

    // ── Meetings ─────────────────────────────────────────────────
    socket.on('meeting:started', (data: { topic: string; participants: string[] }) => {
      useOfficeStore.getState().startMeeting(data.topic, data.participants);
    });

    socket.on('meeting:response', (data: { agentName: string; role: string; response: string }) => {
      useOfficeStore.getState().onMeetingResponse(data.agentName, data.role, data.response);
    });

    socket.on('meeting:restore', (data: { topic: string; participants: string[]; messages: any[] }) => {
      useOfficeStore.getState().restoreMeeting(data.topic, data.participants, data.messages);
    });

    // ── Error log stats ──────────────────────────────────────────
    socket.on('errorlogs:stats', (data: any) => {
      console.log('[ServerConnection] errorlogs:stats', data);
    });

    // ── Agent bubble (visual) ────────────────────────────────────
    socket.on('agent:bubble', (data: { role?: string; agentName?: string; text: string; type?: string; duration?: number }) => {
      const os = getOfficeState();
      if (!os) return;
      const ch = findChar(os, data.agentName, data.role);
      if (ch) {
        ch.bubbleType = 'waiting';
        ch.bubbleTimer = (data.duration || 4000) / 1000;
      }
    });

    // ── Agent walk_to (pixel-agents visual) ──────────────────────
    socket.on('agent:walk_to', (data: { role?: string; agentName?: string; toSectorId: string; targetAgentName?: string; message?: string }) => {
      const os = getOfficeState();
      if (!os) return;

      const ch = findChar(os, data.agentName, data.role);
      if (!ch) return;

      if (data.targetAgentName) {
        const target = findCharByName(os, data.targetAgentName);
        if (target) {
          const success = os.walkToTile(ch.id, target.tileCol, target.tileRow);
          if (!success) {
            const offsets = [
              { col: 1, row: 0 }, { col: -1, row: 0 },
              { col: 0, row: 1 }, { col: 0, row: -1 },
            ];
            for (const off of offsets) {
              if (os.walkToTile(ch.id, target.tileCol + off.col, target.tileRow + off.row)) break;
            }
          }
        }
      } else if (os.walkableTiles.length > 0) {
        const target = os.walkableTiles[Math.floor(Math.random() * os.walkableTiles.length)];
        os.walkToTile(ch.id, target.col, target.row);
      }

      useOfficeStore.getState().addLogEntry(
        data.targetAgentName
          ? `${(ch as any).backendName || ch.id} indo falar com ${data.targetAgentName}`
          : `${(ch as any).backendName || ch.id} caminhando para ${data.toSectorId}`
      );
    });

    // ── Agent return to seat ─────────────────────────────────────
    socket.on('agent:return_to_seat', (data: { agentName: string }) => {
      const os = getOfficeState();
      if (!os) return;
      const ch = findCharByName(os, data.agentName);
      if (ch) os.sendToSeat(ch.id);
    });

    // ── Agent renamed ────────────────────────────────────────────
    socket.on('agent:renamed', () => {
      // Next agents:sync will update names
    });

    // ── Agent level-up ───────────────────────────────────────────
    socket.on('agent:levelup', (data: { agentName: string; role: string; tasksCompleted: number }) => {
      useOfficeStore.getState().addLogEntry(`${data.agentName} subiu de nivel! (${data.tasksCompleted} tarefas)`);
    });

    // ── QA completed ─────────────────────────────────────────────
    socket.on('qa:completed', (data: any) => {
      useOfficeStore.getState().addLogEntry(`QA concluiu: ${data.bugId} (${data.report?.gravidade})`);
    });

    // ── Discord messages ─────────────────────────────────────────
    socket.on('discord:message', (data: any) => {
      useOfficeStore.getState().addLogEntry(`[Discord] ${data.author}: ${(data.content || '').slice(0, 60)}`);
    });

    // ── CEO actions ──────────────────────────────────────────────
    socket.on('ceo:action', (data: { type: string; role?: string; agentName?: string }) => {
      if (data.type === 'hire' && data.role) {
        useOfficeStore.getState().addLogEntry(`CEO contratou: ${data.role}`);
      } else if (data.type === 'fire' && data.agentName) {
        useOfficeStore.getState().addLogEntry(`CEO demitiu: ${data.agentName}`);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [getOfficeState]);

  return socketRef;
}
