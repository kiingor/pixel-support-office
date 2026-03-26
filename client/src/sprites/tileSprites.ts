import type { SpriteData } from '../types/office';
import { TileType } from '../types/office';
import { parseHex, rgbToHsl, hslToRgb, toHex } from './colorize';

// Loaded floor tile patterns from PNGs
let loadedFloors: SpriteData[] = [];
let loadedWalls: SpriteData[] = []; // 16 bitmask pieces

export function setLoadedFloors(floors: SpriteData[]): void {
  loadedFloors = floors;
  floorCache.clear();
}

export function setLoadedWalls(walls: SpriteData[]): void {
  loadedWalls = walls;
}

// Sector-specific floor: which pattern + colorize tint (Photoshop-style colorize)
const SECTOR_FLOOR_CONFIG: Record<number, { patternIndex: number; tintH: number; tintS: number }> = {
  [TileType.FLOOR_RECEPTION]: { patternIndex: 1, tintH: 0.6,  tintS: 0.35 }, // Blue
  [TileType.FLOOR_QA]:        { patternIndex: 2, tintH: 0.78, tintS: 0.30 }, // Purple
  [TileType.FLOOR_DEV]:       { patternIndex: 3, tintH: 0.08, tintS: 0.35 }, // Orange
  [TileType.FLOOR_LOGS]:      { patternIndex: 4, tintH: 0.35, tintS: 0.30 }, // Green
  [TileType.FLOOR_CEO]:       { patternIndex: 5, tintH: 0.12, tintS: 0.40 }, // Gold
  [TileType.FLOOR_HALLWAY]:   { patternIndex: 0, tintH: 0.0,  tintS: 0.0  }, // Gray (no tint)
  [TileType.FLOOR_MEETING]:   { patternIndex: 6, tintH: 0.55, tintS: 0.25 }, // Warm beige/cream
};

/** Photoshop-style Colorize: preserve luminance, apply fixed hue/saturation. */
function colorizeSpriteFloor(sprite: SpriteData, tintH: number, tintS: number): SpriteData {
  if (tintS === 0) return sprite; // No tint = keep original grayscale
  return sprite.map(row =>
    row.map(pixel => {
      if (!pixel) return pixel;
      const [r, g, b] = parseHex(pixel);
      const [, , l] = rgbToHsl(r, g, b);
      const [nr, ng, nb] = hslToRgb(tintH, tintS, l);
      return toHex(nr, ng, nb);
    })
  );
}

const floorCache = new Map<number, SpriteData>();

export function getFloorSprite(tileType: number): SpriteData {
  const cached = floorCache.get(tileType);
  if (cached) return cached;

  const config = SECTOR_FLOOR_CONFIG[tileType];
  if (!config || loadedFloors.length === 0) {
    return makeFallbackFloor(tileType);
  }

  const basePattern = loadedFloors[config.patternIndex % loadedFloors.length];
  const colorized = colorizeSpriteFloor(basePattern, config.tintH, config.tintS);
  floorCache.set(tileType, colorized);
  return colorized;
}

// Wall auto-tiling bitmask
export function getWallSprite(col: number, row: number, tiles: TileType[][]): SpriteData | null {
  if (loadedWalls.length === 0) return FALLBACK_WALL;

  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;

  let mask = 0;
  if (row > 0 && tiles[row - 1][col] === TileType.WALL) mask |= 1;      // N
  if (col < cols - 1 && tiles[row][col + 1] === TileType.WALL) mask |= 2; // E
  if (row < rows - 1 && tiles[row + 1][col] === TileType.WALL) mask |= 4; // S
  if (col > 0 && tiles[row][col - 1] === TileType.WALL) mask |= 8;       // W

  return loadedWalls[mask] ?? loadedWalls[0];
}

// Fallback tiles when PNGs aren't loaded yet
function makeFallbackFloor(tileType: number): SpriteData {
  const colors: Record<number, string> = {
    [TileType.FLOOR_RECEPTION]: '#2a3a5a',
    [TileType.FLOOR_QA]: '#3a2a4a',
    [TileType.FLOOR_DEV]: '#4a3020',
    [TileType.FLOOR_LOGS]: '#2a3a2a',
    [TileType.FLOOR_CEO]: '#3a3520',
    [TileType.FLOOR_HALLWAY]: '#2a2a2a',
    [TileType.FLOOR_MEETING]: '#3a3530',
  };
  const color = colors[tileType] || '#2a2a2a';
  return Array(16).fill(null).map(() => Array(16).fill(color));
}

const FALLBACK_WALL: SpriteData = Array(32).fill(null).map((_, i) => {
  const c = i < 3 ? '#1a1a2e' : i < 16 ? '#334466' : i < 28 ? '#2a3a55' : '#1a1a2e';
  return Array(16).fill(c);
});
