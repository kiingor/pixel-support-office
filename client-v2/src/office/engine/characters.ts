import {
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
  WORK_DURATION_MAX_SEC,
  WORK_DURATION_MIN_SEC,
  WANDER_RADIUS_TILES,
  WANDER_PAUSE_AFTER_MOVE_MIN_SEC,
  WANDER_PAUSE_AFTER_MOVE_MAX_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);

export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return READING_TOOLS.has(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    workTimer: randomRange(WORK_DURATION_MIN_SEC, WORK_DURATION_MAX_SEC),
    isSubagent: false,
    parentAgentId: null,
    inMeeting: false,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    // New properties
    currentTask: null,
    deliveryTarget: null,
    breakType: null,
    breakTimer: 0,
    waitingForTask: false,
    waitingTimer: 0,
  };
}

export function updateCharacter(
  ch: Character,
  dt: number,
  _walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      // Active agents: workTimer counts down while typing
      if (ch.isActive && !ch.inMeeting) {
        ch.workTimer -= dt;
        if (ch.workTimer <= 0) {
          // Task complete - transition to deliver or waiting state
          if (ch.deliveryTarget !== null) {
            // Has someone to deliver to
            ch.state = CharacterState.IDLE; // Will pathfind to target in IDLE state
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount = 0;
            ch.wanderLimit = 1;
            ch.wanderTimer = 0;
          } else {
            // No delivery target - become available for new tasks
            ch.state = CharacterState.WAITING_TASK;
            ch.waitingForTask = true;
            ch.waitingTimer = 0;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
          break;
        }
      }
      // If no longer active, stand up and start wandering (after seatTimer expires)
      if (!ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0; // clear sentinel
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.WAITING_TASK: {
      // Agent is standing and available for tasks
      ch.frame = 0;
      ch.waitingTimer += dt;
      
      // If idle for too long without tasks, wander around
      if (ch.waitingTimer > 30 && ch.wanderTimer <= 0) {
        ch.state = CharacterState.BREAK;
        ch.breakType = 'rest';
        ch.breakTimer = randomRange(10, 30);
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }
      
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Pick a nearby tile to wander to while waiting
        const targetTile = pickNearbyWalkableTile(ch, _walkableTiles, 3);
        if (targetTile) {
          const path = findPath(ch.tileCol, ch.tileRow, targetTile.col, targetTile.row, tileMap, blockedTiles);
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
        }
        ch.wanderTimer = randomRange(5, 15);
      }
      break;
    }

    case CharacterState.DELIVER: {
      // Agent is interacting with another agent to deliver work
      ch.frame = 0;
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      
      // After delivery interaction, return to seat or wander
      ch.workTimer -= dt;
      if (ch.workTimer <= 0) {
        ch.deliveryTarget = null;
        ch.currentTask = null;
        
        // Decide what to do next
        if (Math.random() < 0.3) {
          // 30% chance to take a break
          ch.state = CharacterState.BREAK;
          ch.breakType = Math.random() < 0.5 ? 'coffee' : 'social';
          ch.breakTimer = randomRange(15, 45);
          ch.frame = 0;
          ch.frameTimer = 0;
        } else {
          // Return to seat and wait for new task
          ch.state = CharacterState.WAITING_TASK;
          ch.waitingForTask = true;
          ch.waitingTimer = 0;
          ch.frame = 0;
          ch.frameTimer = 0;
        }
      }
      break;
    }

    case CharacterState.BREAK: {
      // Agent is on break - coffee, socializing, or resting
      ch.frame = 0;
      ch.breakTimer -= dt;
      
      if (ch.breakTimer <= 0) {
        // Break over - return to seat and work
        ch.state = CharacterState.IDLE;
        ch.breakType = null;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderCount = 0;
        ch.wanderLimit = 1;
        ch.wanderTimer = 0;
      } else {
        // During break, occasionally wander a bit
        ch.wanderTimer -= dt;
        if (ch.wanderTimer <= 0 && ch.breakTimer > 5) {
          const targetTile = pickNearbyWalkableTile(ch, _walkableTiles, 2);
          if (targetTile) {
            const path = findPath(ch.tileCol, ch.tileRow, targetTile.col, targetTile.row, tileMap, blockedTiles);
            if (path.length > 0) {
              ch.path = path;
              ch.moveProgress = 0;
              ch.state = CharacterState.WALK;
              ch.frame = 0;
              ch.frameTimer = 0;
            }
          }
          ch.wanderTimer = randomRange(8, 20);
        }
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      
      // If has delivery target, pathfind to target agent
      if (ch.deliveryTarget !== null) {
        const path = findPath(
          ch.tileCol,
          ch.tileRow,
          ch.deliveryTarget ? 
            (Array.from(seats.values()).find(s => s.uid === String(ch.deliveryTarget))?.seatCol ?? ch.tileCol + 1) :
            ch.tileCol + 1,
          ch.deliveryTarget ?
            (Array.from(seats.values()).find(s => s.uid === String(ch.deliveryTarget))?.seatRow ?? ch.tileRow) :
            ch.tileRow,
          tileMap,
          blockedTiles,
        );
        
        if (path.length > 0) {
          ch.path = path;
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
      }
      
      // Active agents: either wander around or return to seat
      if (ch.isActive && !ch.inMeeting) {
        if (!ch.seatId) {
          // No seat assigned — type in place
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        // Check if we still have wander moves to do
        if (ch.wanderCount < ch.wanderLimit) {
          ch.wanderTimer -= dt;
          if (ch.wanderTimer <= 0) {
            // Pick a random nearby walkable tile to wander to
            const targetTile = pickNearbyWalkableTile(ch, _walkableTiles, WANDER_RADIUS_TILES);
            if (targetTile) {
              const path = findPath(
                ch.tileCol,
                ch.tileRow,
                targetTile.col,
                targetTile.row,
                tileMap,
                blockedTiles,
              );
              if (path.length > 0) {
                ch.path = path;
                ch.moveProgress = 0;
                ch.state = CharacterState.WALK;
                ch.frame = 0;
                ch.frameTimer = 0;
                ch.wanderCount++;
                break;
              }
            }
            // Couldn't find a path — just stay idle for now
            ch.wanderTimer = randomRange(WANDER_PAUSE_AFTER_MOVE_MIN_SEC, WANDER_PAUSE_AFTER_MOVE_MAX_SEC);
          }
          break;
        }
        // Done wandering — pathfind back to seat
        const seat = seats.get(ch.seatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          } else {
            // Check if actually at seat position
            const atSeat = ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow;
            if (atSeat) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              ch.frame = 0;
              ch.frameTimer = 0;
              // Reset workTimer for next work cycle
              ch.workTimer = randomRange(WORK_DURATION_MIN_SEC, WORK_DURATION_MAX_SEC);
            } else {
              // Pathfinding failed but not at seat — teleport as fallback
              console.warn(
                `[Pathfinding] Agent ${ch.id} teleporting to seat (${seat.seatCol},${seat.seatRow})`,
              );
              ch.tileCol = seat.seatCol;
              ch.tileRow = seat.seatRow;
              const center = tileCenter(seat.seatCol, seat.seatRow);
              ch.x = center.x;
              ch.y = center.y;
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              ch.frame = 0;
              ch.frameTimer = 0;
              ch.workTimer = randomRange(WORK_DURATION_MIN_SEC, WORK_DURATION_MAX_SEC);
            }
          }
        }
        break;
      }
      // Inactive agents stay where they are — no wandering or auto-return.
      // Return to seat only happens via explicit sendToSeat() / agent:return_to_seat event.
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        // Check if arrived at delivery target
        if (ch.deliveryTarget !== null) {
          // Arrived at target agent - start delivery interaction
          ch.state = CharacterState.DELIVER;
          ch.workTimer = randomRange(3, 8); // Delivery takes 3-8 seconds
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }

        if (ch.isActive) {
          if (ch.inMeeting) {
            // In a meeting — stay idle at meeting location, don't return to seat
            ch.state = CharacterState.IDLE;
          } else if (!ch.seatId) {
            // No seat — type in place
            ch.state = CharacterState.TYPE;
          } else {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              // Arrived at seat — sit down and start working
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              ch.workTimer = randomRange(WORK_DURATION_MIN_SEC, WORK_DURATION_MAX_SEC);
            } else {
              // Not at seat — pause briefly then continue wandering or return to seat
              ch.state = CharacterState.IDLE;
              ch.wanderTimer = randomRange(WANDER_PAUSE_AFTER_MOVE_MIN_SEC, WANDER_PAUSE_AFTER_MOVE_MAX_SEC);
            }
          }
        } else {
          // Check if arrived at assigned seat — sit down and stay
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              ch.seatTimer = 0;
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          // Arrived at non-seat tile — stay idle in place
          ch.state = CharacterState.IDLE;
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // If became active while wandering (not during a work break), repath to seat
      // Don't interrupt work-break wandering (when workTimer <= 0 and wanderCount < wanderLimit)
      if (ch.isActive && ch.seatId && !ch.inMeeting) {
        const isWorkBreakWander = ch.workTimer <= 0 && ch.wanderCount < ch.wanderLimit;
        if (!isWorkBreakWander) {
          const seat = seats.get(ch.seatId);
          if (seat) {
            const lastStep = ch.path[ch.path.length - 1];
            if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
              const newPath = findPath(
                ch.tileCol,
                ch.tileRow,
                seat.seatCol,
                seat.seatRow,
                tileMap,
                blockedTiles,
              );
              if (newPath.length > 0) {
                ch.path = newPath;
                ch.moveProgress = 0;
              }
            }
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1]; // Standing pose
    case CharacterState.WAITING_TASK:
      return sprites.walk[ch.dir][1]; // Standing, available
    case CharacterState.DELIVER:
      return sprites.typing[ch.dir][ch.frame % 2]; // Interaction animation
    case CharacterState.BREAK:
      // Use walk sprite but slower to show relaxed movement
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Pick a random walkable tile within a radius, excluding current position */
function pickNearbyWalkableTile(
  ch: Character,
  walkableTiles: Array<{ col: number; row: number }>,
  radius: number,
): { col: number; row: number } | null {
  const nearby = walkableTiles.filter(
    (t) =>
      Math.abs(t.col - ch.tileCol) <= radius &&
      Math.abs(t.row - ch.tileRow) <= radius &&
      !(t.col === ch.tileCol && t.row === ch.tileRow),
  );
  if (nearby.length === 0) return null;
  return nearby[Math.floor(Math.random() * nearby.length)];
}
