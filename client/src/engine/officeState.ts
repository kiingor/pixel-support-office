import { TileType, CharacterState, TILE_SIZE } from '../types/office';
import type { Seat, FurnitureInstance } from '../types/office';
import type { Character, AgentRole, SectorId, AgentTask } from '../types/agents';
import { ROLE_SECTOR } from '../types/agents';
import { OFFICE_TILES, OFFICE_FURNITURE, OFFICE_COLS, OFFICE_ROWS } from '../layout/officeLayout';
import { SECTORS, buildSeats, findAvailableSeat } from '../layout/sectorConfig';
import { buildFurnitureInstances, buildBlockedTiles } from '../layout/furniturePlacer';
import { createCharacter, updateCharacter, sendCharacterTo, addBubble, sitAtDesk } from './characters';
import { renderFrame } from './renderer';

export type OfficeEventCallback = (event: OfficeEvent) => void;

export interface OfficeEvent {
  type: 'agent_hired' | 'agent_fired' | 'agent_status' | 'agent_arrived' | 'task_assigned' | 'task_completed' | 'bubble';
  agentId?: string;
  data?: Record<string, unknown>;
}

export class OfficeState {
  tiles: TileType[][];
  furniture: FurnitureInstance[];
  characters: Map<string, Character> = new Map();
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  tasks: Map<string, AgentTask> = new Map();
  queueSize = 0;
  private listeners: OfficeEventCallback[] = [];
  private pendingArrivals: Map<string, { targetSeat: string; callback?: () => void }> = new Map();

  zoom = 2;
  panX = 0;
  panY = 0;

  constructor() {
    this.tiles = OFFICE_TILES;
    this.furniture = buildFurnitureInstances(OFFICE_FURNITURE);
    this.seats = buildSeats();
    this.blockedTiles = buildBlockedTiles(this.furniture);
  }

  /** Rebuild furniture instances after assets are loaded. */
  rebuild(): void {
    this.furniture = buildFurnitureInstances(OFFICE_FURNITURE);
    this.blockedTiles = buildBlockedTiles(this.furniture);
  }

  onEvent(cb: OfficeEventCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private emit(event: OfficeEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  addAgent(role: AgentRole): Character | null {
    const sectorId = ROLE_SECTOR[role];
    const seat = findAvailableSeat(this.seats, sectorId);
    if (!seat) return null; // No available seats

    seat.occupiedBy = 'pending';

    const sector = SECTORS[sectorId];
    // Spawn at the door of the sector
    const door = sector.doorPosition;

    const ch = createCharacter(role, door.col, door.row, seat.id, sectorId);
    this.characters.set(ch.id, ch);

    // Walk to seat
    seat.occupiedBy = ch.id;
    this.pendingArrivals.set(ch.id, { targetSeat: seat.id, callback: () => {
      ch.state = CharacterState.TYPE;
      ch.direction = seat.facingDir;
      ch.col = seat.col;
      ch.row = seat.row;
      ch.pixelX = seat.col * TILE_SIZE;
      ch.pixelY = seat.row * TILE_SIZE;
    }});

    sendCharacterTo(ch, seat.col, seat.row, this.tiles, this.blockedTiles);
    addBubble(ch, 'Olá!', 'done', 3);

    this.emit({ type: 'agent_hired', agentId: ch.id, data: { name: ch.name, role } });
    return ch;
  }

  removeAgent(id: string): boolean {
    const ch = this.characters.get(id);
    if (!ch || ch.role === 'ceo') return false;

    // Free the seat
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.occupiedBy = undefined;
    }

    // If agent has a task, return it to the task list
    if (ch.currentTaskId) {
      const task = this.tasks.get(ch.currentTaskId);
      if (task) {
        task.status = 'pending';
        task.assignedAgentId = null;
      }
    }

    addBubble(ch, 'Tchau!', 'alert', 2);

    // Walk to door then remove
    const sector = SECTORS[ch.sectorId];
    const door = sector.doorPosition;
    sendCharacterTo(ch, door.col, door.row, this.tiles, this.blockedTiles);

    this.pendingArrivals.set(ch.id, {
      targetSeat: '',
      callback: () => {
        this.characters.delete(id);
      },
    });

    this.emit({ type: 'agent_fired', agentId: id });
    return true;
  }

  /** Make an agent walk to another sector to hand off work. */
  sendAgentToSector(agentId: string, targetSectorId: SectorId, callback?: () => void): boolean {
    const ch = this.characters.get(agentId);
    if (!ch) return false;

    ch.targetSectorId = targetSectorId;
    ch.state = CharacterState.WALK;

    const targetSector = SECTORS[targetSectorId];
    const door = targetSector.doorPosition;

    // First go to our sector's door, then to hallway, then to target door
    const success = sendCharacterTo(ch, door.col, door.row, this.tiles, this.blockedTiles);

    if (success) {
      this.pendingArrivals.set(ch.id, {
        targetSeat: '',
        callback: () => {
          ch.targetSectorId = null;
          if (callback) callback();
          // Return to own sector
          setTimeout(() => {
            this.returnAgentToSeat(agentId);
          }, 2000);
        },
      });
    }

    return success;
  }

  /** Return an agent to their assigned seat. */
  returnAgentToSeat(agentId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;

    const seat = this.seats.get(ch.seatId);
    if (!seat) return;

    const success = sendCharacterTo(ch, seat.col, seat.row, this.tiles, this.blockedTiles);
    if (success) {
      this.pendingArrivals.set(ch.id, {
        targetSeat: seat.id,
        callback: () => {
          ch.state = CharacterState.TYPE;
          ch.direction = seat.facingDir;
          ch.col = seat.col;
          ch.row = seat.row;
          ch.pixelX = seat.col * TILE_SIZE;
          ch.pixelY = seat.row * TILE_SIZE;
        },
      });
    }
  }

  /** Find an idle agent of a given role. */
  findIdleAgent(role: AgentRole): Character | null {
    for (const ch of this.characters.values()) {
      if (ch.role === role && !ch.currentTaskId && ch.state !== CharacterState.WALK) {
        return ch;
      }
    }
    return null;
  }

  update(dt: number): void {
    for (const ch of this.characters.values()) {
      const prevState = ch.state;
      updateCharacter(ch, dt, this.tiles, this.blockedTiles);

      // Check if character just arrived (was walking, now idle)
      if (prevState === CharacterState.WALK && ch.state === CharacterState.IDLE) {
        const arrival = this.pendingArrivals.get(ch.id);
        if (arrival) {
          this.pendingArrivals.delete(ch.id);
          if (arrival.callback) arrival.callback();
          this.emit({ type: 'agent_arrived', agentId: ch.id });
        }
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number): void {
    renderFrame(
      ctx,
      canvasW,
      canvasH,
      this.tiles,
      this.furniture,
      Array.from(this.characters.values()),
      this.zoom,
      this.panX,
      this.panY,
      this.queueSize,
    );
  }

  getAgentAt(screenX: number, screenY: number): Character | null {
    const worldX = (screenX - this.panX) / this.zoom;
    const worldY = (screenY - this.panY) / this.zoom;

    for (const ch of this.characters.values()) {
      const cx = ch.pixelX;
      const cy = ch.pixelY - 16; // Sprite is drawn 16px above position
      if (worldX >= cx && worldX < cx + 16 && worldY >= cy && worldY < cy + 32) {
        return ch;
      }
    }
    return null;
  }

  getFurnitureAt(screenX: number, screenY: number): FurnitureInstance | null {
    const worldX = (screenX - this.panX) / this.zoom;
    const worldY = (screenY - this.panY) / this.zoom;

    // Check in reverse order (top-most = drawn last)
    for (let i = this.furniture.length - 1; i >= 0; i--) {
      const f = this.furniture[i];
      const fw = f.sprite[0]?.length ?? 16;
      const fh = f.sprite.length;
      if (worldX >= f.pixelX && worldX < f.pixelX + fw &&
          worldY >= f.pixelY && worldY < f.pixelY + fh) {
        return f;
      }
    }
    return null;
  }

  removeFurniture(furniture: FurnitureInstance): void {
    const idx = this.furniture.indexOf(furniture);
    if (idx === -1) return;
    this.furniture.splice(idx, 1);
    // Rebuild blocked tiles
    this.blockedTiles = buildBlockedTiles(this.furniture);
  }
}
