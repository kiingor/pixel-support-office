import { TileType, TILE_SIZE, CharacterState, Direction } from '../types/office';
import type { FurnitureInstance, SpriteData } from '../types/office';
import type { Character } from '../types/agents';
import { getCachedSprite } from './spriteCache';
import { getFloorSprite, getWallSprite } from '../sprites/tileSprites';
import { BUBBLE_SPRITES } from '../sprites/bubbleSprites';
import { SECTORS } from '../layout/sectorConfig';

const CHARACTER_SITTING_OFFSET_PX = 6;

interface ZDrawable {
  zY: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  tiles: TileType[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  zoom: number,
  panX: number,
  panY: number,
  queueSize = 0,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Background
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.translate(panX, panY);

  // Render floor tiles only (walls will be z-sorted with furniture)
  renderFloorGrid(ctx, tiles, zoom);

  // Collect z-sorted drawables
  const drawables: ZDrawable[] = [];

  // Add wall instances (they're tall: 16x32, need z-sorting)
  addWallDrawables(drawables, tiles, zoom);

  // Add furniture
  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite, zoom);
    const fx = f.pixelX * zoom;
    const fy = f.pixelY * zoom;
    drawables.push({
      zY: f.zY,
      draw: (c) => { c.drawImage(cached, fx, fy); },
    });
  }

  // Add characters
  for (const ch of characters) {
    const sprite = getCharacterSpriteFrame(ch);
    if (!sprite) continue;
    const cached = getCachedSprite(sprite, zoom);

    const sittingOffset = (ch.state === CharacterState.TYPE || ch.state === CharacterState.TALK)
      ? CHARACTER_SITTING_OFFSET_PX : 0;

    // Character anchor: bottom-center at (pixelX + 8, pixelY + 16)
    const drawX = Math.round(ch.pixelX * zoom);
    const drawY = Math.round((ch.pixelY - TILE_SIZE + sittingOffset) * zoom);
    const charZY = ch.pixelY + TILE_SIZE;

    drawables.push({
      zY: charZY,
      draw: (c) => { c.drawImage(cached, drawX, drawY); },
    });
  }

  // Sort by zY and draw
  drawables.sort((a, b) => a.zY - b.zY);
  for (const d of drawables) {
    d.draw(ctx);
  }

  // Render speech bubbles (always on top)
  renderBubbles(ctx, characters, zoom);

  // Render agent names
  renderAgentNames(ctx, characters, zoom);

  // Render sector labels
  renderSectorLabels(ctx, zoom);

  // Render queue alert badge
  if (queueSize > 0) {
    renderQueueAlert(ctx, zoom, queueSize);
  }

  ctx.restore();
}

function renderFloorGrid(
  ctx: CanvasRenderingContext2D,
  tiles: TileType[][],
  zoom: number,
): void {
  const s = TILE_SIZE * zoom;
  for (let row = 0; row < tiles.length; row++) {
    for (let col = 0; col < tiles[row].length; col++) {
      const tile = tiles[row][col];
      if (tile === TileType.VOID || tile === TileType.WALL) continue;

      const floorSprite = getFloorSprite(tile);
      const cached = getCachedSprite(floorSprite, zoom);
      ctx.drawImage(cached, col * s, row * s);
    }
  }
}

function addWallDrawables(
  drawables: ZDrawable[],
  tiles: TileType[][],
  zoom: number,
): void {
  for (let row = 0; row < tiles.length; row++) {
    for (let col = 0; col < tiles[row].length; col++) {
      if (tiles[row][col] !== TileType.WALL) continue;

      const wallSprite = getWallSprite(col, row, tiles);
      if (!wallSprite) continue;

      const cached = getCachedSprite(wallSprite, zoom);
      const x = col * TILE_SIZE * zoom;
      // Wall sprites are 16x32, anchored at bottom of tile (extends upward)
      const y = (row * TILE_SIZE + TILE_SIZE - wallSprite.length) * zoom;
      const zY = (row + 1) * TILE_SIZE;

      drawables.push({
        zY,
        draw: (c) => { c.drawImage(cached, x, y); },
      });
    }
  }
}

function getCharacterSpriteFrame(ch: Character): SpriteData | null {
  const sprites = ch.sprites;
  let frames: SpriteData[];

  switch (ch.state) {
    case CharacterState.WALK:
      frames = sprites.walk[ch.direction];
      break;
    case CharacterState.TYPE:
    case CharacterState.TALK:
      frames = sprites.type[ch.direction] || sprites.idle[ch.direction];
      break;
    case CharacterState.IDLE:
    default:
      frames = sprites.idle[ch.direction];
      break;
  }

  if (!frames || frames.length === 0) return null;
  return frames[ch.animFrame % frames.length];
}

function renderBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  zoom: number,
): void {
  const now = performance.now();

  for (const ch of characters) {
    for (const bubble of ch.bubbles) {
      const elapsed = now - bubble.startTime;
      const remaining = bubble.duration - elapsed;

      let alpha = 1;
      if (remaining < 500) alpha = remaining / 500;
      if (elapsed < 200) alpha = Math.min(alpha, elapsed / 200);
      if (alpha <= 0) continue;

      const bubbleSprite = BUBBLE_SPRITES[bubble.type] || BUBBLE_SPRITES.processing;
      const cached = getCachedSprite(bubbleSprite, zoom);

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      const bx = Math.round(ch.pixelX * zoom + (TILE_SIZE * zoom) / 2 - cached.width / 2);
      const by = Math.round((ch.pixelY - TILE_SIZE) * zoom - cached.height - 2 * zoom);

      ctx.drawImage(cached, bx, by);

      if (bubble.text) {
        const fontSize = Math.max(8, zoom * 4);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        const tx = Math.round(ch.pixelX * zoom + (TILE_SIZE * zoom) / 2);
        const ty = by - 2 * zoom;
        const text = bubble.text.slice(0, 25);

        // Dark background pill behind text
        const metrics = ctx.measureText(text);
        const padX = 4 * zoom;
        const padY = 2 * zoom;
        const bgX = tx - metrics.width / 2 - padX;
        const bgY = ty - fontSize - padY;
        const bgW = metrics.width + padX * 2;
        const bgH = fontSize + padY * 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        const radius = 3 * zoom;
        ctx.beginPath();
        ctx.moveTo(bgX + radius, bgY);
        ctx.lineTo(bgX + bgW - radius, bgY);
        ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + radius);
        ctx.lineTo(bgX + bgW, bgY + bgH - radius);
        ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - radius, bgY + bgH);
        ctx.lineTo(bgX + radius, bgY + bgH);
        ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - radius);
        ctx.lineTo(bgX, bgY + radius);
        ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
        ctx.closePath();
        ctx.fill();

        // White text on dark background
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, tx, ty);
      }

      ctx.restore();
    }
  }
}

const ROLE_COLORS: Record<string, string> = {
  ceo: '#f0c040',
  suporte: '#4488ff',
  qa: '#aa44ff',
  qa_manager: '#cc66ff',
  dev: '#ff8844',
  dev_lead: '#ff5522',
  log_analyzer: '#44cc88',
};

function renderAgentNames(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  zoom: number,
): void {
  if (zoom < 2) return; // Too small to read

  const fontSize = Math.max(7, zoom * 3.5);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';

  for (const ch of characters) {
    const cx = Math.round(ch.pixelX * zoom + (TILE_SIZE * zoom) / 2);
    // Name ABOVE the character
    const cy = Math.round((ch.pixelY - TILE_SIZE) * zoom - 4 * zoom);

    // White outline for readability on dark backgrounds
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 2;
    ctx.strokeText(ch.name, cx, cy);

    // Black text
    ctx.fillStyle = '#000000';
    ctx.fillText(ch.name, cx, cy);

    // Status indicator for working agents (TYPE = working at desk)
    if (ch.state === CharacterState.TYPE || ch.state === CharacterState.TALK) {
      renderBusyIndicator(ctx, cx, cy, zoom, ch.state, ch.role);
    }
  }
}

/** Render a small animated pixel-art status icon next to the agent name */
function renderBusyIndicator(
  ctx: CanvasRenderingContext2D,
  nameX: number,
  nameY: number,
  zoom: number,
  state: CharacterState,
  role: string,
): void {
  const s = Math.max(2, zoom * 1.5); // Pixel size
  const x = nameX + 20 * zoom; // Right of name
  const y = nameY - 4 * zoom;  // Aligned with name

  ctx.save();

  if (state === CharacterState.TYPE) {
    // Typing indicator: small green monitor icon with blinking cursor
    const blink = Math.sin(performance.now() / 400) > 0;

    // Monitor frame
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x, y, s * 5, s * 4);
    ctx.fillStyle = role === 'log_analyzer' ? '#0a2a0a' : '#0a1a2a';
    ctx.fillRect(x + s * 0.5, y + s * 0.5, s * 4, s * 2.5);

    // Screen content (green for logs, blue for others)
    const screenColor = role === 'log_analyzer' ? '#44cc88' : '#4488ff';
    ctx.fillStyle = screenColor;
    ctx.fillRect(x + s, y + s, s * 1.5, s * 0.5);
    if (blink) {
      ctx.fillRect(x + s * 3, y + s, s * 0.5, s * 0.5);
    }
    ctx.fillRect(x + s, y + s * 1.5, s * 2.5, s * 0.5);

    // Stand
    ctx.fillStyle = '#333';
    ctx.fillRect(x + s * 2, y + s * 3.5, s, s * 0.5);
  } else if (state === CharacterState.TALK) {
    // Talking indicator: small speech wave icon
    const wave = Math.sin(performance.now() / 300);

    ctx.fillStyle = '#f0c040';
    // Three bars like sound waves
    ctx.fillRect(x, y + s, s * 0.8, s * 2);
    ctx.fillRect(x + s * 1.2, y + s * 0.5 + wave * s * 0.3, s * 0.8, s * 3);
    ctx.fillRect(x + s * 2.4, y + s * 0.8, s * 0.8, s * 1.5);
  }

  ctx.restore();
}

function renderSectorLabels(
  ctx: CanvasRenderingContext2D,
  zoom: number,
): void {
  ctx.save();
  const fontSize = Math.max(8, zoom * 5);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';

  for (const sector of Object.values(SECTORS)) {
    const centerCol = (sector.bounds.colStart + sector.bounds.colEnd) / 2;
    const labelRow = sector.bounds.rowStart;

    const lx = centerCol * TILE_SIZE * zoom;
    const ly = (labelRow * TILE_SIZE + 6) * zoom;
    // White outline then black text
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 2;
    ctx.strokeText(sector.name, lx, ly);
    ctx.fillStyle = '#000000cc';
    ctx.fillText(
      sector.name,
      lx,
      ly,
    );
  }

  ctx.restore();
}

function renderQueueAlert(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  queueSize: number,
): void {
  const sector = SECTORS.RECEPTION;
  const bounds = sector.bounds;

  // Position at top-right of the RECEPTION sector
  const badgeX = bounds.colEnd * TILE_SIZE * zoom - 4 * zoom;
  const badgeY = (bounds.rowStart * TILE_SIZE + 10) * zoom;

  // Pulsate effect using sin wave
  const pulse = 1 + 0.08 * Math.sin(performance.now() / 300);
  const radius = 8 * zoom * pulse;

  ctx.save();

  // Red circle badge
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#e74c3c';
  ctx.fill();
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 1.5 * zoom;
  ctx.stroke();

  // Queue count number
  const fontSize = Math.max(8, zoom * 5);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(queueSize), badgeX, badgeY);

  ctx.restore();
}
