import { TileType } from '../types/office';
import type { PlacedFurniture } from '../types/office';

const W = TileType.WALL;
const R = TileType.FLOOR_RECEPTION;
const Q = TileType.FLOOR_QA;
const D = TileType.FLOOR_DEV;
const L = TileType.FLOOR_LOGS;
const C = TileType.FLOOR_CEO;
const H = TileType.FLOOR_HALLWAY;
const M = TileType.FLOOR_MEETING;

export const OFFICE_COLS = 40;
export const OFFICE_ROWS = 26;

// Layout:
// TOP:    SUPORTE (cols 1-22)  |  REUNIAO (cols 23-38)
// HALL:   (rows 10-11)
// BOTTOM: QA (1-10) | DEV (11-20) | LOGS (21-28) | CEO (29-38)
export const OFFICE_TILES: TileType[][] = [
  // Row 0: top wall
  [W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W],
  // Rows 1-9: SUPORTE (1-22) | REUNIAO (23-38)
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  [W,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,R,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,W],
  // Rows 10-11: Hallway
  [W,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,W],
  [W,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,W],
  // Rows 12-24: QA (1-10) | DEV (11-20) | LOGS (21-28) | CEO (29-38)
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  [W,Q,Q,Q,Q,Q,Q,Q,Q,Q,Q,D,D,D,D,D,D,D,D,D,D,L,L,L,L,L,L,L,L,C,C,C,C,C,C,C,C,C,C,W],
  // Row 25: bottom wall
  [W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W],
];

export const OFFICE_FURNITURE: PlacedFurniture[] = [
  // ============ SUPORTE (10 PCs) - cols 1-22, rows 1-9 ============
  // Row 1: 5 desks
  { typeId: 'DESK_FRONT', col: 1, row: 1 },  { typeId: 'PC_FRONT_ON_1', col: 2, row: 1 },
  { typeId: 'DESK_FRONT', col: 5, row: 1 },  { typeId: 'PC_FRONT_ON_2', col: 6, row: 1 },
  { typeId: 'DESK_FRONT', col: 9, row: 1 },  { typeId: 'PC_FRONT_ON_3', col: 10, row: 1 },
  { typeId: 'DESK_FRONT', col: 13, row: 1 }, { typeId: 'PC_FRONT_ON_1', col: 14, row: 1 },
  { typeId: 'DESK_FRONT', col: 17, row: 1 }, { typeId: 'PC_FRONT_ON_2', col: 18, row: 1 },
  // Row 2: 5 desks
  { typeId: 'DESK_FRONT', col: 1, row: 5 },  { typeId: 'PC_FRONT_ON_3', col: 2, row: 5 },
  { typeId: 'DESK_FRONT', col: 5, row: 5 },  { typeId: 'PC_FRONT_ON_1', col: 6, row: 5 },
  { typeId: 'DESK_FRONT', col: 9, row: 5 },  { typeId: 'PC_FRONT_ON_2', col: 10, row: 5 },
  { typeId: 'DESK_FRONT', col: 13, row: 5 }, { typeId: 'PC_FRONT_ON_3', col: 14, row: 5 },
  { typeId: 'DESK_FRONT', col: 17, row: 5 }, { typeId: 'PC_FRONT_ON_1', col: 18, row: 5 },
  // Decor
  { typeId: 'PLANT', col: 21, row: 1 },
  { typeId: 'COFFEE', col: 22, row: 8 },
  { typeId: 'PLANT_2', col: 21, row: 8 },

  // ============ REUNIAO (cols 23-38, rows 1-9) ============
  // One big long table down the center (cols 29-32, rows 2-8)
  { typeId: 'TABLE_FRONT', col: 29, row: 2 },
  { typeId: 'TABLE_FRONT', col: 29, row: 4 },
  { typeId: 'TABLE_FRONT', col: 29, row: 6 },
  { typeId: 'TABLE_FRONT', col: 32, row: 2 },
  { typeId: 'TABLE_FRONT', col: 32, row: 4 },
  { typeId: 'TABLE_FRONT', col: 32, row: 6 },
  // Left side chairs (col 28)
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 28, row: 2 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 28, row: 3 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 28, row: 4 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 28, row: 5 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 28, row: 6 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 28, row: 7 },
  // Right side chairs (col 33)
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 33, row: 2 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 33, row: 3 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 33, row: 4 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 33, row: 5 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 33, row: 6 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 33, row: 7 },
  // Head chairs
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 30, row: 1 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 31, row: 1 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 30, row: 8 },
  { typeId: 'CUSHIONED_CHAIR_FRONT', col: 31, row: 8 },
  // Decor
  { typeId: 'WHITEBOARD', col: 25, row: 1 },
  { typeId: 'PLANT', col: 23, row: 1 },
  { typeId: 'PLANT', col: 38, row: 1 },
  { typeId: 'CLOCK', col: 36, row: 1 },
  { typeId: 'PLANT', col: 23, row: 8 },
  { typeId: 'PLANT', col: 38, row: 8 },

  // ============ QA (5 PCs) - cols 1-10, rows 12-24 ============
  { typeId: 'DESK_FRONT', col: 1, row: 12 }, { typeId: 'PC_FRONT_ON_1', col: 2, row: 12 },
  { typeId: 'DESK_FRONT', col: 5, row: 12 }, { typeId: 'PC_FRONT_ON_2', col: 6, row: 12 },
  { typeId: 'DESK_FRONT', col: 1, row: 16 }, { typeId: 'PC_FRONT_ON_3', col: 2, row: 16 },
  { typeId: 'DESK_FRONT', col: 5, row: 16 }, { typeId: 'PC_FRONT_ON_1', col: 6, row: 16 },
  { typeId: 'DESK_FRONT', col: 1, row: 20 }, { typeId: 'PC_FRONT_ON_2', col: 2, row: 20 },
  // Decor
  { typeId: 'BOOKSHELF', col: 9, row: 12 },
  { typeId: 'PLANT_2', col: 10, row: 23 },

  // ============ DEV (5 PCs) - cols 11-20, rows 12-24 ============
  { typeId: 'DESK_FRONT', col: 11, row: 12 }, { typeId: 'PC_FRONT_ON_2', col: 12, row: 12 },
  { typeId: 'DESK_FRONT', col: 15, row: 12 }, { typeId: 'PC_FRONT_ON_3', col: 16, row: 12 },
  { typeId: 'DESK_FRONT', col: 11, row: 16 }, { typeId: 'PC_FRONT_ON_1', col: 12, row: 16 },
  { typeId: 'DESK_FRONT', col: 15, row: 16 }, { typeId: 'PC_FRONT_ON_2', col: 16, row: 16 },
  { typeId: 'DESK_FRONT', col: 11, row: 20 }, { typeId: 'PC_FRONT_ON_3', col: 12, row: 20 },
  // Decor
  { typeId: 'BOOKSHELF', col: 19, row: 12 },
  { typeId: 'PLANT', col: 20, row: 23 },
  { typeId: 'BIN', col: 20, row: 24 },

  // ============ LOGS (5 PCs) - cols 21-28, rows 12-24 ============
  { typeId: 'DESK_FRONT', col: 21, row: 12 }, { typeId: 'PC_FRONT_ON_1', col: 22, row: 12 },
  { typeId: 'DESK_FRONT', col: 25, row: 12 }, { typeId: 'PC_FRONT_ON_2', col: 26, row: 12 },
  { typeId: 'DESK_FRONT', col: 21, row: 16 }, { typeId: 'PC_FRONT_ON_3', col: 22, row: 16 },
  { typeId: 'DESK_FRONT', col: 25, row: 16 }, { typeId: 'PC_FRONT_ON_1', col: 26, row: 16 },
  { typeId: 'DESK_FRONT', col: 21, row: 20 }, { typeId: 'PC_FRONT_ON_2', col: 22, row: 20 },
  // Decor
  { typeId: 'CACTUS', col: 28, row: 23 },

  // ============ CEO (cols 29-38, rows 12-24) ============
  { typeId: 'DESK_FRONT', col: 32, row: 14 }, { typeId: 'PC_FRONT_ON_1', col: 33, row: 14 },
  // Decor
  { typeId: 'BOOKSHELF', col: 29, row: 12 },
  { typeId: 'BOOKSHELF', col: 36, row: 12 },
  { typeId: 'PLANT', col: 29, row: 23 },
  { typeId: 'PLANT', col: 38, row: 23 },
  { typeId: 'SOFA_FRONT', col: 34, row: 21 },

  // ============ HALLWAY DECOR ============
  { typeId: 'PLANT_2', col: 5, row: 10 },
  { typeId: 'PLANT_2', col: 15, row: 10 },
  { typeId: 'PLANT_2', col: 30, row: 10 },
];
