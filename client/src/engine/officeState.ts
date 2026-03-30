import { TileType, CharacterState, TILE_SIZE } from '../types/office';
import type { Seat, FurnitureInstance } from '../types/office';
import type { Character, AgentRole, SectorId, AgentTask } from '../types/agents';
import { ROLE_SECTOR } from '../types/agents';
import type { PersonalityBehavior } from '../types/agentProfile';
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

export interface SectorStats {
  suporte: { total: number; resolvidos: number; fila: number; agentes: number };
  qa: { analisados: number; aprovados: number; agentes: number };
  dev: { casosAbertos: number; casosResolvidos: number; agentes: number };
  logs: { totalLogs: number; logsResolvidos: number; analisados: number; errosReais: number; agentes: number };
  ceo: { agentesAtivos: number; ocupados: number; ociosos: number; fila: number };
}

export class OfficeState {
  tiles: TileType[][];
  furniture: FurnitureInstance[];
  characters: Map<string, Character> = new Map();
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  tasks: Map<string, AgentTask> = new Map();
  queueSize = 0;
  sectorStats: SectorStats = {
    suporte: { total: 0, resolvidos: 0, fila: 0, agentes: 0 },
    qa: { analisados: 0, aprovados: 0, agentes: 0 },
    dev: { casosAbertos: 0, casosResolvidos: 0, agentes: 0 },
    logs: { totalLogs: 0, logsResolvidos: 0, analisados: 0, errosReais: 0, agentes: 0 },
    ceo: { agentesAtivos: 0, ocupados: 0, ociosos: 0, fila: 0 },
  };
  private listeners: OfficeEventCallback[] = [];
  private pendingArrivals: Map<string, { targetSeat: string; callback?: () => void }> = new Map();

  zoom = 2;
  panX = 0;
  panY = 0;

  constructor() {
    this.tiles = OFFICE_TILES;
    // Furniture will be empty until assets load and rebuild() is called
    this.furniture = [];
    this.seats = buildSeats();
    this.blockedTiles = new Set();
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

  addAgent(role: AgentRole, behavior?: PersonalityBehavior): Character | null {
    const sectorId = ROLE_SECTOR[role];
    const seat = findAvailableSeat(this.seats, sectorId);
    if (!seat) return null; // No available seats

    seat.occupiedBy = 'pending';

    const sector = SECTORS[sectorId];
    // Spawn at the door of the sector
    const door = sector.doorPosition;

    const ch = createCharacter(role, door.col, door.row, seat.id, sectorId, behavior);
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
      // Record actual seat position for wander return
      ch.seatCol = seat.col;
      ch.seatRow = seat.row;
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

    // Offset arrival to avoid stacking on the same door tile
    let targetCol = door.col;
    let targetRow = door.row;
    // Check if another character is already at or heading to the door
    for (const other of this.characters.values()) {
      if (other.id !== ch.id && Math.abs(other.col - targetCol) < 2 && Math.abs(other.row - targetRow) < 2) {
        // Offset by 1-2 tiles
        const offsets = [{col: 1, row: 0}, {col: -1, row: 0}, {col: 0, row: 1}, {col: 2, row: 0}];
        for (const off of offsets) {
          const nc = targetCol + off.col;
          const nr = targetRow + off.row;
          if (!this.blockedTiles.has(`${nc},${nr}`)) {
            targetCol = nc;
            targetRow = nr;
            break;
          }
        }
        break;
      }
    }

    // First go to our sector's door, then to hallway, then to target door
    const success = sendCharacterTo(ch, targetCol, targetRow, this.tiles, this.blockedTiles);

    if (success) {
      this.pendingArrivals.set(ch.id, {
        targetSeat: '',
        callback: () => {
          ch.targetSectorId = null;
          // Face down into the room (not toward the wall)
          ch.direction = 0; // Direction.DOWN
          ch.state = CharacterState.TALK;
          if (callback) callback();
          // Return to own sector after a pause
          setTimeout(() => {
            this.returnAgentToSeat(agentId);
          }, 3000);
        },
      });
    }

    return success;
  }

  /** Send an agent to sit in the meeting room (2-step: door then seat). */
  sendAgentToMeetingRoom(agentId: string): boolean {
    const ch = this.characters.get(agentId);
    if (!ch) return false;

    // Find an available meeting room seat
    const meetingSector = SECTORS['MEETING_ROOM'];
    let targetSeat: { col: number; row: number; facingDir: number } | null = null;

    for (const seatPos of meetingSector.seatPositions) {
      let occupied = false;
      // Check if claimed by a pending arrival
      for (const arrival of this.pendingArrivals.values()) {
        if (arrival.targetSeat === `meeting_${seatPos.col}_${seatPos.row}`) {
          occupied = true;
          break;
        }
      }
      // Check if another character is already there
      if (!occupied) {
        for (const other of this.characters.values()) {
          if (other.id !== ch.id && other.col === seatPos.col && other.row === seatPos.row) {
            occupied = true;
            break;
          }
        }
      }
      if (!occupied) {
        targetSeat = seatPos;
        break;
      }
    }

    // Step 1: Walk to the meeting room door (this always works)
    const door = meetingSector.doorPosition;
    ch.targetSectorId = 'MEETING_ROOM';

    const success = sendCharacterTo(ch, door.col, door.row, this.tiles, this.blockedTiles);
    if (!success) return false;

    const seat = targetSeat;
    const seatKey = seat ? `meeting_${seat.col}_${seat.row}` : '';

    this.pendingArrivals.set(ch.id, {
      targetSeat: seatKey,
      callback: () => {
        if (seat) {
          // Step 2: From the door, walk to the seat
          const seatSuccess = sendCharacterTo(ch, seat.col, seat.row, this.tiles, this.blockedTiles);
          if (seatSuccess) {
            this.pendingArrivals.set(ch.id, {
              targetSeat: seatKey,
              callback: () => {
                ch.targetSectorId = null;
                ch.direction = seat.facingDir;
                ch.col = seat.col;
                ch.row = seat.row;
                ch.pixelX = seat.col * TILE_SIZE;
                ch.pixelY = seat.row * TILE_SIZE;
                ch.state = CharacterState.TALK;
              },
            });
          } else {
            // Can't reach seat, just snap there
            ch.targetSectorId = null;
            ch.direction = seat.facingDir;
            ch.col = seat.col;
            ch.row = seat.row;
            ch.pixelX = seat.col * TILE_SIZE;
            ch.pixelY = seat.row * TILE_SIZE;
            ch.state = CharacterState.TALK;
          }
        } else {
          // No seat available, stand at door
          ch.targetSectorId = null;
          ch.direction = 0;
          ch.state = CharacterState.TALK;
        }
      },
    });

    return true;
  }

  /** Send an agent to walk to another agent's position. */
  sendAgentToAgent(agentId: string, targetAgentName: string, callback?: () => void): boolean {
    const ch = this.characters.get(agentId);
    if (!ch) return false;

    // Find target agent by name
    let target: Character | null = null;
    for (const c of this.characters.values()) {
      if (c.name === targetAgentName) {
        target = c;
        break;
      }
    }
    if (!target) return false;

    ch.state = CharacterState.WALK;

    // Walk to a tile adjacent to the target (one row below)
    const targetCol = target.col;
    const targetRow = target.row + 1;

    const success = sendCharacterTo(ch, targetCol, targetRow, this.tiles, this.blockedTiles);

    if (success) {
      this.pendingArrivals.set(ch.id, {
        targetSeat: '',
        callback: () => {
          ch.state = CharacterState.TALK;
          // Face toward the target agent
          if (target!.row < ch.row) ch.direction = 3; // UP
          else if (target!.row > ch.row) ch.direction = 0; // DOWN
          else if (target!.col < ch.col) ch.direction = 1; // LEFT
          else ch.direction = 2; // RIGHT
          if (callback) callback();
          // Return to own sector after a pause
          setTimeout(() => {
            this.returnAgentToSeat(agentId);
          }, 5000);
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

  /** Update sector stats from store data */
  updateStats(tickets: Array<{status: string; classification?: string; discordAuthor?: string}>, cases: Array<{status: string}>, queueSize: number): void {
    const chars = Array.from(this.characters.values());

    // Suporte
    const suporteAgents = chars.filter(c => c.role === 'suporte');
    const totalTickets = tickets.length;
    const resolvedTickets = tickets.filter(t => t.status === 'done').length;
    this.sectorStats.suporte = {
      total: totalTickets,
      resolvidos: resolvedTickets,
      fila: queueSize,
      agentes: suporteAgents.length,
    };

    // QA
    const qaAgents = chars.filter(c => c.role === 'qa' || c.role === 'qa_manager');
    const bugTickets = tickets.filter(t => t.classification === 'bug');
    this.sectorStats.qa = {
      analisados: bugTickets.length,
      aprovados: bugTickets.filter(t => t.status === 'done' || t.status === 'escalated').length,
      agentes: qaAgents.length,
    };

    // DEV
    const devAgents = chars.filter(c => c.role === 'dev' || c.role === 'dev_lead');
    this.sectorStats.dev = {
      casosAbertos: cases.filter(c => c.status === 'open' || c.status === 'in_progress').length,
      casosResolvidos: cases.filter(c => c.status === 'resolved').length,
      agentes: devAgents.length,
    };

    // Logs
    const logAgents = chars.filter(c => c.role === 'log_analyzer');
    const logTickets = tickets.filter(t => t.discordAuthor?.startsWith('[LOG]') || t.classification === 'log_analysis');
    this.sectorStats.logs = {
      totalLogs: logTickets.length,
      logsResolvidos: logTickets.filter(t => t.status === 'done').length,
      analisados: logTickets.length,
      errosReais: logTickets.filter(t => t.status === 'escalated' || t.status === 'processing').length,
      agentes: logAgents.length,
    };

    // CEO
    const busyAgents = chars.filter(c => c.state === CharacterState.TYPE || c.state === CharacterState.TALK || c.state === CharacterState.WALK);
    this.sectorStats.ceo = {
      agentesAtivos: chars.length,
      ocupados: busyAgents.length,
      ociosos: chars.length - busyAgents.length,
      fila: queueSize,
    };
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
      this.sectorStats,
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
