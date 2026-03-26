import { create } from 'zustand';
import type { AgentRole } from '../types/agents';
import type { AgentProfile } from '../types/agentProfile';
import { DEFAULT_PROMPTS, DEFAULT_PERSONALITIES, DEFAULT_SPECIALIZATIONS } from '../types/agentProfile';
import type { OfficeState } from '../engine/officeState';
import type { Socket } from 'socket.io-client';

interface AgentInfo {
  id: string;
  name: string;
  role: AgentRole;
  status: string;
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

interface ContextMenu {
  x: number;
  y: number;
  furnitureId: string;
  onDelete: () => void;
}

interface OfficeStoreState {
  officeState: OfficeState | null;
  socket: Socket | null;
  selectedAgentId: string | null;
  agents: AgentInfo[];
  tickets: TicketInfo[];
  cases: CaseInfo[];
  logEntries: LogEntry[];
  chatAgentId: string | null;
  chatHistories: Map<string, ChatMessage[]>;
  agentProfiles: Map<string, AgentProfile>;
  contextMenu: ContextMenu | null;
  chatLoading: boolean;

  setOfficeState: (os: OfficeState) => void;
  setSocket: (s: Socket) => void;
  selectAgent: (id: string | null) => void;
  syncAgents: () => void;
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
  getAgentProfile: (agentId: string) => AgentProfile | undefined;
  setContextMenu: (menu: ContextMenu | null) => void;
}

let msgCounter = 0;

export const useOfficeStore = create<OfficeStoreState>((set, get) => ({
  officeState: null,
  socket: null,
  selectedAgentId: null,
  agents: [],
  tickets: [],
  cases: [],
  logEntries: [],
  chatAgentId: null,
  chatHistories: new Map(),
  agentProfiles: new Map(),
  contextMenu: null,
  chatLoading: false,

  setOfficeState: (os) => set({ officeState: os }),
  setSocket: (s) => set({ socket: s }),
  selectAgent: (id) => set({ selectedAgentId: id }),

  syncAgents: () => {
    const os = get().officeState;
    if (!os) return;
    const agents: AgentInfo[] = [];
    const profiles = get().agentProfiles;
    for (const ch of os.characters.values()) {
      agents.push({ id: ch.id, name: ch.name, role: ch.role, status: ch.state });
      if (!profiles.has(ch.id)) {
        profiles.set(ch.id, {
          id: ch.id,
          name: ch.name,
          role: ch.role,
          systemPrompt: DEFAULT_PROMPTS[ch.role].replace('{AGENT_NAME}', ch.name),
          personality: DEFAULT_PERSONALITIES[ch.role],
          specialization: DEFAULT_SPECIALIZATIONS[ch.role],
          tasksCompleted: 0,
          createdAt: Date.now(),
        });
      }
    }
    set({ agents, agentProfiles: new Map(profiles) });
  },

  addLogEntry: (message) => {
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    set(state => ({ logEntries: [...state.logEntries.slice(-100), { time, message }] }));
  },

  addTicket: (ticket) => set(state => ({ tickets: [...state.tickets, ticket] })),
  updateTicket: (id, updates) => set(state => ({
    tickets: state.tickets.map(t => t.id === id ? { ...t, ...updates } : t),
  })),

  addCase: (c) => set(state => ({ cases: [...state.cases, c] })),
  updateCase: (casoId, updates) => set(state => ({
    cases: state.cases.map(c => c.casoId === casoId ? { ...c, ...updates } : c),
  })),

  hireAgent: (role) => {
    const os = get().officeState;
    if (!os) return;
    const ch = os.addAgent(role);
    if (ch) {
      get().addLogEntry(`${ch.name} (${role}) contratado(a)!`);
      get().syncAgents();
    } else {
      get().addLogEntry(`Sem mesas disponíveis para ${role}`);
    }
  },

  fireAgent: (id) => {
    const os = get().officeState;
    if (!os) return;
    const ch = os.characters.get(id);
    if (!ch) return;
    os.removeAgent(id);
    get().addLogEntry(`${ch.name} (${ch.role}) demitido(a)`);
    const profiles = get().agentProfiles;
    profiles.delete(id);
    set({ agentProfiles: new Map(profiles) });
    setTimeout(() => get().syncAgents(), 100);
  },

  openChat: (agentId) => set({ chatAgentId: agentId }),
  closeChat: () => set({ chatAgentId: null }),

  // Send chat message via WebSocket to backend (real AI)
  sendChatMessage: (text) => {
    const { chatAgentId, chatHistories, agents, socket, agentProfiles } = get();
    if (!chatAgentId) return;

    const histories = new Map(chatHistories);
    const history = histories.get(chatAgentId) || [];

    // Add user message locally
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
      // Send to backend for real AI processing
      socket.emit('chat:message', {
        agentId: chatAgentId,
        agentName: agent.name,
        agentRole: agent.role,
        systemPrompt: profile.systemPrompt,
        message: text,
      });
    } else {
      // Fallback: local response
      get().onChatResponse(chatAgentId, 'Servidor não conectado. Verifique se o backend está rodando.');
    }
  },

  onChatResponse: (agentId, response) => {
    const histories = new Map(get().chatHistories);
    const history = histories.get(agentId) || [];
    const agent = get().agents.find(a => a.id === agentId);

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
    const os = get().officeState;
    const socket = get().socket;
    if (!os) return;

    const ch = os.characters.get(agentId);
    if (ch) {
      const oldName = ch.name;
      ch.name = newName;

      // Update profile
      const profiles = new Map(get().agentProfiles);
      const profile = profiles.get(agentId);
      if (profile) {
        profiles.set(agentId, { ...profile, name: newName });
        set({ agentProfiles: profiles });
      }

      // Notify server
      if (socket) {
        socket.emit('agent:rename', { agentId, name: newName, role: ch.role });
      }

      get().syncAgents();
      get().addLogEntry(`${oldName} renomeado para ${newName}`);
    }
  },

  resolveCase: (casoId) => {
    const socket = get().socket;
    // Call API to resolve
    const baseUrl = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
    fetch(`${baseUrl}/api/cases/${casoId}/resolve`, { method: 'POST' })
      .then(() => {
        get().updateCase(casoId, { status: 'resolved' });
        get().addLogEntry(`Caso ${casoId} resolvido!`);
      })
      .catch(e => console.error('Resolve case error:', e));
  },

  getAgentProfile: (agentId) => get().agentProfiles.get(agentId),
  setContextMenu: (menu) => set({ contextMenu: menu }),
}));
