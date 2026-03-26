import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useOfficeStore } from '../stores/officeStore';
import { addBubble } from '../engine/characters';
import type { SectorId } from '../types/agents';

// In production, connect to same host. In dev, use localhost:3001
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (
  window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin
);

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socketRef.current = socket;
    useOfficeStore.getState().setSocket(socket);

    socket.on('connect', () => {
      console.log('[WS] Connected to server');
      useOfficeStore.getState().addLogEntry('Conectado ao servidor backend');
    });

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected');
      useOfficeStore.getState().addLogEntry('Desconectado do servidor');
    });

    // Ticket events
    socket.on('ticket:new', (ticket) => {
      const store = useOfficeStore.getState();
      store.addTicket({
        id: ticket.id,
        discordAuthor: ticket.discord_author,
        discordMessage: ticket.discord_message,
        status: ticket.status,
        createdAt: Date.now(),
      });
      store.addLogEntry(`Novo ticket de ${ticket.discord_author} (${ticket.source})`);
    });

    socket.on('ticket:completed', (data) => {
      const store = useOfficeStore.getState();
      store.updateTicket(data.ticketId, { status: 'done', classification: data.classification });
      store.addLogEntry(`Ticket resolvido: ${data.classification}`);
    });

    socket.on('ticket:escalated', (data) => {
      const store = useOfficeStore.getState();
      store.updateTicket(data.ticketId, { status: 'processing', classification: 'bug' });
      store.addLogEntry(`Bug ${data.bugId} escalado para QA`);
    });

    // Agent events
    socket.on('agent:working', (data) => {
      useOfficeStore.getState().addLogEntry(`${data.agentName} (${data.role}): ${data.action}`);
    });

    socket.on('agent:renamed', (data) => {
      useOfficeStore.getState().syncAgents();
    });

    // QA events
    socket.on('qa:completed', (data) => {
      useOfficeStore.getState().addLogEntry(`QA concluiu: ${data.bugId} (${data.report.gravidade})`);
    });

    // Case events
    socket.on('case:opened', (devCase) => {
      const store = useOfficeStore.getState();
      store.addCase({
        id: devCase.caso_id,
        casoId: devCase.caso_id,
        bugId: devCase.bug_id,
        titulo: devCase.titulo,
        promptIa: devCase.prompt_ia,
        status: 'open',
      });
      store.addLogEntry(`Caso ${devCase.caso_id} aberto: ${devCase.titulo}`);
    });

    socket.on('case:resolved', (data) => {
      useOfficeStore.getState().updateCase(data.casoId, { status: 'resolved' });
      useOfficeStore.getState().addLogEntry(`Caso ${data.casoId} resolvido!`);
    });

    // Discord messages (show in logs)
    socket.on('discord:message', (data) => {
      useOfficeStore.getState().addLogEntry(`[Discord] ${data.author}: ${data.content.slice(0, 60)}`);
    });

    // Log events
    socket.on('log:entry', (entry) => {
      useOfficeStore.getState().addLogEntry(`[Server] ${entry.message}`);
    });

    // Chat response from backend AI
    socket.on('chat:response', (data) => {
      useOfficeStore.getState().onChatResponse(data.agentId, data.response);
    });

    // Agent walk-to event: make an agent walk to a target sector with a speech bubble
    socket.on('agent:walk_to', (data: { fromRole: string; toSectorId: string; message: string }) => {
      const store = useOfficeStore.getState();
      const os = store.officeState;
      if (!os) return;

      // Find the agent by role
      let agent = null;
      for (const ch of os.characters.values()) {
        if (ch.role === data.fromRole) {
          agent = ch;
          break;
        }
      }
      if (!agent) return;

      os.sendAgentToSector(agent.id, data.toSectorId as SectorId);
      if (data.message) {
        addBubble(agent, data.message, 'handoff', 4);
      }
      store.addLogEntry(`${agent.name} caminhando para ${data.toSectorId}`);
    });

    // Agent bubble event: show a speech bubble on an agent
    socket.on('agent:bubble', (data: { role: string; text: string; type: string; duration?: number }) => {
      const os = useOfficeStore.getState().officeState;
      if (!os) return;

      for (const ch of os.characters.values()) {
        if (ch.role === data.role) {
          const bubbleType = (data.type || 'processing') as 'processing' | 'done' | 'handoff' | 'alert' | 'chat';
          addBubble(ch, data.text, bubbleType, data.duration || 4);
          break;
        }
      }
    });

    // Queue updated event: update queue count in store
    socket.on('queue:updated', (data: { queueSize: number }) => {
      useOfficeStore.getState().setQueueSize(data.queueSize);
    });

    // Ticket assigned event: show which agent got the ticket
    socket.on('ticket:assigned', (data: { agentName: string; author: string }) => {
      const store = useOfficeStore.getState();
      store.addLogEntry(`${data.agentName} atendendo ticket de ${data.author}`);

      // Show a bubble on the agent
      const os = store.officeState;
      if (os) {
        for (const ch of os.characters.values()) {
          if (ch.name === data.agentName) {
            addBubble(ch, data.author, 'processing', 5);
            break;
          }
        }
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  return socketRef;
}
