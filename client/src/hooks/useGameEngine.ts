import { useEffect, useRef, useState } from 'react';
import { OfficeState } from '../engine/officeState';
import { startGameLoop } from '../engine/gameLoop';
import { useOfficeStore } from '../stores/officeStore';
import { loadAllAssets } from '../sprites/assetLoader';
import { setLoadedCharacters } from '../sprites/characterSprites';
import { setLoadedFloors, setLoadedWalls } from '../sprites/tileSprites';
import { setLoadedFurniture } from '../sprites/furnitureSprites';
import { clearSpriteCache } from '../engine/spriteCache';
import type { AgentRole } from '../types/agents';
import { generateAgentPersonality, parsePersonalityBehavior } from '../types/agentProfile';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (
  window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin
);

function createDefaultAgents(officeState: OfficeState) {
  const defaultRoles: AgentRole[] = ['ceo', 'suporte', 'qa', 'qa_manager', 'dev', 'dev_lead', 'log_analyzer'];
  for (const role of defaultRoles) {
    const personality = generateAgentPersonality();
    const behavior = parsePersonalityBehavior(personality);
    const ch = officeState.addAgent(role, behavior);
    if (ch) {
      // Notify backend to save (if connected via socket)
      const socket = useOfficeStore.getState().socket;
      if (socket) {
        socket.emit('agent:hired', { id: ch.id, name: ch.name, role: ch.role, personality });
      }
    }
  }
}

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

    // Center the view
    officeState.panX = 20;
    officeState.panY = 20;

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

    // Fetch full state from backend - restore agents, tickets, cases, logs from DB
    fetch(`${SERVER_URL}/api/state`)
      .then(res => res.json())
      .then((state: {
        agents: Array<{ id: string; name: string; type: string }>;
        tickets: Array<{ id: string; discord_author?: string; discord_message?: string; status: string; classification?: string; created_at: string }>;
        cases: Array<{ id: string; caso_id: string; bug_id?: string; titulo: string; prompt_ia?: string; status: string }>;
        logs: Array<{ level: string; message: string; created_at: string }>;
        queueSize: number;
      }) => {
        const agents = state.agents || [];
        if (agents.length > 0) {
          // Restore agents from DB (behavior is cosmetic/stateless — regenerate randomly)
          for (const agent of agents) {
            const role = (agent.type || 'suporte') as AgentRole;
            const behavior = parsePersonalityBehavior(generateAgentPersonality());
            const ch = officeState.addAgent(role, behavior);
            if (ch) {
              ch.id = agent.id;
              ch.name = agent.name;
            }
          }
          store.syncAgents();
          store.addLogEntry('Sistema conectado - Modo Produção');
          store.addLogEntry(`${agents.length} agentes carregados do servidor`);
        } else {
          // No agents in DB - create defaults and save them via socket events
          createDefaultAgents(officeState);
          store.syncAgents();
          store.addLogEntry('Sistema conectado - Modo Produção');
          store.addLogEntry('Agentes iniciais contratados e salvos');
        }

        // Populate tickets from DB
        const tickets = state.tickets || [];
        for (const ticket of tickets) {
          store.addTicket({
            id: ticket.id,
            discordAuthor: ticket.discord_author,
            discordMessage: ticket.discord_message,
            status: ticket.status,
            classification: ticket.classification,
            createdAt: new Date(ticket.created_at).getTime(),
          });
        }

        // Populate cases from DB
        const cases = state.cases || [];
        for (const c of cases) {
          store.addCase({
            id: c.id,
            casoId: c.caso_id,
            bugId: c.bug_id,
            titulo: c.titulo,
            promptIa: c.prompt_ia,
            status: c.status,
          });
        }

        // Populate logs from DB (oldest first since they are returned desc)
        const logs = (state.logs || []).reverse();
        for (const log of logs) {
          store.addLogEntry(`[${log.level}] ${log.message}`);
        }

        // Set queue size
        store.setQueueSize(state.queueSize || 0);

        if (tickets.length > 0 || cases.length > 0) {
          store.addLogEntry(`Estado restaurado: ${tickets.length} tickets, ${cases.length} casos`);
        }
      })
      .catch(() => {
        // Backend unreachable - create defaults locally (demo mode)
        createDefaultAgents(officeState);
        store.syncAgents();
        store.addLogEntry('Sistema iniciado - Modo Demo (offline)');
        store.addLogEntry('Agentes iniciais contratados (local)');
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
