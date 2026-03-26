import type { SpriteData } from '../types/office';

/** Load an image and return it as a promise. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

/** Extract pixel data from an image region as SpriteData (string[][]). */
function imageToSpriteData(
  img: HTMLImageElement,
  sx: number, sy: number,
  sw: number, sh: number,
): SpriteData {
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const pixels = imageData.data;

  const sprite: SpriteData = [];
  for (let y = 0; y < sh; y++) {
    const row: string[] = [];
    for (let x = 0; x < sw; x++) {
      const idx = (y * sw + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];
      if (a < 2) {
        row.push('');
      } else if (a >= 255) {
        row.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
      } else {
        row.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a.toString(16).padStart(2, '0')}`);
      }
    }
    sprite.push(row);
  }
  return sprite;
}

// Character sprite sheet: 112x96 = 7 frames × 3 directions, each frame 16x32
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHAR_DIRECTIONS = ['down', 'up', 'right'] as const;

export interface CharacterDirectionSprites {
  down: SpriteData[]; // 7 frames
  up: SpriteData[];
  right: SpriteData[];
}

/** Load a character sprite sheet PNG and split into direction/frame sprites. */
export async function loadCharacterSheet(charIndex: number): Promise<CharacterDirectionSprites> {
  const img = await loadImage(`/assets/characters/char_${charIndex}.png`);
  const result: CharacterDirectionSprites = { down: [], up: [], right: [] };

  for (let dirIdx = 0; dirIdx < CHAR_DIRECTIONS.length; dirIdx++) {
    const dir = CHAR_DIRECTIONS[dirIdx];
    const rowY = dirIdx * CHAR_FRAME_H;
    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      const frameX = f * CHAR_FRAME_W;
      result[dir].push(imageToSpriteData(img, frameX, rowY, CHAR_FRAME_W, CHAR_FRAME_H));
    }
  }
  return result;
}

/** Load a floor tile PNG (16x16). */
export async function loadFloorTile(index: number): Promise<SpriteData> {
  const img = await loadImage(`/assets/floors/floor_${index}.png`);
  return imageToSpriteData(img, 0, 0, 16, 16);
}

/** Load a wall sprite sheet (64x128 = 4x4 grid of 16x32 pieces). */
export async function loadWallTiles(index = 0): Promise<SpriteData[]> {
  const img = await loadImage(`/assets/walls/wall_${index}.png`);
  const sprites: SpriteData[] = [];
  for (let mask = 0; mask < 16; mask++) {
    const col = mask % 4;
    const row = Math.floor(mask / 4);
    sprites.push(imageToSpriteData(img, col * 16, row * 32, 16, 32));
  }
  return sprites;
}

/** Load a furniture PNG by its folder/file name. */
export async function loadFurnitureSprite(folder: string, file: string): Promise<SpriteData> {
  const img = await loadImage(`/assets/furniture/${folder}/${file}.png`);
  return imageToSpriteData(img, 0, 0, img.width, img.height);
}

/** Load the full furniture manifest from a folder. */
export async function loadFurnitureManifest(folder: string): Promise<FurnitureManifest | null> {
  try {
    const resp = await fetch(`/assets/furniture/${folder}/manifest.json`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export interface FurnitureManifest {
  id: string;
  name: string;
  category: string;
  type: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
}

/** Extract all asset entries from a potentially nested manifest. */
function extractAssets(obj: Record<string, unknown>): Array<{ id: string; file: string; footprintW: number; footprintH: number }> {
  const results: Array<{ id: string; file: string; footprintW: number; footprintH: number }> = [];

  if (obj.type === 'asset' && obj.id && obj.file) {
    results.push({
      id: obj.id as string,
      file: (obj.file as string).replace('.png', ''),
      footprintW: (obj.footprintW as number) || 1,
      footprintH: (obj.footprintH as number) || 1,
    });
  }

  // Check for top-level asset (non-group)
  if (obj.type === 'asset' && !obj.file && obj.width) {
    results.push({
      id: obj.id as string,
      file: obj.id as string,
      footprintW: (obj.footprintW as number) || 1,
      footprintH: (obj.footprintH as number) || 1,
    });
  }

  // Recurse into members
  const members = obj.members as Record<string, unknown>[] | undefined;
  if (Array.isArray(members)) {
    for (const m of members) {
      results.push(...extractAssets(m));
    }
  }

  return results;
}

// ----- Bulk loading of all assets -----

export interface LoadedAssets {
  characters: CharacterDirectionSprites[];
  floors: SpriteData[];
  walls: SpriteData[];
  furniture: Map<string, { sprite: SpriteData; manifest: FurnitureManifest }>;
}

// All furniture folders to scan
const FURNITURE_FOLDERS = [
  'BIN', 'BOOKSHELF', 'CACTUS', 'CLOCK', 'COFFEE', 'COFFEE_TABLE',
  'CUSHIONED_BENCH', 'CUSHIONED_CHAIR', 'DESK', 'DOUBLE_BOOKSHELF',
  'HANGING_PLANT', 'LARGE_PAINTING', 'LARGE_PLANT', 'PC', 'PLANT',
  'PLANT_2', 'POT', 'SMALL_PAINTING', 'SMALL_PAINTING_2', 'SMALL_TABLE',
  'SOFA', 'TABLE_FRONT', 'WHITEBOARD', 'WOODEN_BENCH', 'WOODEN_CHAIR',
];

export async function loadAllAssets(): Promise<LoadedAssets> {
  // Load characters (6 sheets)
  const characters = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(i => loadCharacterSheet(i))
  );

  // Load floor tiles (9 patterns)
  const floors = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => loadFloorTile(i))
  );

  // Load wall tiles
  const walls = await loadWallTiles(0);

  // Load furniture by scanning manifests
  const furniture = new Map<string, { sprite: SpriteData; manifest: FurnitureManifest }>();

  const folderPromises = FURNITURE_FOLDERS.map(async (folder) => {
    const manifest = await loadFurnitureManifest(folder);
    if (!manifest) return;

    const assets = extractAssets(manifest as unknown as Record<string, unknown>);

    for (const asset of assets) {
      try {
        const sprite = await loadFurnitureSprite(folder, asset.file);
        furniture.set(asset.id, {
          sprite,
          manifest: {
            id: asset.id,
            name: asset.id,
            category: 'furniture',
            type: 'asset',
            width: sprite[0]?.length ?? 16,
            height: sprite.length,
            footprintW: asset.footprintW,
            footprintH: asset.footprintH,
          },
        });
      } catch {
        // Some files may not exist (e.g. alternative orientations)
      }
    }
  });

  await Promise.all(folderPromises);

  return { characters, floors, walls, furniture };
}
