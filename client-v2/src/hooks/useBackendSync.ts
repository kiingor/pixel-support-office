import { useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { OfficeState } from '../office/engine/officeState.js';
import type { Character, Seat } from '../office/types.js';
import type { AgentRole } from './useWebSocket.js';

// ── Server URL (same as useWebSocket) ────────────────────────────────
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

// ── Role-to-palette mapping ──────────────────────────────────────────
// pixel-agents has 6 palettes (0-5). We assign a deterministic palette
// per backend role so agents of the same role share visual identity.
const ROLE_PALETTE: Record<AgentRole, number> = {
  ceo: 0,
  suporte: 1,
  qa: 2,
  qa_manager: 3,
  dev: 4,
  dev_lead: 5,
  log_analyzer: 3,
};

// ── Backend agent data ───────────────────────────────────────────────
export interface BackendAgent {
  id: string;
  name: string;
  type: string; // role string from backend (suporte, qa, dev, etc.)
}

// ── Augmented character with backend metadata ────────────────────────
// We attach extra fields to pixel-agents Character instances so we can
// look them up by backend name/role without a separate map.
export interface BackendCharacter extends Character {
  backendId: string;
  backendName: string;
  backendRole: AgentRole;
  roleLabel: string;
}

// ── Role display labels ─────────────────────────────────────────────
const ROLE_LABELS: Record<AgentRole, string> = {
  ceo: 'CEO',
  suporte: 'Suporte',
  qa: 'QA',
  qa_manager: 'Gerente QA',
  dev: 'DEV',
  dev_lead: 'Tech Lead',
  log_analyzer: 'Log Analyzer',
};

// ── Role-to-seat-prefix mapping ─────────────────────────────────────
// Chair UIDs in the layout JSON use sector prefixes (e.g. "sup_chair_1").
// We map each role to the prefix of its sector's chairs so agents get
// assigned to seats in the correct room.
const ROLE_SEAT_PREFIX: Record<AgentRole, string> = {
  ceo: 'ceo_chair_',
  suporte: 'sup_chair_',
  qa: 'qa_chair_',
  qa_manager: 'qa_chair_',
  dev: 'dev_chair_',
  dev_lead: 'dev_chair_',
  log_analyzer: 'log_chair_',
};

/** Find a free seat in the given sector (by UID prefix), or null. */
function findFreeSeatInSector(
  seats: Map<string, Seat>,
  prefix: string,
): string | null {
  for (const [uid, seat] of seats) {
    if (!seat.assigned && uid.startsWith(prefix)) {
      return uid;
    }
  }
  return null;
}

// Track numeric IDs we assign to backend agents (pixel-agents uses numbers)
let nextAgentNumericId = 1;
const backendIdToNumericId = new Map<string, number>();

function getNumericId(backendId: string): number {
  let num = backendIdToNumericId.get(backendId);
  if (num === undefined) {
    num = nextAgentNumericId++;
    backendIdToNumericId.set(backendId, num);
  }
  return num;
}

/**
 * Bridges backend agent data into the pixel-agents character system.
 *
 * On `agents:sync` from the server (and on initial HTTP fetch), this hook
 * creates / updates / removes characters in the OfficeState so that the
 * pixel-art canvas reflects the real team composition.
 */
export function useBackendSync(
  getOfficeState: () => OfficeState | null,
  socketRef: React.RefObject<Socket | null>,
) {
  const syncedRef = useRef(false);

  // ── Sync a list of backend agents into pixel-agents ──────────
  const syncAgents = useCallback(
    (agents: BackendAgent[]) => {
      const os = getOfficeState();
      if (!os) {
        console.warn('[BackendSync] No officeState yet, deferring sync');
        return;
      }

      const incomingIds = new Set<number>();

      for (const agent of agents) {
        const numId = getNumericId(agent.id);
        incomingIds.add(numId);
        const role = (agent.type || 'suporte') as AgentRole;
        const palette = ROLE_PALETTE[role] ?? 1;

        // Build display label: add star for leaders
        const LEADER_ROLES = new Set<AgentRole>(['qa_manager', 'dev_lead', 'ceo']);
        const displayName = LEADER_ROLES.has(role)
          ? `\u2605 ${agent.name}`
          : agent.name;

        if (os.characters.has(numId)) {
          // Already exists -- update metadata only
          const ch = os.characters.get(numId)! as BackendCharacter;
          ch.backendName = agent.name;
          ch.backendRole = role;
          ch.folderName = displayName;
          ch.roleLabel = ROLE_LABELS[role] || role;
        } else {
          // Find a seat in the agent's sector
          const seatPrefix = ROLE_SEAT_PREFIX[role] || '';
          const preferredSeat = seatPrefix
            ? findFreeSeatInSector(os.seats, seatPrefix)
            : undefined;

          // Create new character with preferred seat in their sector
          os.addAgent(numId, palette, undefined, preferredSeat ?? undefined, undefined, displayName);

          // Augment with backend metadata
          const ch = os.characters.get(numId) as BackendCharacter | undefined;
          if (ch) {
            ch.backendId = agent.id;
            ch.backendName = agent.name;
            ch.backendRole = role;
            ch.roleLabel = ROLE_LABELS[role] || role;
          }
        }
      }

      // Remove characters that no longer exist on the backend
      for (const [id, ch] of os.characters) {
        if (id < 0) continue; // skip sub-agents
        if ((ch as any).backendId && !incomingIds.has(id)) {
          os.removeAgent(id);
        }
      }

      console.log(`[BackendSync] Synced ${agents.length} agents`);
    },
    [getOfficeState],
  );

  // ── Initial fetch on mount ─────────────────────────────────────
  useEffect(() => {
    if (syncedRef.current) return;

    const fetchAgents = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/agents`);
        if (!res.ok) {
          console.warn('[BackendSync] Failed to fetch agents:', res.status);
          return;
        }
        const data = await res.json();
        const agents: BackendAgent[] = Array.isArray(data)
          ? data
          : Array.isArray(data.agents)
            ? data.agents
            : [];

        if (agents.length > 0) {
          syncAgents(agents);
          syncedRef.current = true;
        }
      } catch (err) {
        console.warn('[BackendSync] Error fetching agents:', err);
      }
    };

    // Wait a tick for OfficeState to initialize
    const timer = setTimeout(fetchAgents, 500);
    return () => clearTimeout(timer);
  }, [syncAgents]);

  // ── Listen for agents:sync events via socket ───────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleSync = (data: { agents: BackendAgent[] }) => {
      syncAgents(data.agents);
      syncedRef.current = true;
    };

    socket.on('agents:sync', handleSync);
    return () => {
      socket.off('agents:sync', handleSync);
    };
  }, [socketRef, syncAgents]);

  // ── Handle CEO hire/fire by adding/removing characters ─────────
  const hireAgent = useCallback(
    (role: AgentRole) => {
      const os = getOfficeState();
      if (!os) return;

      // Generate a temporary ID -- the next agents:sync will reconcile
      const tempId = `temp_${Date.now()}`;
      const numId = getNumericId(tempId);
      const palette = ROLE_PALETTE[role] ?? 1;

      const LEADER_ROLES = new Set<AgentRole>(['qa_manager', 'dev_lead', 'ceo']);
      const displayName = LEADER_ROLES.has(role)
        ? `\u2605 ${role}`
        : role;

      // Find a seat in the agent's sector
      const seatPrefix = ROLE_SEAT_PREFIX[role] || '';
      const preferredSeat = seatPrefix
        ? findFreeSeatInSector(os.seats, seatPrefix)
        : undefined;

      os.addAgent(numId, palette, undefined, preferredSeat ?? undefined, undefined, displayName);
      const ch = os.characters.get(numId) as BackendCharacter | undefined;
      if (ch) {
        ch.backendId = tempId;
        ch.backendName = role;
        ch.backendRole = role;
      }
    },
    [getOfficeState],
  );

  const fireAgent = useCallback(
    (agentName: string) => {
      const os = getOfficeState();
      if (!os) return;

      for (const [id, ch] of os.characters) {
        if ((ch as any).backendName === agentName) {
          os.removeAgent(id);
          break;
        }
      }
    },
    [getOfficeState],
  );

  return { syncAgents, hireAgent, fireAgent };
}
