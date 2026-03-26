import { useEffect, useRef, useState } from 'react';
import { OfficeState } from '../engine/officeState';
import { startGameLoop } from '../engine/gameLoop';
import { useOfficeStore } from '../stores/officeStore';
import { loadAllAssets } from '../sprites/assetLoader';
import { setLoadedCharacters } from '../sprites/characterSprites';
import { setLoadedFloors, setLoadedWalls } from '../sprites/tileSprites';
import { setLoadedFurniture } from '../sprites/furnitureSprites';
import { clearSpriteCache } from '../engine/spriteCache';

export function useGameEngine(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [officeState] = useState(() => new OfficeState());
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const initRef = useRef(false);

  // Load assets first
  useEffect(() => {
    let cancelled = false;

    loadAllAssets().then(assets => {
      if (cancelled) return;

      // Set loaded assets into sprite modules
      setLoadedCharacters(assets.characters);
      setLoadedFloors(assets.floors);
      setLoadedWalls(assets.walls);
      setLoadedFurniture(assets.furniture);
      clearSpriteCache();

      console.log(`Assets loaded: ${assets.characters.length} characters, ${assets.floors.length} floors, ${assets.walls.length} walls, ${assets.furniture.size} furniture`);

      setAssetsLoaded(true);
    }).catch(err => {
      console.warn('Failed to load assets, using fallbacks:', err);
      setAssetsLoaded(true); // Continue with fallbacks
    });

    return () => { cancelled = true; };
  }, []);

  // Initialize office after assets are loaded
  useEffect(() => {
    if (!assetsLoaded || initRef.current) return;
    initRef.current = true;

    // Rebuild office with loaded assets
    officeState.rebuild();

    const store = useOfficeStore.getState();
    store.setOfficeState(officeState);

    // Spawn initial agents
    officeState.addAgent('ceo');
    officeState.addAgent('suporte');
    officeState.addAgent('qa');
    officeState.addAgent('dev');
    officeState.addAgent('log_analyzer');

    // Center the view
    officeState.panX = 20;
    officeState.panY = 20;

    store.syncAgents();
    store.addLogEntry('Sistema iniciado - Modo Demo');
    store.addLogEntry('Agentes iniciais contratados');

    // Listen for events
    officeState.onEvent((event) => {
      const s = useOfficeStore.getState();
      switch (event.type) {
        case 'agent_hired':
        case 'agent_fired':
        case 'agent_arrived':
          s.syncAgents();
          break;
      }
    });
  }, [assetsLoaded, officeState]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsLoaded) return;

    const cleanup = startGameLoop(canvas, {
      update: (dt) => {
        officeState.update(dt);
        if (Math.random() < dt) {
          useOfficeStore.getState().syncAgents();
        }
      },
      render: (ctx) => {
        officeState.render(ctx, canvas.width, canvas.height);
      },
    });

    return cleanup;
  }, [canvasRef, officeState, assetsLoaded]);

  // Mouse interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      officeState.zoom = Math.max(1, Math.min(6, officeState.zoom + delta));
    };

    let isPanning = false;
    let lastX = 0;
    let lastY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isPanning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        e.preventDefault();
      } else if (e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const agent = officeState.getAgentAt(x, y);
        const store = useOfficeStore.getState();
        if (agent) {
          store.selectAgent(agent.id);
          store.openChat(agent.id);
        } else {
          store.selectAgent(null);
          store.closeChat();
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const furniture = officeState.getFurnitureAt(x, y);
      if (furniture) {
        const store = useOfficeStore.getState();
        store.setContextMenu({
          x: e.clientX,
          y: e.clientY,
          furnitureId: furniture.typeId,
          onDelete: () => {
            officeState.removeFurniture(furniture);
            store.addLogEntry(`Removido: ${furniture.typeId}`);
            store.setContextMenu(null);
          },
        });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isPanning) {
        officeState.panX += e.clientX - lastX;
        officeState.panY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };

    const handleMouseUp = () => { isPanning = false; };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [canvasRef, officeState]);

  return { officeState, assetsLoaded };
}
