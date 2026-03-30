import { CharacterState, Direction, TILE_SIZE } from '../types/office';
import type { Position, Bubble } from '../types/office';
import type { Character, AgentRole, SectorId } from '../types/agents';
import { ROLE_SECTOR, AGENT_NAMES } from '../types/agents';
import { getCharacterSprites } from '../sprites/characterSprites';
import { findPath, findPathNear, isWalkable } from './pathfinding';
import type { TileType } from '../types/office';
import type { PersonalityBehavior } from '../types/agentProfile';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const usedNames: Record<AgentRole, number> = {
  ceo: 0, suporte: 0, qa: 0, qa_manager: 0, dev: 0, dev_lead: 0, log_analyzer: 0,
};

// Names that map to female sprites (derived from AGENT_NAMES female entries)
const FEMALE_NAMES = new Set([
  'Ana', 'Carla', 'Elena',           // suporte
  'Marina', 'Patricia',               // qa
  'Beatriz',                          // qa_manager
  'Julia', 'Fernanda',                // dev
  'Camila',                           // dev_lead
]);

const DEFAULT_BEHAVIOR: PersonalityBehavior = {
  walkSpeed: 48,
  idleTurnInterval: 5.5,
  bubbleInterval: 14,
  wanderInterval: 60,
  animFrameDuration: 0.20,
  quirkBubbles: [],
};

export function createCharacter(
  role: AgentRole,
  seatCol: number,
  seatRow: number,
  seatId: string,
  sectorId: SectorId,
  behavior: PersonalityBehavior = DEFAULT_BEHAVIOR,
): Character {
  const nameList = AGENT_NAMES[role];
  const nameIdx = usedNames[role] % nameList.length;
  usedNames[role]++;

  const name = nameList[nameIdx];
  const gender: 'male' | 'female' = FEMALE_NAMES.has(name) ? 'female' : 'male';

  return {
    id: generateUUID(),
    name,
    role,
    state: CharacterState.IDLE,
    direction: Direction.DOWN,
    col: seatCol,
    row: seatRow,
    pixelX: seatCol * TILE_SIZE,
    pixelY: seatRow * TILE_SIZE,
    path: [],
    pathIndex: 0,
    seatId,
    sectorId,
    animFrame: 0,
    animTimer: 0,
    sprites: getCharacterSprites(role, gender),
    currentTaskId: null,
    targetSectorId: null,
    bubbles: [],
    // Personality behavior
    walkSpeed: behavior.walkSpeed,
    animFrameDuration: behavior.animFrameDuration,
    seatCol,
    seatRow,
    quirkBubbles: behavior.quirkBubbles,
    // Idle behavior timers (staggered so not all fire at once)
    idleTurnTimer: Math.random() * behavior.idleTurnInterval,
    idleTurnInterval: behavior.idleTurnInterval,
    idleBubbleTimer: Math.random() * behavior.bubbleInterval,
    bubbleInterval: behavior.bubbleInterval,
    wanderTimer: Math.random() * behavior.wanderInterval,
    wanderInterval: behavior.wanderInterval,
    wanderCooldown: 0,
  };
}

export function addBubble(ch: Character, text: string, type: Bubble['type'], duration = 4): void {
  ch.bubbles.push({
    text,
    type,
    startTime: performance.now(),
    duration: duration * 1000,
  });
}

export function updateCharacter(
  ch: Character,
  dt: number,
  tiles: TileType[][],
  blockedTiles: Set<string>,
): void {
  // Update animation timer — advance frames while walking or typing
  if (ch.state === CharacterState.WALK || ch.state === CharacterState.TYPE) {
    ch.animTimer += dt;
    if (ch.animTimer >= ch.animFrameDuration) {
      ch.animTimer -= ch.animFrameDuration;
      ch.animFrame++;
    }
  } else {
    ch.animFrame = 0;
    ch.animTimer = 0;
  }

  // Update bubbles (remove expired)
  const now = performance.now();
  ch.bubbles = ch.bubbles.filter(b => now - b.startTime < b.duration);

  switch (ch.state) {
    case CharacterState.WALK:
      updateWalking(ch, dt);
      break;
    case CharacterState.IDLE:
      updateIdleBehaviors(ch, dt, tiles, blockedTiles, true);
      break;
    case CharacterState.TYPE:
      updateIdleBehaviors(ch, dt, tiles, blockedTiles, false, false);
      break;
    case CharacterState.TALK:
      // Just animate in place
      break;
  }
}

function updateWalking(ch: Character, dt: number): void {
  if (ch.pathIndex >= ch.path.length) {
    // Arrived at destination
    ch.state = CharacterState.IDLE;
    ch.col = Math.round(ch.pixelX / TILE_SIZE);
    ch.row = Math.round(ch.pixelY / TILE_SIZE);
    return;
  }

  const target = ch.path[ch.pathIndex];
  const targetX = target.col * TILE_SIZE;
  const targetY = target.row * TILE_SIZE;

  const dx = targetX - ch.pixelX;
  const dy = targetY - ch.pixelY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1) {
    ch.pixelX = targetX;
    ch.pixelY = targetY;
    ch.col = target.col;
    ch.row = target.row;
    ch.pathIndex++;
    return;
  }

  // Update direction
  if (Math.abs(dx) > Math.abs(dy)) {
    ch.direction = dx > 0 ? Direction.RIGHT : Direction.LEFT;
  } else {
    ch.direction = dy > 0 ? Direction.DOWN : Direction.UP;
  }

  const speed = ch.walkSpeed * dt;
  const moveX = (dx / dist) * Math.min(speed, dist);
  const moveY = (dy / dist) * Math.min(speed, dist);

  ch.pixelX += moveX;
  ch.pixelY += moveY;
}

const DIRECTIONS = [Direction.DOWN, Direction.LEFT, Direction.UP, Direction.RIGHT];

function updateIdleBehaviors(
  ch: Character,
  dt: number,
  tiles: TileType[][],
  blockedTiles: Set<string>,
  allowWander: boolean,
  allowTurn: boolean = true,
): void {
  // 1. Sitting direction change (disabled while typing at desk)
  if (allowTurn) {
    ch.idleTurnTimer += dt;
    if (ch.idleTurnTimer >= ch.idleTurnInterval) {
      ch.idleTurnTimer = 0;
      const idx = (DIRECTIONS.indexOf(ch.direction) + 1) % DIRECTIONS.length;
      ch.direction = DIRECTIONS[idx];
    }
  }

  // 2. Random quirk bubble (only when no active bubbles)
  if (ch.quirkBubbles.length > 0 && ch.bubbles.length === 0) {
    ch.idleBubbleTimer += dt;
    if (ch.idleBubbleTimer >= ch.bubbleInterval) {
      ch.idleBubbleTimer = 0;
      const text = ch.quirkBubbles[Math.floor(Math.random() * ch.quirkBubbles.length)];
      addBubble(ch, text, 'chat', 5);
    }
  }

  // 3. Micro-wander DISABLED — agents stay at their desks
  // Wandering is handled server-side only (cross-sector visits via idleAgentLife)
  // This prevents agents from constantly leaving their chairs locally
}

/** Send a character walking to a specific position. */
export function sendCharacterTo(
  ch: Character,
  targetCol: number,
  targetRow: number,
  tiles: TileType[][],
  blockedTiles: Set<string>,
): boolean {
  const path = findPath(ch.col, ch.row, targetCol, targetRow, tiles, blockedTiles);
  if (path.length === 0 && (ch.col !== targetCol || ch.row !== targetRow)) {
    // Try nearby
    const nearPath = findPathNear(ch.col, ch.row, targetCol, targetRow, tiles, blockedTiles);
    if (nearPath.length === 0) return false;
    ch.path = nearPath;
  } else {
    ch.path = path;
  }
  ch.pathIndex = 0;
  ch.state = CharacterState.WALK;
  return true;
}

/** Make a character sit at their assigned seat and start typing. */
export function sitAtDesk(ch: Character): void {
  if (ch.seatId) {
    ch.state = CharacterState.TYPE;
    ch.direction = Direction.DOWN;
  }
}
