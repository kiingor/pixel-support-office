import type { CharacterState, Direction, Position, Bubble, CharacterSprites } from './office';

export type AgentRole = 'ceo' | 'suporte' | 'qa' | 'dev' | 'log_analyzer';
export type SectorId = 'RECEPTION' | 'QA_ROOM' | 'DEV_ROOM' | 'LOGS_ROOM' | 'CEO_ROOM' | 'MEETING_ROOM';

export interface Character {
  id: string;
  name: string;
  role: AgentRole;
  state: CharacterState;
  direction: Direction;

  // Grid position (current tile)
  col: number;
  row: number;

  // Sub-pixel position for smooth movement
  pixelX: number;
  pixelY: number;

  // Pathfinding
  path: Position[];
  pathIndex: number;

  // Seat assignment
  seatId: string | null;
  sectorId: SectorId;

  // Animation
  animFrame: number;
  animTimer: number;
  sprites: CharacterSprites;

  // Task
  currentTaskId: string | null;
  targetSectorId: SectorId | null;

  // Speech bubbles
  bubbles: Bubble[];

  // Wander timer
  wanderTimer: number;
  wanderCooldown: number;
}

export interface AgentTask {
  id: string;
  type: 'suporte' | 'qa' | 'dev';
  status: 'pending' | 'processing' | 'handing_off' | 'done';
  assignedAgentId: string | null;
  sourceSector: SectorId;
  targetSector?: SectorId;
  description: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: number;
}

export const ROLE_SECTOR: Record<AgentRole, SectorId> = {
  ceo: 'CEO_ROOM',
  suporte: 'RECEPTION',
  qa: 'QA_ROOM',
  dev: 'DEV_ROOM',
  log_analyzer: 'LOGS_ROOM',
};

export const AGENT_NAMES: Record<AgentRole, string[]> = {
  ceo: ['Director Silva'],
  suporte: ['Ana', 'Bruno', 'Carla', 'Daniel', 'Elena', 'Felipe'],
  qa: ['Carlos', 'Marina', 'Rafael', 'Patricia', 'Thiago'],
  dev: ['Lucas', 'Julia', 'Pedro', 'Fernanda', 'Gustavo'],
  log_analyzer: ['Monitor', 'Sentinel', 'Vigil', 'Watcher'],
};
