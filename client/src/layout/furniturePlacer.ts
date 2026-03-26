import { TILE_SIZE } from '../types/office';
import type { PlacedFurniture, FurnitureInstance } from '../types/office';
import { FURNITURE_CATALOG } from '../sprites/furnitureSprites';

export function buildFurnitureInstances(placed: PlacedFurniture[]): FurnitureInstance[] {
  return placed.map(p => {
    const ftype = FURNITURE_CATALOG[p.typeId];
    if (!ftype) {
      console.warn(`Unknown furniture type: ${p.typeId}`);
      return null;
    }
    // Sprite may be taller than footprint (e.g. 16x32 sprite on 1x1 footprint)
    // Anchor at bottom of footprint, sprite extends upward
    const spriteH = ftype.sprite.length;
    const footprintPixelH = ftype.footprintH * TILE_SIZE;
    const yOffset = footprintPixelH - spriteH; // Negative if sprite is taller

    return {
      typeId: p.typeId,
      sprite: ftype.sprite,
      col: p.col,
      row: p.row,
      pixelX: p.col * TILE_SIZE,
      pixelY: p.row * TILE_SIZE + yOffset,
      zY: (p.row + ftype.footprintH) * TILE_SIZE,
      footprintW: ftype.footprintW,
      footprintH: ftype.footprintH,
    };
  }).filter((f): f is FurnitureInstance => f !== null);
}

export function buildBlockedTiles(furniture: FurnitureInstance[]): Set<string> {
  const blocked = new Set<string>();
  for (const f of furniture) {
    for (let dy = 0; dy < f.footprintH; dy++) {
      for (let dx = 0; dx < f.footprintW; dx++) {
        blocked.add(`${f.col + dx},${f.row + dy}`);
      }
    }
  }
  return blocked;
}
