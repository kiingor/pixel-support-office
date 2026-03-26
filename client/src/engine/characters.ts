import { CharacterState, Direction, TILE_SIZE } from '../types/office';
import type { Position, Bubble } from '../types/office';
import type { Character, AgentRole, SectorId } from '../types/agents';
import { ROLE_SECTOR, AGENT_NAMES } from '../types/agents';
import { getCharacterSprites } from '../sprites/characterSprites';
import { findPath, findPathNear, isWalkable } from './pathfinding';
import type { TileType } from '../types/office';

const WALK_SPEED = 48; // pixels per second
const ANIM_FRAME_DURATION = 0.2; // seconds per frame
const WANDER_MIN = 4; // min seconds between wanders
const WANDER_MAX = 12; // max seconds

let nextId = 0;
const usedNames: Record<AgentRole, number> = {
  ceo: 0, suporte: 0, qa: 0, dev: 0, log_analyzer: 0,
};

export function createCharacter(
  role: AgentRole,
  seatCol: number,
  seatRow: number,
  seatId: string,
  sectorId: SectorId,
): Character {
  const nameList = AGENT_NAMES[role];
  const nameIdx = usedNames[role] % nameList.length;
  usedNames[role]++;

  return {
    id: `agent_${nextId++}`,
    name: nameList[nameIdx],
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
    sprites: getCharacterSprites(role),
    currentTaskId: null,
    targetSectorId: null,
    bubbles: [],
    wanderTimer: WANDER_MIN + Math.random() * (WANDER_MAX - WANDER_MIN),
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
  // Update animation timer — only advance frames while walking
  if (ch.state === CharacterState.WALK) {
    ch.animTimer += dt;
    if (ch.animTimer >= ANIM_FRAME_DURATION) {
      ch.animTimer -= ANIM_FRAME_DURATION;
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
      updateIdle(ch, dt, tiles, blockedTiles);
      break;
    case CharacterState.TYPE:
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

  const speed = WALK_SPEED * dt;
  const moveX = (dx / dist) * Math.min(speed, dist);
  const moveY = (dy / dist) * Math.min(speed, dist);

  ch.pixelX += moveX;
  ch.pixelY += moveY;
}

function updateIdle(
  _ch: Character,
  _dt: number,
  _tiles: TileType[][],
  _blockedTiles: Set<string>,
): void {
  // Agents stay at their desks. They only move when explicitly told to
  // (via sendCharacterTo for tasks, escalations, or chat commands).
  // No random wandering.
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
