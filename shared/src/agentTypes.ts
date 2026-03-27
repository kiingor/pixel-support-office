export type AgentRole = 'ceo' | 'suporte' | 'qa' | 'qa_manager' | 'dev' | 'dev_lead' | 'log_analyzer';
export type SectorId = 'RECEPTION' | 'QA_ROOM' | 'DEV_ROOM' | 'LOGS_ROOM' | 'CEO_ROOM';
export type TaskStatus = 'pending' | 'processing' | 'done' | 'escalated';
export type TicketClassification = 'duvida' | 'bug';

export interface AgentInfo {
  id: string;
  name: string;
  role: AgentRole;
  status: 'idle' | 'working' | 'walking' | 'talking';
  currentTaskId?: string;
}

export interface TicketInfo {
  id: string;
  type: 'suporte' | 'qa' | 'dev';
  status: TaskStatus;
  assignedAgentId?: string;
  source: 'discord' | 'logs' | 'demo';
  discordAuthor?: string;
  discordMessage?: string;
  classification?: TicketClassification;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
}

export interface CaseInfo {
  id: string;
  casoId: string;
  bugId?: string;
  titulo: string;
  causaRaiz?: string;
  estrategiaFix?: string;
  promptIa: string;
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
}
