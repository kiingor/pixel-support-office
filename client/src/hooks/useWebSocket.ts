import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useOfficeStore } from '../stores/officeStore';

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

    return () => { socket.disconnect(); };
  }, []);

  return socketRef;
}
