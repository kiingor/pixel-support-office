import type { SpriteData, FurnitureType } from '../types/office';
import type { LoadedAssets } from './assetLoader';

// Loaded furniture sprites from PNGs
let loadedFurniture = new Map<string, { sprite: SpriteData; footprintW: number; footprintH: number }>();

export function setLoadedFurniture(assets: LoadedAssets['furniture']): void {
  loadedFurniture.clear();
  for (const [id, { sprite, manifest }] of assets) {
    loadedFurniture.set(id, {
      sprite,
      footprintW: manifest.footprintW,
      footprintH: manifest.footprintH,
    });
  }
  rebuildCatalog();
}

// Dynamic catalog built from loaded assets
export const FURNITURE_CATALOG: Record<string, FurnitureType> = {};

function rebuildCatalog(): void {
  // Clear existing
  for (const key in FURNITURE_CATALOG) delete FURNITURE_CATALOG[key];

  for (const [id, data] of loadedFurniture) {
    FURNITURE_CATALOG[id] = {
      id,
      sprite: data.sprite,
      footprintW: data.footprintW,
      footprintH: data.footprintH,
    };
  }
}

export function getFurnitureSprite(id: string): SpriteData | null {
  const data = loadedFurniture.get(id);
  return data?.sprite ?? null;
}
