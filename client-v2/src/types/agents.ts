// Re-export CharacterState and Direction from office types for compatibility
import { CharacterState, Direction } from '../office/types';
export { CharacterState, Direction };

// Types not present in client-v2 office/types — defined locally for compatibility
export interface Position {
  col: number;
  row: number;
}

export interface Bubble {
  text: string;
  type: 'processing' | 'done' | 'handoff' | 'alert' | 'chat';
  startTime: number;
  duration: number;
}

export interface SpriteData {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface CharacterSprites {
  walk: { [dir in Direction]: SpriteData[] };
  type: { [dir in Direction]: SpriteData[] };
  idle: { [dir in Direction]: SpriteData[] };
}

export type AgentRole = 'ceo' | 'suporte' | 'qa' | 'qa_manager' | 'dev' | 'dev_lead' | 'log_analyzer';
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

  // Personality-driven visual behavior
  walkSpeed: number;
  animFrameDuration: number;
  seatCol: number;
  seatRow: number;
  quirkBubbles: string[];

  // Idle behavior timers
  idleTurnTimer: number;
  idleTurnInterval: number;
  idleBubbleTimer: number;
  bubbleInterval: number;

  // Wander timers (wanderCooldown = -1 means "return to seat needed")
  wanderTimer: number;
  wanderInterval: number;
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
  qa_manager: 'QA_ROOM',
  dev: 'DEV_ROOM',
  dev_lead: 'DEV_ROOM',
  log_analyzer: 'LOGS_ROOM',
};

export const AGENT_NAMES: Record<AgentRole, string[]> = {
  ceo: ['Director Silva'],
  suporte: ['Ana', 'Bruno', 'Carla', 'Daniel', 'Elena', 'Felipe'],
  qa: ['Carlos', 'Marina', 'Rafael', 'Patricia', 'Thiago'],
  qa_manager: ['Beatriz', 'Rodrigo'],
  dev: ['Lucas', 'Julia', 'Pedro', 'Fernanda', 'Gustavo'],
  dev_lead: ['Alexandre', 'Camila'],
  log_analyzer: ['Monitor', 'Sentinel', 'Vigil', 'Watcher'],
};
