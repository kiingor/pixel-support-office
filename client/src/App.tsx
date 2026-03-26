import { useState } from 'react';
import { OfficeCanvas } from './components/OfficeCanvas';
import { ControlPanel } from './components/ControlPanel';
import { StatusBar } from './components/StatusBar';
import { useOfficeStore } from './stores/officeStore';
import { useWebSocket } from './hooks/useWebSocket';

function ContextMenu() {
  const { contextMenu, setContextMenu } = useOfficeStore();
  if (!contextMenu) return null;

  return (
    <>
      {/* Backdrop to close menu */}
      <div
        onClick={() => setContextMenu(null)}
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
      />
      <div style={{
        position: 'fixed',
        left: contextMenu.x,
        top: contextMenu.y,
        background: '#1a1a3e',
        border: '1px solid #0f3460',
        borderRadius: 6,
        padding: 4,
        zIndex: 1000,
        minWidth: 140,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}>
        <div style={{ padding: '4px 8px', fontSize: 11, color: '#888', borderBottom: '1px solid #0f3460' }}>
          {contextMenu.furnitureId}
        </div>
        <button
          onClick={contextMenu.onDelete}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 8px',
            background: 'transparent',
            color: '#e94560',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: 12,
            borderRadius: 4,
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = '#0f3460')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Remover objeto
        </button>
      </div>
    </>
  );
}

export default function App() {
  // Connect to backend WebSocket
  useWebSocket();
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          <OfficeCanvas />
        </div>
        {/* Collapse toggle button */}
        <button
          onClick={() => setPanelCollapsed(v => !v)}
          title={panelCollapsed ? 'Expandir painel' : 'Colapsar painel'}
          style={{
            flexShrink: 0,
            width: 20,
            background: '#0f3460',
            border: 'none',
            borderLeft: '1px solid #1a4a8a',
            borderRight: '1px solid #1a4a8a',
            color: '#a0c4ff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            padding: 0,
          }}
        >
          {panelCollapsed ? '◀' : '▶'}
        </button>
        <div style={{
          width: panelCollapsed ? 0 : 320,
          minWidth: 0,
          flexShrink: 0,
          background: '#16213e',
          borderLeft: panelCollapsed ? 'none' : '2px solid #0f3460',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.15s ease',
        }}>
          <ControlPanel />
        </div>
      </div>
      <StatusBar />
      <ContextMenu />
    </div>
  );
}
