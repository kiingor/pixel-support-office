import type { OfficeState } from './officeState.js';
import type { Character } from '../types.js';
import { CharacterState } from '../types.js';

/**
 * AutonomousAgentBehavior - Manages client-side autonomous behavior for agents
 * with realistic work patterns including task delivery, breaks, and social behaviors.
 *
 * Behavior Flow:
 * 1. TYPE (working at seat) → workTimer expires
 * 2. DELIVER (walk to target agent to deliver work) → interaction complete
 * 3. WAITING_TASK (standing available) or BREAK (coffee/social/rest)
 * 4. Return to TYPE when new task assigned or break ends
 */

// Timers for autonomous behavior (in seconds)
const MIN_WORK_CYCLE_SEC = 45;
const MAX_WORK_CYCLE_SEC = 150;
const MIN_BREAK_CYCLE_SEC = 20;
const MAX_BREAK_CYCLE_SEC = 60;

interface AutonomousAgentState {
  lastStateChange: number;
  currentCycle: 'work' | 'deliver' | 'waiting' | 'break';
  nextCycleTime: number;
  wanderTarget: { col: number; row: number } | null;
  socialGroup: number[] | null;
  hasPendingDelivery: boolean;
}

// Global state tracking
const agentStates: Map<number, AutonomousAgentState> = new Map();

/**
 * Update autonomous behavior for all agents
 */
export function updateAutonomousBehavior(officeState: OfficeState, dt: number): void {
  const characters = officeState.getCharacters();
  
  // Initialize state for new agents
  for (const ch of characters) {
    if (!ch.isSubagent && !agentStates.has(ch.id)) {
      initializeAgentState(ch);
    }
  }

  // Update each agent's autonomous behavior
  for (const ch of characters) {
    if (ch.isSubagent) continue;
    updateAgentAutonomy(ch, officeState, dt);
  }

  // Clean up states for removed agents
  for (const [id] of agentStates) {
    if (!officeState.characters.has(id)) {
      agentStates.delete(id);
    }
  }
}

/**
 * Initialize autonomous state for a new agent
 */
function initializeAgentState(ch: Character): void {
  agentStates.set(ch.id, {
    lastStateChange: 0,
    currentCycle: 'work',
    nextCycleTime: MIN_WORK_CYCLE_SEC + Math.random() * (MAX_WORK_CYCLE_SEC - MIN_WORK_CYCLE_SEC),
    wanderTarget: null,
    socialGroup: null,
    hasPendingDelivery: false,
  });
}

/**
 * Update autonomy state for a single character
 */
function updateAgentAutonomy(ch: Character, officeState: OfficeState, dt: number): void {
  const state = agentStates.get(ch.id);
  if (!state) return;

  state.lastStateChange += dt;
  state.nextCycleTime -= dt;

  // Handle different cycles based on current state
  switch (state.currentCycle) {
    case 'work':
      updateWorkCycle(ch, officeState, state, dt);
      break;
    case 'deliver':
      updateDeliveryCycle(ch, officeState, state, dt);
      break;
    case 'waiting':
      updateWaitingCycle(ch, officeState, state, dt);
      break;
    case 'break':
      updateBreakCycle(ch, officeState, state, dt);
      break;
  }
}

/**
 * Update agent during work cycle
 */
function updateWorkCycle(ch: Character, officeState: OfficeState, state: AutonomousAgentState, _dt: number): void {
  // If agent is in TYPE state and workTimer expires, transition to delivery
  if (ch.state === CharacterState.TYPE && ch.workTimer <= 0) {
    // Work complete - decide whether to deliver or take break
    if (Math.random() < 0.7) {
      // 70% chance to deliver work to another agent
      state.currentCycle = 'deliver';
      state.nextCycleTime = 0; // Trigger immediately
      
      // Find a target agent to deliver to (prefer different role)
      const targets = findDeliveryTargets(officeState, ch);
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        ch.deliveryTarget = target.id;
        ch.state = CharacterState.IDLE; // Will pathfind in IDLE state
      } else {
        // No targets available - go to waiting
        state.currentCycle = 'waiting';
        officeState.setAgentWaiting(ch.id);
      }
    } else {
      // 30% chance to take a break instead
      state.currentCycle = 'break';
      state.nextCycleTime = MIN_BREAK_CYCLE_SEC + Math.random() * (MAX_BREAK_CYCLE_SEC - MIN_BREAK_CYCLE_SEC);
      officeState.setAgentOnBreak(ch.id, Math.random() < 0.5 ? 'coffee' : 'rest');
    }
  }
}

/**
 * Update agent during delivery cycle
 */
function updateDeliveryCycle(ch: Character, officeState: OfficeState, state: AutonomousAgentState, _dt: number): void {
  // If delivery complete (state changed from DELIVER)
  if (ch.state !== CharacterState.DELIVER && ch.state !== CharacterState.WALK) {
    // Delivery finished - transition to waiting or break
    if (Math.random() < 0.4) {
      // 40% chance to take a break after delivery
      state.currentCycle = 'break';
      state.nextCycleTime = MIN_BREAK_CYCLE_SEC + Math.random() * (MAX_BREAK_CYCLE_SEC - MIN_BREAK_CYCLE_SEC);
      officeState.setAgentOnBreak(ch.id, Math.random() < 0.6 ? 'social' : 'coffee');
    } else {
      // 60% chance to wait for next task
      state.currentCycle = 'waiting';
      state.nextCycleTime = 60 + Math.random() * 120; // Wait 1-3 minutes
      officeState.setAgentWaiting(ch.id);
    }
  }
}

/**
 * Update agent during waiting cycle
 */
function updateWaitingCycle(ch: Character, officeState: OfficeState, state: AutonomousAgentState, _dt: number): void {
  // If waiting too long, take a break
  if (ch.state === CharacterState.WAITING_TASK && ch.waitingTimer > 30) {
    if (Math.random() < 0.3) {
      // 30% chance to take break when waiting too long
      state.currentCycle = 'break';
      state.nextCycleTime = MIN_BREAK_CYCLE_SEC + Math.random() * (MAX_BREAK_CYCLE_SEC - MIN_BREAK_CYCLE_SEC);
      officeState.setAgentOnBreak(ch.id, 'rest');
    }
  }

  // If cycle time expires, go to work (simulate getting new task)
  if (state.nextCycleTime <= 0) {
    state.currentCycle = 'work';
    state.nextCycleTime = MIN_WORK_CYCLE_SEC + Math.random() * (MAX_WORK_CYCLE_SEC - MIN_WORK_CYCLE_SEC);
    
    // Return to seat and start working
    if (ch.seatId) {
      officeState.sendToSeat(ch.id);
      officeState.setAgentActive(ch.id, true);
    }
  }
}

/**
 * Update agent during break cycle
 */
function updateBreakCycle(ch: Character, officeState: OfficeState, state: AutonomousAgentState, _dt: number): void {
  // If break timer expires, return to work
  if (ch.state === CharacterState.BREAK && ch.breakTimer <= 0) {
    state.currentCycle = 'work';
    state.nextCycleTime = MIN_WORK_CYCLE_SEC + Math.random() * (MAX_WORK_CYCLE_SEC - MIN_WORK_CYCLE_SEC);
    
    // Return to seat and start working
    if (ch.seatId) {
      officeState.sendToSeat(ch.id);
      officeState.setAgentActive(ch.id, true);
    }
  }

  // Social breaks: try to gather with other agents
  if (ch.breakType === 'social' && ch.state === CharacterState.BREAK) {
    updateSocialGathering(ch, officeState, state);
  }
}

/**
 * Find agents that could receive work deliveries
 */
function findDeliveryTargets(officeState: OfficeState, currentAgent: Character): Character[] {
  const targets: Character[] = [];
  
  for (const ch of officeState.characters.values()) {
    // Skip self and sub-agents
    if (ch.id === currentAgent.id || ch.isSubagent) continue;
    
    // Target should be in WAITING_TASK or BREAK state
    if (ch.state === CharacterState.WAITING_TASK || 
        ch.state === CharacterState.BREAK ||
        ch.state === CharacterState.IDLE) {
      targets.push(ch);
    }
  }
  
  return targets;
}

/**
 * Update social gathering behavior during breaks
 */
function updateSocialGathering(ch: Character, officeState: OfficeState, _state: AutonomousAgentState): void {
  // Find other agents on social break
  const socialAgents = Array.from(officeState.characters.values())
    .filter(other => 
      other.id !== ch.id && 
      !other.isSubagent && 
      other.breakType === 'social' &&
      other.state === CharacterState.BREAK
    );

  // If found social agents, try to move near them
  if (socialAgents.length > 0 && ch.state === CharacterState.IDLE) {
    const randomAgent = socialAgents[Math.floor(Math.random() * socialAgents.length)];
    const nearbyTile = officeState.walkableTiles.find(t =>
      Math.abs(t.col - randomAgent.tileCol) <= 2 && 
      Math.abs(t.row - randomAgent.tileRow) <= 2
    );

    if (nearbyTile) {
      officeState.walkToTile(ch.id, nearbyTile.col, nearbyTile.row);
    }
  }
}

/**
 * Reset autonomous state
 */
export function resetAutonomousBehavior(): void {
  agentStates.clear();
}

/**
 * Get autonomous behavior statistics (for debugging)
 */
export function getAutonomousStats(): { 
  trackedAgents: number; 
  cycles: { work: number; deliver: number; waiting: number; break: number };
  states: { TYPE: number; WALK: number; IDLE: number; DELIVER: number; WAITING_TASK: number; BREAK: number };
} {
  let work = 0, deliver = 0, waiting = 0, breakCount = 0;
  let TYPE = 0, WALK = 0, IDLE = 0, DELIVER = 0, WAITING_TASK = 0, BREAK = 0;
  
  for (const state of agentStates.values()) {
    if (state.currentCycle === 'work') work++;
    else if (state.currentCycle === 'deliver') deliver++;
    else if (state.currentCycle === 'waiting') waiting++;
    else if (state.currentCycle === 'break') breakCount++;
  }
  
  // Count actual character states
  // Note: This would need access to characters, returning partial stats
  return {
    trackedAgents: agentStates.size,
    cycles: { work, deliver, waiting, break: breakCount },
    states: { TYPE, WALK, IDLE, DELIVER, WAITING_TASK, BREAK },
  };
}
