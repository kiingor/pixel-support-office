import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useOfficeStore } from '../stores/officeStore';
import { addBubble } from '../engine/characters';
import type { SectorId, AgentRole } from '../types/agents';
import { generateAgentPersonality } from '../types/agentProfile';

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

    socket.on('ticket:updated', (data) => {
      const store = useOfficeStore.getState();
      store.updateTicket(data.id || data.ticketId, {
        status: data.status,
        classification: data.classification,
      });
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

    socket.on('case:resolved', (data: { casoId: string; titulo?: string; bugId?: string; createdAt?: string; resolvedAt?: string }) => {
      const store = useOfficeStore.getState();
      store.updateCase(data.casoId, { status: 'resolved' });
      if (data.titulo) {
        store.addLogEntry(`Caso ${data.casoId} resolvido - "${data.titulo}" (aberto: ${data.createdAt})`);
      } else {
        store.addLogEntry(`Caso ${data.casoId} resolvido!`);
      }
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

    // Chat response append: append text to the last agent message
    socket.on('chat:response_append', (data: { agentId: string; response: string }) => {
      const store = useOfficeStore.getState();
      const histories = new Map(store.chatHistories);
      const history = histories.get(data.agentId) || [];
      if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        if (lastMsg.from === 'agent') {
          lastMsg.text += data.response;
          histories.set(data.agentId, [...history]);
          useOfficeStore.setState({ chatHistories: histories });
        }
      }
    });

    // Agent walk-to event: make an agent walk to a target sector or specific agent
    socket.on('agent:walk_to', (data: { role?: string; agentName?: string; toSectorId: string; targetAgentName?: string; message?: string }) => {
      const store = useOfficeStore.getState();
      const os = store.officeState;
      if (!os) return;

      // Find the agent by name first, then by role as fallback
      let agent = null;
      if (data.agentName) {
        for (const ch of os.characters.values()) {
          if (ch.name === data.agentName) {
            agent = ch;
            break;
          }
        }
      }
      if (!agent && data.role) {
        for (const ch of os.characters.values()) {
          if (ch.role === data.role) {
            agent = ch;
            break;
          }
        }
      }
      if (!agent) return;

      // If targeting a specific agent, walk to their position
      if (data.targetAgentName) {
        const success = os.sendAgentToAgent(agent.id, data.targetAgentName);
        if (!success) {
          os.sendAgentToSector(agent.id, data.toSectorId as SectorId);
        }
        store.addLogEntry(`${agent.name} indo falar com ${data.targetAgentName}`);
      } else if (data.toSectorId === 'MEETING_ROOM') {
        // Meeting room: sit at the table
        os.sendAgentToMeetingRoom(agent.id);
        store.addLogEntry(`${agent.name} indo para a reuniao`);
      } else {
        os.sendAgentToSector(agent.id, data.toSectorId as SectorId);
        store.addLogEntry(`${agent.name} caminhando para ${data.toSectorId}`);
      }

      if (data.message) {
        addBubble(agent, data.message, 'handoff', 4);
      }
    });

    // Agent return-to-seat event
    socket.on('agent:return_to_seat', (data: { agentName: string }) => {
      const os = useOfficeStore.getState().officeState;
      if (!os) return;
      for (const ch of os.characters.values()) {
        if (ch.name === data.agentName) {
          os.returnAgentToSeat(ch.id);
          break;
        }
      }
    });

    // Agent bubble event: show a speech bubble on an agent
    socket.on('agent:bubble', (data: { role?: string; agentName?: string; text: string; type?: string; duration?: number }) => {
      const os = useOfficeStore.getState().officeState;
      if (!os) return;

      // Find by name first, then by role as fallback
      let targetAgent = null;
      if (data.agentName) {
        for (const ch of os.characters.values()) {
          if (ch.name === data.agentName) {
            targetAgent = ch;
            break;
          }
        }
      }
      if (!targetAgent && data.role) {
        for (const ch of os.characters.values()) {
          if (ch.role === data.role) {
            targetAgent = ch;
            break;
          }
        }
      }

      if (targetAgent) {
        const bubbleType = (data.type || 'processing') as 'processing' | 'done' | 'handoff' | 'alert' | 'chat';
        addBubble(targetAgent, data.text || '', bubbleType, (data.duration || 4000) / 1000);
      }
    });

    // CEO action events: the CEO AI issued commands
    socket.on('ceo:action', (data: { type: string; role?: string; agentName?: string }) => {
      const store = useOfficeStore.getState();
      if (data.type === 'hire' && data.role) {
        store.hireAgent(data.role as AgentRole);
        store.addLogEntry(`CEO contratou: ${data.role}`);
      } else if (data.type === 'fire' && data.agentName) {
        const agent = store.agents.find(a => a.name === data.agentName);
        if (agent) {
          store.fireAgent(agent.id);
          store.addLogEntry(`CEO demitiu: ${data.agentName}`);
        }
      }
    });

    // Meeting events
    socket.on('meeting:started', (data: { topic: string; participants: string[] }) => {
      useOfficeStore.getState().startMeeting(data.topic, data.participants);
    });

    socket.on('meeting:response', (data: { agentName: string; role: string; response: string }) => {
      useOfficeStore.getState().onMeetingResponse(data.agentName, data.role, data.response);
    });

    // Restore meeting on reconnect/refresh
    socket.on('meeting:restore', (data: { topic: string; participants: string[]; messages: Array<{ from: 'user' | 'agent'; agentName?: string; agentRole?: string; text: string; timestamp: number }> }) => {
      useOfficeStore.getState().restoreMeeting(data.topic, data.participants, data.messages);
    });

    // Agents sync from DB: restore agents in the office on reconnect
    socket.on('agents:sync', (data: { agents: Array<{ id: string; name: string; type: string }> }) => {
      const store = useOfficeStore.getState();
      const os = store.officeState;
      if (!os) return;

      // Only apply if we have no characters yet (initial load handled by useGameEngine fetch)
      // This handles reconnection scenarios
      if (os.characters.size > 0) return;

      for (const agent of data.agents) {
        const role = (agent.type || 'suporte') as AgentRole;
        const ch = os.addAgent(role);
        if (ch) {
          ch.name = agent.name;
        }
      }
      store.syncAgents();
      store.addLogEntry('Agentes restaurados do servidor');
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
