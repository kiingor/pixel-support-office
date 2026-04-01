import { TileType, TILE_SIZE, CharacterState, Direction } from '../types/office';
import type { FurnitureInstance, SpriteData } from '../types/office';
import type { Character } from '../types/agents';
import type { SectorStats } from './officeState';
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
  sectorStats?: SectorStats,
  workingAgents?: Set<string>,
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
    const isWorking = workingAgents?.has(ch.name) || ch.state === CharacterState.TALK;
    const isWalking = ch.state === CharacterState.WALK;

    drawables.push({
      zY: charZY,
      draw: (c) => {
        // Strong pulsing aura when agent is working
        if (isWorking && zoom >= 2) {
          const pulse = 0.5 + 0.25 * Math.sin(performance.now() / 500);
          const auraColor = ROLE_COLORS[ch.role] || '#4488ff';
          const cx = drawX + cached.width / 2;
          const cy = drawY + cached.height / 2;
          const rx = cached.width * 0.7;
          const ry = cached.height * 0.55;

          c.save();
          // Outer glow (large, soft)
          c.globalAlpha = pulse * 0.4;
          c.beginPath();
          c.ellipse(cx, cy, rx * 1.6, ry * 1.6, 0, 0, Math.PI * 2);
          c.fillStyle = auraColor;
          c.fill();
          // Middle ring
          c.globalAlpha = pulse * 0.7;
          c.beginPath();
          c.ellipse(cx, cy, rx * 1.2, ry * 1.2, 0, 0, Math.PI * 2);
          c.fillStyle = auraColor;
          c.fill();
          // Inner core (bright)
          c.globalAlpha = pulse;
          c.beginPath();
          c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          c.fillStyle = auraColor;
          c.fill();
          c.restore();
        }
        // Walking trail when moving between sectors
        if (isWalking && zoom >= 2) {
          const trailAlpha = 0.15 + 0.05 * Math.sin(performance.now() / 200);
          c.save();
          c.globalAlpha = trailAlpha;
          c.fillStyle = '#ffffff';
          // Small dots behind the character
          for (let i = 1; i <= 3; i++) {
            const dotSize = (4 - i) * zoom * 0.5;
            c.beginPath();
            c.arc(drawX + cached.width / 2, drawY + cached.height + i * 3 * zoom, dotSize, 0, Math.PI * 2);
            c.fill();
          }
          c.restore();
        }
        c.drawImage(cached, drawX, drawY);
      },
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
  renderAgentNames(ctx, characters, zoom, workingAgents);

  // Render sector labels
  renderSectorLabels(ctx, zoom);

  // Render sector KPIs
  if (sectorStats && zoom >= 2) {
    renderSectorKPIs(ctx, sectorStats, zoom);
  }

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
  workingAgents?: Set<string>,
): void {
  if (zoom < 2) return; // Too small to read

  const fontSize = Math.max(9, zoom * 5);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';

  const ROLE_SHORT: Record<string, string> = {
    ceo: 'CEO', suporte: 'Suporte', qa: 'QA Sênior', qa_manager: 'Ger. QA',
    dev: 'DEV Sênior', dev_lead: 'Tech Lead', log_analyzer: 'Log Analyzer',
  };

  for (const ch of characters) {
    const cx = Math.round(ch.pixelX * zoom + (TILE_SIZE * zoom) / 2);
    // Name ABOVE the character
    const cy = Math.round((ch.pixelY - TILE_SIZE) * zoom - 6 * zoom);

    // Agent name (bold, larger) + star for leaders
    const isLeader = ch.role === 'qa_manager' || ch.role === 'dev_lead' || ch.role === 'ceo';
    const displayName = isLeader ? `★ ${ch.name}` : ch.name;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 2.5;
    ctx.strokeText(displayName, cx, cy);
    ctx.fillStyle = '#000000';
    ctx.fillText(displayName, cx, cy);
    // Draw the star in gold on top of the black text
    if (isLeader) {
      const starWidth = ctx.measureText('★ ').width;
      const nameWidth = ctx.measureText(displayName).width;
      const starX = cx - nameWidth / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f0c040';
      ctx.fillText('★', starX, cy);
      ctx.textAlign = 'center';
    }

    // Role label below name (smaller, colored)
    const roleSize = Math.max(7, zoom * 3.5);
    ctx.font = `bold ${roleSize}px monospace`;
    const roleColor = ROLE_COLORS[ch.role] || '#888';
    ctx.fillStyle = roleColor;
    ctx.fillText(ROLE_SHORT[ch.role] || ch.role, cx, cy + fontSize * 0.9);

    // Status indicator for working agents (based on server work status, not sprite state)
    if (workingAgents?.has(ch.name) || ch.state === CharacterState.TALK) {
      renderBusyIndicator(ctx, cx, cy, zoom, CharacterState.TYPE, ch.role);
    }
  }
}

/** Render a pixel-art working status icon next to agent name */
function renderBusyIndicator(
  ctx: CanvasRenderingContext2D,
  nameX: number,
  nameY: number,
  zoom: number,
  state: CharacterState,
  role: string,
): void {
  const s = Math.max(2, zoom * 2); // Pixel size (bigger)
  const x = nameX + 18 * zoom;
  const y = nameY - 5 * zoom;
  const blink = Math.sin(performance.now() / 400) > 0;

  ctx.save();

  if (state === CharacterState.TYPE) {
    if (role === 'dev' || role === 'dev_lead') {
      // DEV: Code brackets icon </> with blinking cursor
      const c = '#ff8844';
      ctx.fillStyle = '#0a1428';
      ctx.fillRect(x, y, s * 7, s * 5);
      ctx.strokeStyle = '#1a3a5c';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, s * 7, s * 5);
      // < bracket
      ctx.fillStyle = c;
      ctx.fillRect(x + s, y + s, s * 0.7, s * 0.7);
      ctx.fillRect(x + s * 0.5, y + s * 1.5, s * 0.7, s * 0.7);
      ctx.fillRect(x + s, y + s * 2.5, s * 0.7, s * 0.7);
      // / slash
      ctx.fillRect(x + s * 2.5, y + s * 0.8, s * 0.7, s * 0.7);
      ctx.fillRect(x + s * 3, y + s * 1.5, s * 0.7, s * 0.7);
      ctx.fillRect(x + s * 3.5, y + s * 2.2, s * 0.7, s * 0.7);
      // > bracket
      ctx.fillRect(x + s * 5, y + s, s * 0.7, s * 0.7);
      ctx.fillRect(x + s * 5.5, y + s * 1.5, s * 0.7, s * 0.7);
      ctx.fillRect(x + s * 5, y + s * 2.5, s * 0.7, s * 0.7);
      // Blinking cursor
      if (blink) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + s * 3, y + s * 3.5, s * 0.5, s * 0.8);
      }

    } else if (role === 'log_analyzer') {
      // LOG: Terminal icon with scrolling text
      ctx.fillStyle = '#0a2a0a';
      ctx.fillRect(x, y, s * 7, s * 5);
      ctx.strokeStyle = '#44cc88';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, s * 7, s * 5);
      // Terminal lines
      ctx.fillStyle = '#44cc88';
      ctx.fillRect(x + s * 0.5, y + s * 0.8, s * 0.5, s * 0.5); // $
      ctx.fillRect(x + s * 1.2, y + s * 0.8, s * 3, s * 0.5);
      ctx.fillRect(x + s * 0.5, y + s * 1.8, s * 0.5, s * 0.5);
      ctx.fillRect(x + s * 1.2, y + s * 1.8, s * 2, s * 0.5);
      ctx.fillRect(x + s * 0.5, y + s * 2.8, s * 0.5, s * 0.5);
      ctx.fillStyle = '#e74c3c'; // Error line in red
      ctx.fillRect(x + s * 1.2, y + s * 2.8, s * 4, s * 0.5);
      if (blink) {
        ctx.fillStyle = '#44cc88';
        ctx.fillRect(x + s * 0.5, y + s * 3.8, s * 0.7, s * 0.5);
      }

    } else if (role === 'qa' || role === 'qa_manager') {
      // QA: Magnifying glass / bug search icon
      ctx.fillStyle = '#0a1a2a';
      ctx.fillRect(x, y, s * 6, s * 5);
      ctx.strokeStyle = '#aa44ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, s * 6, s * 5);
      // Bug icon
      ctx.fillStyle = '#aa44ff';
      ctx.fillRect(x + s * 1.5, y + s * 1, s * 2, s * 2); // body
      ctx.fillRect(x + s * 1, y + s * 1.5, s * 0.5, s * 0.5); // left leg
      ctx.fillRect(x + s * 3.5, y + s * 1.5, s * 0.5, s * 0.5); // right leg
      ctx.fillRect(x + s * 2, y + s * 0.5, s, s * 0.5); // head
      // Check mark
      if (blink) {
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(x + s * 4, y + s * 3, s * 0.5, s * 0.5);
        ctx.fillRect(x + s * 4.5, y + s * 3.5, s * 0.5, s * 0.5);
      }

    } else {
      // SUPORTE/CEO: Chat/headset icon
      ctx.fillStyle = '#0a1a2a';
      ctx.fillRect(x, y, s * 6, s * 5);
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, s * 6, s * 5);
      // Headset shape
      ctx.fillStyle = '#4488ff';
      ctx.fillRect(x + s * 1.5, y + s * 0.5, s * 2.5, s * 0.5); // top band
      ctx.fillRect(x + s * 1, y + s * 1, s * 0.8, s * 2); // left ear
      ctx.fillRect(x + s * 3.7, y + s * 1, s * 0.8, s * 2); // right ear
      // Mic
      ctx.fillRect(x + s * 2, y + s * 3, s * 0.5, s * 1.2);
      ctx.fillRect(x + s * 1.5, y + s * 4, s * 1.5, s * 0.5);
    }

  } else if (state === CharacterState.TALK) {
    // Talking: speech icon
    ctx.fillStyle = '#0a1a2a';
    ctx.fillRect(x, y, s * 5, s * 4);
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, s * 5, s * 4);
    // Speech lines
    ctx.fillStyle = '#f0c040';
    ctx.fillRect(x + s * 0.8, y + s * 0.8, s * 3, s * 0.5);
    ctx.fillRect(x + s * 0.8, y + s * 1.8, s * 2, s * 0.5);
    if (blink) {
      ctx.fillRect(x + s * 0.8, y + s * 2.8, s * 2.5, s * 0.5);
    }
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

// ===== SECTOR KPI DISPLAY =====

interface KPILine {
  icon: string;    // Color for the small square icon
  label: string;
  value: number;
}

function renderSectorKPIs(
  ctx: CanvasRenderingContext2D,
  stats: SectorStats,
  zoom: number,
): void {
  const s = TILE_SIZE * zoom;

  // Suporte KPIs — bottom-right corner of RECEPTION (away from desks)
  renderKPIPanel(ctx, zoom, s, 17, 7, [
    { icon: '#4488ff', label: 'Tickets', value: stats.suporte.total },
    { icon: '#2ecc71', label: 'Resolvidos', value: stats.suporte.resolvidos },
    { icon: '#e74c3c', label: 'Na fila', value: stats.suporte.fila || 0 },
    { icon: '#f39c12', label: 'Agentes', value: stats.suporte.agentes },
  ]);

  // QA KPIs — bottom-right corner of QA_ROOM
  renderKPIPanel(ctx, zoom, s, 7, 21, [
    { icon: '#aa44ff', label: 'Analisados', value: stats.qa.analisados },
    { icon: '#2ecc71', label: 'Aprovados', value: stats.qa.aprovados },
    { icon: '#f39c12', label: 'Agentes', value: stats.qa.agentes },
  ]);

  // DEV KPIs — bottom-right corner of DEV_ROOM
  renderKPIPanel(ctx, zoom, s, 17, 21, [
    { icon: '#e74c3c', label: 'Abertos', value: stats.dev.casosAbertos },
    { icon: '#2ecc71', label: 'Resolvidos', value: stats.dev.casosResolvidos },
    { icon: '#f39c12', label: 'Agentes', value: stats.dev.agentes },
  ]);

  // Logs KPIs — bottom-right of expanded LOGS_ROOM
  renderKPIPanel(ctx, zoom, s, 27, 21, [
    { icon: '#4488ff', label: 'Total', value: stats.logs.total },
    { icon: '#e74c3c', label: 'Pendentes', value: stats.logs.naoAnalisados },
    { icon: '#44cc88', label: 'Analisados', value: stats.logs.analisados },
    { icon: '#2ecc71', label: 'Resolvidos', value: stats.logs.resolvidos },
    { icon: '#f39c12', label: 'Agentes', value: stats.logs.agentes },
  ]);

  // CEO KPIs — compact CEO room
  renderKPIPanel(ctx, zoom, s, 34, 19, [
    { icon: '#4488ff', label: 'Ativos', value: stats.ceo.agentesAtivos },
    { icon: '#2ecc71', label: 'Ocupados', value: stats.ceo.ocupados },
    { icon: '#95a5a6', label: 'Ociosos', value: stats.ceo.ociosos },
    { icon: '#e74c3c', label: 'Fila', value: stats.ceo.fila || 0 },
  ]);
}

function renderKPIPanel(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  tileSize: number,
  col: number,
  row: number,
  lines: KPILine[],
): void {
  const fontSize = Math.max(8, zoom * 4.5);
  const lineHeight = fontSize + 4 * zoom;
  const padX = 5 * zoom;
  const padY = 4 * zoom;
  const iconSize = Math.max(4, zoom * 3);

  const x = col * tileSize;
  const y = row * tileSize;
  const panelW = 38 * zoom;
  const panelH = padY * 2 + lines.length * lineHeight;

  ctx.save();

  // Panel background
  ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
  const r = 2 * zoom;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + panelW - r, y);
  ctx.quadraticCurveTo(x + panelW, y, x + panelW, y + r);
  ctx.lineTo(x + panelW, y + panelH - r);
  ctx.quadraticCurveTo(x + panelW, y + panelH, x + panelW - r, y + panelH);
  ctx.lineTo(x + r, y + panelH);
  ctx.quadraticCurveTo(x, y + panelH, x, y + panelH - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Render each KPI line
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ly = y + padY + i * lineHeight;
    const lx = x + padX;

    // Small colored square icon
    ctx.fillStyle = line.icon;
    ctx.fillRect(lx, ly + 1, iconSize, iconSize);

    // Value (bold number)
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(line.value), lx + iconSize + 3 * zoom, ly);

    // Label (dimmer)
    const numWidth = ctx.measureText(String(line.value)).width;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `${fontSize * 0.85}px monospace`;
    ctx.fillText(line.label, lx + iconSize + 3 * zoom + numWidth + 2 * zoom, ly + 0.5);
    ctx.font = `bold ${fontSize}px monospace`;
  }

  ctx.restore();
}
