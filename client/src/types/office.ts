export const TILE_SIZE = 16;

export enum TileType {
  VOID = 255,
  WALL = 0,
  FLOOR_RECEPTION = 1,
  FLOOR_QA = 2,
  FLOOR_DEV = 3,
  FLOOR_LOGS = 4,
  FLOOR_CEO = 5,
  FLOOR_HALLWAY = 6,
  FLOOR_MEETING = 7,
}

export enum Direction {
  DOWN = 0,
  LEFT = 1,
  RIGHT = 2,
  UP = 3,
}

export enum CharacterState {
  IDLE = 'idle',
  WALK = 'walk',
  TYPE = 'type',
  TALK = 'talk',
}

/** 2D array of hex color strings. Empty string = transparent pixel. */
export type SpriteData = string[][];

export interface CharacterSprites {
  walk: { [dir in Direction]: SpriteData[] };  // 4 frames per direction
  type: { [dir in Direction]: SpriteData[] };   // 2 frames
  idle: { [dir in Direction]: SpriteData[] };   // 2 frames
}

export interface Position {
  col: number;
  row: number;
}

export interface PixelPosition {
  x: number;
  y: number;
}

export interface Seat {
  id: string;
  col: number;
  row: number;
  facingDir: Direction;
  sectorId: string;
  occupiedBy?: string;
}

export interface FurnitureType {
  id: string;
  sprite: SpriteData;
  footprintW: number;
  footprintH: number;
}

export interface PlacedFurniture {
  typeId: string;
  col: number;
  row: number;
}

export interface FurnitureInstance {
  typeId: string;
  sprite: SpriteData;
  col: number;
  row: number;
  pixelX: number;
  pixelY: number;
  zY: number;
  footprintW: number;
  footprintH: number;
}

export interface Bubble {
  text: string;
  type: 'processing' | 'done' | 'handoff' | 'alert' | 'chat';
  startTime: number;
  duration: number;
}
