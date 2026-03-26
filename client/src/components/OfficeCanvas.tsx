import { useRef, useEffect } from 'react';
import { useGameEngine } from '../hooks/useGameEngine';
import { OFFICE_COLS, OFFICE_ROWS } from '../layout/officeLayout';
import { TILE_SIZE } from '../types/office';

export function OfficeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { officeState } = useGameEngine(canvasRef);

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const fitToRoom = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const worldW = OFFICE_COLS * TILE_SIZE;
    const worldH = OFFICE_ROWS * TILE_SIZE;
    const zoom = Math.min(canvas.width / worldW, canvas.height / worldH);
    officeState.zoom = zoom;
    officeState.panX = (canvas.width - worldW * zoom) / 2;
    officeState.panY = (canvas.height - worldH * zoom) / 2;
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', imageRendering: 'pixelated' }}
      />
      <button
        onClick={fitToRoom}
        title="Mostrar sala toda"
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          background: '#16213e',
          border: '1px solid #0f3460',
          borderRadius: 6,
          color: '#a0c4ff',
          cursor: 'pointer',
          padding: '6px 10px',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          opacity: 0.85,
          transition: 'opacity 0.15s',
        }}
        onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseOut={(e) => (e.currentTarget.style.opacity = '0.85')}
      >
        ⊡ Sala toda
      </button>
    </div>
  );
}
