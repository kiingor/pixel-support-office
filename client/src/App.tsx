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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          <OfficeCanvas />
        </div>
        <div style={{
          width: 320, flexShrink: 0,
          background: '#16213e',
          borderLeft: '2px solid #0f3460',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <ControlPanel />
        </div>
      </div>
      <StatusBar />
      <ContextMenu />
    </div>
  );
}
