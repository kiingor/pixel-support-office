import type { SpriteData } from '../types/office';

const cache = new Map<string, HTMLCanvasElement>();

function makeCacheKey(sprite: SpriteData, zoom: number): string {
  // Use object identity via a WeakMap-like approach, but since SpriteData
  // is reused frequently, we'll hash the first row + dimensions + zoom
  const h = sprite.length;
  const w = sprite[0]?.length ?? 0;
  const sample = (sprite[0]?.[0] ?? '') + (sprite[h >> 1]?.[w >> 1] ?? '');
  return `${h}_${w}_${sample}_${zoom}_${sprite[0]?.join('').slice(0, 20)}`;
}

// Sprite identity map for proper caching
let nextId = 0;
const spriteIds = new WeakMap<SpriteData, number>();

function getSpriteId(sprite: SpriteData): number {
  let id = spriteIds.get(sprite);
  if (id === undefined) {
    id = nextId++;
    spriteIds.set(sprite, id);
  }
  return id;
}

export function getCachedSprite(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  const key = `${getSpriteId(sprite)}_${zoom}`;
  let cached = cache.get(key);
  if (cached) return cached;

  const h = sprite.length;
  const w = sprite[0]?.length ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = w * zoom;
  canvas.height = h * zoom;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const color = sprite[row][col];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(col * zoom, row * zoom, zoom, zoom);
    }
  }

  cache.set(key, canvas);
  return canvas;
}

export function flipSpriteHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map(row => [...row].reverse());
}

export function clearSpriteCache(): void {
  cache.clear();
}
