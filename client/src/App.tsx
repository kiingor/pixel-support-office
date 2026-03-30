import { useState } from 'react';
import { OfficeCanvas } from './components/OfficeCanvas';
import { ControlPanel } from './components/ControlPanel';
import { CaseDetailModal } from './components/CaseDetailModal';
import { StatusBar } from './components/StatusBar';
import { useOfficeStore } from './stores/officeStore';
import { useWebSocket } from './hooks/useWebSocket';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './components/ui/pixelact-ui/context-menu';

export default function App() {
  useWebSocket();
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const { contextMenu, setContextMenu } = useOfficeStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ContextMenu onOpenChange={(open) => { if (!open) setContextMenu(null); }}>
          <ContextMenuTrigger asChild>
            <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
              <OfficeCanvas />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {contextMenu && (
              <>
                <ContextMenuLabel>{contextMenu.furnitureId}</ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={contextMenu.onDelete}
                  className="text-red-400 focus:text-red-400"
                >
                  Remover objeto
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>

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
      <CaseDetailModal />
    </div>
  );
}
