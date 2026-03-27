import type { SpriteData, CharacterSprites } from '../types/office';
import { Direction } from '../types/office';
import type { AgentRole } from '../types/agents';
import type { CharacterDirectionSprites } from './assetLoader';
import { flipSpriteHorizontal } from '../engine/spriteCache';
import { hueShiftSprite } from './colorize';

// Loaded character sprite sheets from PNGs
let loadedCharacters: CharacterDirectionSprites[] = [];

export function setLoadedCharacters(chars: CharacterDirectionSprites[]): void {
  loadedCharacters = chars;
  spriteCache.clear(); // Clear cache when assets reload
}

// Which base character (0-5) to use per role
const ROLE_CHAR_INDEX: Record<AgentRole, number> = {
  ceo: 0,
  suporte: 1,
  qa: 2,
  qa_manager: 2,
  dev: 3,
  dev_lead: 3,
  log_analyzer: 4,
};

// Optional hue shifts per role for extra distinction
const ROLE_HUE_SHIFT: Record<AgentRole, number> = {
  ceo: 0,
  suporte: 0,
  qa: 0,
  qa_manager: 40,
  dev: 0,
  dev_lead: 60,
  log_analyzer: 0,
};

function buildSpritesFromSheet(sheet: CharacterDirectionSprites, hueShift: number): CharacterSprites {
  const d = sheet.down;  // 7 frames: walk1,walk2,walk3, type1,type2, read1,read2
  const u = sheet.up;
  const r = sheet.right;

  const maybeShift = (sprites: SpriteData[]): SpriteData[] => {
    if (hueShift === 0) return sprites;
    return sprites.map(s => hueShiftSprite(s, hueShift));
  };

  // Walk: frames 0,1,2,1 (bounce cycle)
  const walkDown = maybeShift([d[0], d[1], d[2], d[1]]);
  const walkUp = maybeShift([u[0], u[1], u[2], u[1]]);
  const walkRight = maybeShift([r[0], r[1], r[2], r[1]]);
  const walkLeft = walkRight.map(f => flipSpriteHorizontal(f));

  // Type: frames 3,4
  const typeDown = maybeShift([d[3], d[4]]);
  const typeUp = maybeShift([u[3], u[4]]);
  const typeRight = maybeShift([r[3], r[4]]);
  const typeLeft = typeRight.map(f => flipSpriteHorizontal(f));

  // Idle: just frame 1 (standing pose)
  const idleDown = maybeShift([d[1], d[1]]);
  const idleUp = maybeShift([u[1], u[1]]);
  const idleRight = maybeShift([r[1], r[1]]);
  const idleLeft = idleRight.map(f => flipSpriteHorizontal(f));

  return {
    walk: {
      [Direction.DOWN]: walkDown,
      [Direction.UP]: walkUp,
      [Direction.RIGHT]: walkRight,
      [Direction.LEFT]: walkLeft,
    },
    type: {
      [Direction.DOWN]: typeDown,
      [Direction.UP]: typeUp,
      [Direction.RIGHT]: typeRight,
      [Direction.LEFT]: typeLeft,
    },
    idle: {
      [Direction.DOWN]: idleDown,
      [Direction.UP]: idleUp,
      [Direction.RIGHT]: idleRight,
      [Direction.LEFT]: idleLeft,
    },
  };
}

const spriteCache = new Map<AgentRole, CharacterSprites>();

export function getCharacterSprites(role: AgentRole): CharacterSprites {
  const cached = spriteCache.get(role);
  if (cached) return cached;

  const charIndex = ROLE_CHAR_INDEX[role] % loadedCharacters.length;
  const sheet = loadedCharacters[charIndex];

  if (!sheet) {
    // Fallback: create empty sprites if assets not loaded yet
    const empty: SpriteData = Array(32).fill(null).map(() => Array(16).fill(''));
    const emptyFrames = [empty, empty, empty, empty];
    const emptyDir = {
      [Direction.DOWN]: emptyFrames,
      [Direction.UP]: emptyFrames,
      [Direction.RIGHT]: emptyFrames,
      [Direction.LEFT]: emptyFrames,
    };
    return { walk: emptyDir, type: emptyDir, idle: emptyDir };
  }

  const hueShift = ROLE_HUE_SHIFT[role];
  const sprites = buildSpritesFromSheet(sheet, hueShift);
  spriteCache.set(role, sprites);
  return sprites;
}
