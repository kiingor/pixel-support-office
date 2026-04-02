import { create } from 'zustand';
import type { AgentRole } from '../types/agents';
import type { AgentProfile } from '../types/agentProfile';
import { DEFAULT_PROMPTS, DEFAULT_PERSONALITIES, DEFAULT_SPECIALIZATIONS, generateAgentPersonality, parsePersonalityBehavior } from '../types/agentProfile';
import type { Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (
  window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''
);

interface AgentInfo {
  id: string;
  name: string;
  role: AgentRole;
  status: string;
  workStatus?: string;
}

interface TicketInfo {
  id: string;
  discordAuthor?: string;
  discordMessage?: string;
  status: string;
  classification?: string;
  createdAt: number;
}

interface CaseInfo {
  id: string;
  casoId: string;
  bugId?: string;
  titulo: string;
  promptIa?: string;
  status: string;
  createdBy?: string;
  sourceSector?: string;
}

interface LogEntry {
  time: string;
  message: string;
}

interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  timestamp: number;
}

interface ActiveConversation {
  agentName: string;
  userName: string;
  lastMessage: string;
  channelId: string;
}

interface MeetingMessage {
  id: string;
  from: 'user' | 'agent';
  agentName?: string;
  agentRole?: string;
  text: string;
  timestamp: number;
}

interface OfficeStoreState {
  socket: Socket | null;
  selectedAgentId: string | null;
  agents: AgentInfo[];
  tickets: TicketInfo[];
  cases: CaseInfo[];
  logEntries: LogEntry[];
  chatAgentId: string | null;
  chatHistories: Map<string, ChatMessage[]>;
  agentProfiles: Map<string, AgentProfile>;
  chatLoading: boolean;
  queueSize: number;
  activeConversations: Map<string, ActiveConversation>;
  agentConversations: Array<{ from: string; fromRole: string; to: string; toRole: string; message: string; time: string }>;
  addAgentConversation: (conv: { from: string; fromRole: string; to: string; toRole: string; message: string }) => void;
  agentWorkStatuses: Map<string, string>;
  setAgentWorkStatus: (agentName: string, status: string) => void;
  clearAgentWorkStatus: (agentName: string) => void;

  // Meeting state
  meetingActive: boolean;
  meetingTopic: string;
  meetingParticipants: string[];
  meetingMessages: MeetingMessage[];
  meetingLoading: boolean;

  setSocket: (s: Socket) => void;
  selectAgent: (id: string | null) => void;
  setAgents: (agents: AgentInfo[]) => void;
  addLogEntry: (message: string) => void;
  addTicket: (ticket: TicketInfo) => void;
  updateTicket: (id: string, updates: Partial<TicketInfo>) => void;
  addCase: (c: CaseInfo) => void;
  updateCase: (casoId: string, updates: Partial<CaseInfo>) => void;
  hireAgent: (role: AgentRole) => void;
  fireAgent: (id: string) => void;
  openChat: (agentId: string) => void;
  closeChat: () => void;
  sendChatMessage: (text: string) => void;
  onChatResponse: (agentId: string, response: string) => void;
  updateAgentPrompt: (agentId: string, prompt: string) => void;
  renameAgent: (agentId: string, newName: string) => void;
  resolveCase: (casoId: string) => void;
  deleteCase: (casoId: string) => void;
  removeCase: (casoId: string) => void;
  selectedCaseId: string | null;
  caseDetailOpen: boolean;
  openCaseDetail: (casoId: string) => void;
  closeCaseDetail: () => void;
  getAgentProfile: (agentId: string) => AgentProfile | undefined;
  setQueueSize: (size: number) => void;
  updateActiveConversation: (channelId: string, data: ActiveConversation) => void;
  startMeeting: (topic: string, participants: string[]) => void;
  restoreMeeting: (topic: string, participants: string[], messages: Array<{ from: 'user' | 'agent'; agentName?: string; agentRole?: string; text: string; timestamp: number }>) => void;
  endMeeting: () => void;
  sendMeetingMessage: (text: string) => void;
  onMeetingResponse: (agentName: string, role: string, response: string) => void;
}

let msgCounter = 0;

export const useOfficeStore = create<OfficeStoreState>((set, get) => ({
  socket: null,
  selectedAgentId: null,
  agents: [],
  tickets: [],
  cases: [],
  selectedCaseId: null,
  caseDetailOpen: false,
  logEntries: [],
  chatAgentId: null,
  chatHistories: new Map(),
  agentProfiles: new Map(),
  chatLoading: false,
  queueSize: 0,
  activeConversations: new Map(),
  agentConversations: [],
  addAgentConversation: (conv) => {
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    set(state => ({
      agentConversations: [...state.agentConversations.slice(-100), { ...conv, time }],
    }));
  },
  agentWorkStatuses: new Map(),
  setAgentWorkStatus: (agentName, status) => {
    const m = new Map(get().agentWorkStatuses);
    m.set(agentName, status);
    set({ agentWorkStatuses: m });
  },
  clearAgentWorkStatus: (agentName) => {
    const m = new Map(get().agentWorkStatuses);
    m.delete(agentName);
    set({ agentWorkStatuses: m });
  },
  meetingActive: false,
  meetingTopic: '',
  meetingParticipants: [],
  meetingMessages: [],
  meetingLoading: false,

  setSocket: (s) => set({ socket: s }),
  selectAgent: (id) => set({ selectedAgentId: id }),

  setAgents: (agents) => {
    // Ensure profiles exist for every agent
    const profiles = new Map(get().agentProfiles);
    for (const a of agents) {
      if (!profiles.has(a.id)) {
        profiles.set(a.id, {
          id: a.id,
          name: a.name,
          role: a.role,
          systemPrompt: DEFAULT_PROMPTS[a.role]?.replace('{AGENT_NAME}', a.name) ?? '',
          personality: DEFAULT_PERSONALITIES[a.role] ?? '',
          specialization: DEFAULT_SPECIALIZATIONS[a.role] ?? '',
          tasksCompleted: 0,
          createdAt: Date.now(),
        });
      }
    }
    set({ agents, agentProfiles: profiles });
  },

  addLogEntry: (message) => {
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    set(state => ({ logEntries: [...state.logEntries.slice(-100), { time, message }] }));
  },

  addTicket: (ticket) => {
    set(state => {
      if (state.tickets.some(t => t.id === ticket.id)) return state;
      return { tickets: [...state.tickets, ticket] };
    });
  },
  updateTicket: (id, updates) => {
    set(state => ({
      tickets: state.tickets.map(t => t.id === id ? { ...t, ...updates } : t),
    }));
  },

  addCase: (c) => {
    set(state => {
      if (state.cases.some(existing => existing.casoId === c.casoId)) return state;
      return { cases: [...state.cases, c] };
    });
  },
  updateCase: (casoId, updates) => {
    set(state => ({
      cases: state.cases.map(c => c.casoId === casoId ? { ...c, ...updates } : c),
    }));
  },

  hireAgent: (role) => {
    const socket = get().socket;
    if (!socket) return;
    const personality = generateAgentPersonality();
    socket.emit('agent:hired', { role, personality });
    get().addLogEntry(`Contratando ${role}...`);
  },

  fireAgent: (id) => {
    const agent = get().agents.find(a => a.id === id);
    if (!agent) return;
    const socket = get().socket;
    if (socket) {
      socket.emit('agent:fired', { id, role: agent.role, name: agent.name });
    }
    // Remove from local state
    set(state => ({
      agents: state.agents.filter(a => a.id !== id),
    }));
    const profiles = new Map(get().agentProfiles);
    profiles.delete(id);
    set({ agentProfiles: profiles });
    get().addLogEntry(`${agent.name} (${agent.role}) demitido(a)`);
  },

  openChat: (agentId) => {
    set({ chatAgentId: agentId });

    const existing = get().chatHistories.get(agentId);
    if (!existing || existing.length === 0) {
      const channelId = `dashboard_${agentId}`;
      fetch(`${SERVER_URL}/api/conversations/${channelId}`)
        .then(res => res.json())
        .then((history: Array<{ role: string; author_name: string; message: string; created_at: string }>) => {
          if (!history || history.length === 0) return;
          const histories = new Map(get().chatHistories);
          const messages: ChatMessage[] = history.map((m, i) => ({
            id: `db_${i}`,
            from: m.role === 'agent' ? 'agent' as const : 'user' as const,
            text: m.message,
            timestamp: new Date(m.created_at).getTime(),
          }));
          histories.set(agentId, messages);
          set({ chatHistories: histories });
        })
        .catch(e => {
          console.error('Failed to load chat history:', e);
        });
    }
  },
  closeChat: () => set({ chatAgentId: null }),

  sendChatMessage: (text) => {
    const { chatAgentId, chatHistories, agents, socket, agentProfiles } = get();
    if (!chatAgentId) return;

    const histories = new Map(chatHistories);
    const history = histories.get(chatAgentId) || [];

    history.push({
      id: `msg_${++msgCounter}`,
      from: 'user',
      text,
      timestamp: Date.now(),
    });
    histories.set(chatAgentId, history);
    set({ chatHistories: histories, chatLoading: true });

    const agent = agents.find(a => a.id === chatAgentId);
    const profile = agentProfiles.get(chatAgentId);

    if (socket && agent && profile) {
      socket.emit('chat:message', {
        agentId: chatAgentId,
        agentName: agent.name,
        agentRole: agent.role,
        systemPrompt: profile.systemPrompt,
        message: text,
      });
    } else {
      get().onChatResponse(chatAgentId, 'Servidor nao conectado. Verifique se o backend esta rodando.');
    }
  },

  onChatResponse: (agentId, response) => {
    const histories = new Map(get().chatHistories);
    const history = histories.get(agentId) || [];

    history.push({
      id: `msg_${++msgCounter}`,
      from: 'agent',
      text: response,
      timestamp: Date.now(),
    });
    histories.set(agentId, history);
    set({ chatHistories: histories, chatLoading: false });
  },

  updateAgentPrompt: (agentId, prompt) => {
    const profiles = new Map(get().agentProfiles);
    const profile = profiles.get(agentId);
    if (profile) {
      profiles.set(agentId, { ...profile, systemPrompt: prompt });
      set({ agentProfiles: profiles });
    }
  },

  renameAgent: (agentId, newName) => {
    const agent = get().agents.find(a => a.id === agentId);
    if (!agent) return;
    const oldName = agent.name;
    const socket = get().socket;

    // Update local agents list
    set(state => ({
      agents: state.agents.map(a => a.id === agentId ? { ...a, name: newName } : a),
    }));

    // Update profile
    const profiles = new Map(get().agentProfiles);
    const profile = profiles.get(agentId);
    if (profile) {
      profiles.set(agentId, { ...profile, name: newName });
      set({ agentProfiles: profiles });
    }

    // Notify server
    if (socket) {
      socket.emit('agent:rename', { agentId, name: newName, role: agent.role });
    }

    get().addLogEntry(`${oldName} renomeado para ${newName}`);
  },

  resolveCase: (casoId) => {
    fetch(`${SERVER_URL}/api/cases/${casoId}/resolve`, { method: 'POST' })
      .then(() => {
        get().updateCase(casoId, { status: 'resolved' });
        get().addLogEntry(`Caso ${casoId} resolvido!`);
      })
      .catch(e => console.error('Resolve case error:', e));
  },

  deleteCase: (casoId) => {
    fetch(`${SERVER_URL}/api/cases/${casoId}`, { method: 'DELETE' })
      .then(() => {
        get().removeCase(casoId);
        get().addLogEntry(`Caso ${casoId} deletado`);
        if (get().selectedCaseId === casoId) {
          set({ caseDetailOpen: false, selectedCaseId: null });
        }
      })
      .catch(e => console.error('Delete case error:', e));
  },

  removeCase: (casoId) => {
    set(state => ({
      cases: state.cases.filter(c => c.casoId !== casoId),
    }));
  },

  openCaseDetail: (casoId) => set({ selectedCaseId: casoId, caseDetailOpen: true }),
  closeCaseDetail: () => set({ caseDetailOpen: false, selectedCaseId: null }),

  getAgentProfile: (agentId) => get().agentProfiles.get(agentId),

  setQueueSize: (size) => {
    set({ queueSize: size });
  },

  updateActiveConversation: (channelId, data) => {
    const conversations = new Map(get().activeConversations);
    conversations.set(channelId, data);
    set({ activeConversations: conversations });
  },

  startMeeting: (topic, participants) => {
    set({
      meetingActive: true,
      meetingTopic: topic,
      meetingParticipants: participants,
      meetingMessages: [],
      meetingLoading: false,
      chatAgentId: null,
    });
    get().addLogEntry(`Reuniao iniciada: ${topic}`);
  },

  restoreMeeting: (topic, participants, messages) => {
    const restored: MeetingMessage[] = messages.map((m, i) => ({
      id: `restored_${i}`,
      from: m.from,
      agentName: m.agentName,
      agentRole: m.agentRole,
      text: m.text,
      timestamp: m.timestamp,
    }));
    set({
      meetingActive: true,
      meetingTopic: topic,
      meetingParticipants: participants,
      meetingMessages: restored,
      meetingLoading: false,
      chatAgentId: null,
    });
    get().addLogEntry('Reuniao restaurada');
  },

  endMeeting: () => {
    const socket = get().socket;
    if (socket) {
      socket.emit('meeting:end');
    }
    set({
      meetingActive: false,
      meetingTopic: '',
      meetingParticipants: [],
      meetingMessages: [],
      meetingLoading: false,
    });
    get().addLogEntry('Reuniao encerrada');
  },

  sendMeetingMessage: (text) => {
    const { socket, meetingTopic, meetingParticipants, meetingMessages } = get();
    if (!socket) return;

    const newMsg: MeetingMessage = {
      id: `meeting_${++msgCounter}`,
      from: 'user',
      text,
      timestamp: Date.now(),
    };

    set({
      meetingMessages: [...meetingMessages, newMsg],
      meetingLoading: true,
    });

    const textLower = text.toLowerCase();
    let targetAgent: string | undefined;
    for (const name of meetingParticipants) {
      if (textLower.startsWith(name.toLowerCase() + ',') ||
          textLower.startsWith(name.toLowerCase() + ' ')) {
        targetAgent = name;
        break;
      }
    }

    socket.emit('meeting:message', {
      message: text,
      topic: meetingTopic,
      participants: meetingParticipants,
      targetAgent,
    });
  },

  onMeetingResponse: (agentName, role, response) => {
    const msgs = get().meetingMessages;
    const newMsg: MeetingMessage = {
      id: `meeting_${++msgCounter}`,
      from: 'agent',
      agentName,
      agentRole: role,
      text: response,
      timestamp: Date.now(),
    };
    set({
      meetingMessages: [...msgs, newMsg],
      meetingLoading: false,
    });
  },
}));
