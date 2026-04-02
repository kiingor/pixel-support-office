import { useEffect, useState } from 'react';

import type { OfficeState } from '../engine/officeState.js';
import { TILE_SIZE } from '../types.js';

interface SectorLabelsProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** Sector label definitions: text + tile position (col, row) */
const SECTOR_LABELS: Array<{ text: string; col: number; row: number }> = [
  { text: 'Suporte', col: 11, row: 1 },
  { text: 'QA', col: 5, row: 12 },
  { text: 'DEV', col: 15, row: 12 },
  { text: 'Logs', col: 26, row: 12 },
  { text: 'CEO', col: 36, row: 12 },
  { text: 'Sala de Reuni\u00e3o', col: 31, row: 1 },
];

/**
 * Renders sector name labels as an HTML overlay on top of the canvas.
 * Positioned using the same coordinate system as ToolOverlay.
 */
export function SectorLabels({
  officeState,
  containerRef,
  zoom,
  panRef,
}: SectorLabelsProps) {
  // Re-render on each animation frame so labels track pan/zoom
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  return (
    <>
      {SECTOR_LABELS.map(({ text, col, row }) => {
        // Center of the tile in screen (CSS) pixels
        const screenX = (deviceOffsetX + (col + 0.5) * TILE_SIZE * zoom) / dpr;
        const screenY = (deviceOffsetY + (row + 0.5) * TILE_SIZE * zoom) / dpr;

        return (
          <div
            key={text}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              zIndex: 30,
              fontSize: '18px',
              fontWeight: 'bold',
              color: 'rgba(255, 255, 255, 0.55)',
              textShadow: '1px 1px 3px rgba(0, 0, 0, 0.7)',
              whiteSpace: 'nowrap',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              userSelect: 'none',
            }}
          >
            {text}
          </div>
        );
      })}
    </>
  );
}
