import { Direction } from '../types/office';
import type { Seat } from '../types/office';
import type { SectorId } from '../types/agents';

export interface SectorConfig {
  id: SectorId;
  name: string;
  labelColor: string;
  bounds: { colStart: number; colEnd: number; rowStart: number; rowEnd: number };
  seatPositions: Array<{ col: number; row: number; facingDir: Direction }>;
  doorPosition: { col: number; row: number };
}

export const SECTORS: Record<SectorId, SectorConfig> = {
  RECEPTION: {
    id: 'RECEPTION',
    name: 'Suporte',
    labelColor: '#4488ff',
    bounds: { colStart: 1, colEnd: 22, rowStart: 1, rowEnd: 9 },
    seatPositions: [
      // Row 1 (desks rows 1-2, seats row 3)
      { col: 2,  row: 3, facingDir: Direction.UP },
      { col: 6,  row: 3, facingDir: Direction.UP },
      { col: 10, row: 3, facingDir: Direction.UP },
      { col: 14, row: 3, facingDir: Direction.UP },
      { col: 18, row: 3, facingDir: Direction.UP },
      // Row 2 (desks rows 5-6, seats row 7)
      { col: 2,  row: 7, facingDir: Direction.UP },
      { col: 6,  row: 7, facingDir: Direction.UP },
      { col: 10, row: 7, facingDir: Direction.UP },
      { col: 14, row: 7, facingDir: Direction.UP },
      { col: 18, row: 7, facingDir: Direction.UP },
    ],
    doorPosition: { col: 11, row: 10 },
  },
  MEETING_ROOM: {
    id: 'MEETING_ROOM',
    name: 'Sala de Reuniao',
    labelColor: '#cc8844',
    bounds: { colStart: 23, colEnd: 38, rowStart: 1, rowEnd: 9 },
    seatPositions: [
      // Left side seats
      { col: 27, row: 2, facingDir: Direction.RIGHT },
      { col: 27, row: 4, facingDir: Direction.RIGHT },
      { col: 27, row: 6, facingDir: Direction.RIGHT },
      // Right side seats
      { col: 34, row: 2, facingDir: Direction.LEFT },
      { col: 34, row: 4, facingDir: Direction.LEFT },
      { col: 34, row: 6, facingDir: Direction.LEFT },
      // Head seats
      { col: 30, row: 9, facingDir: Direction.UP },
      { col: 31, row: 9, facingDir: Direction.UP },
    ],
    doorPosition: { col: 30, row: 10 },
  },
  QA_ROOM: {
    id: 'QA_ROOM',
    name: 'QA',
    labelColor: '#aa44ff',
    bounds: { colStart: 1, colEnd: 10, rowStart: 12, rowEnd: 24 },
    seatPositions: [
      { col: 2,  row: 14, facingDir: Direction.UP },
      { col: 6,  row: 14, facingDir: Direction.UP },
      { col: 2,  row: 18, facingDir: Direction.UP },
      { col: 6,  row: 18, facingDir: Direction.UP },
      { col: 2,  row: 22, facingDir: Direction.UP },
    ],
    doorPosition: { col: 5, row: 11 },
  },
  DEV_ROOM: {
    id: 'DEV_ROOM',
    name: 'DEV',
    labelColor: '#ff8844',
    bounds: { colStart: 11, colEnd: 20, rowStart: 12, rowEnd: 24 },
    seatPositions: [
      { col: 12, row: 14, facingDir: Direction.UP },
      { col: 16, row: 14, facingDir: Direction.UP },
      { col: 12, row: 18, facingDir: Direction.UP },
      { col: 16, row: 18, facingDir: Direction.UP },
      { col: 12, row: 22, facingDir: Direction.UP },
    ],
    doorPosition: { col: 15, row: 11 },
  },
  LOGS_ROOM: {
    id: 'LOGS_ROOM',
    name: 'Logs',
    labelColor: '#44cc88',
    bounds: { colStart: 21, colEnd: 28, rowStart: 12, rowEnd: 24 },
    seatPositions: [
      { col: 22, row: 14, facingDir: Direction.UP },
      { col: 26, row: 14, facingDir: Direction.UP },
      { col: 22, row: 18, facingDir: Direction.UP },
      { col: 26, row: 18, facingDir: Direction.UP },
      { col: 22, row: 22, facingDir: Direction.UP },
    ],
    doorPosition: { col: 24, row: 11 },
  },
  CEO_ROOM: {
    id: 'CEO_ROOM',
    name: 'CEO',
    labelColor: '#f0c040',
    bounds: { colStart: 29, colEnd: 38, rowStart: 12, rowEnd: 24 },
    seatPositions: [
      { col: 33, row: 16, facingDir: Direction.UP },
    ],
    doorPosition: { col: 33, row: 11 },
  },
};

export function buildSeats(): Map<string, Seat> {
  const seats = new Map<string, Seat>();
  for (const sector of Object.values(SECTORS)) {
    sector.seatPositions.forEach((pos, i) => {
      const id = `${sector.id}_seat_${i}`;
      seats.set(id, {
        id,
        col: pos.col,
        row: pos.row,
        facingDir: pos.facingDir,
        sectorId: sector.id,
      });
    });
  }
  return seats;
}

export function findAvailableSeat(seats: Map<string, Seat>, sectorId: SectorId): Seat | null {
  for (const seat of seats.values()) {
    if (seat.sectorId === sectorId && !seat.occupiedBy) {
      return seat;
    }
  }
  return null;
}
