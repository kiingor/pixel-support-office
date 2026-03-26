export const SOCKET_EVENTS = {
  // Server -> Client
  AGENT_CREATED: 'agent:created',
  AGENT_FIRED: 'agent:fired',
  AGENT_STATUS: 'agent:status',
  AGENT_POSITION: 'agent:position',
  AGENT_BUBBLE: 'agent:bubble',
  QUEUE_NEW: 'queue:new',
  QUEUE_ASSIGNED: 'queue:assigned',
  QUEUE_COMPLETED: 'queue:completed',
  CASE_OPENED: 'case:opened',
  MESSAGE_SENT: 'message:sent',
  LOG_ENTRY: 'log:entry',

  // Client -> Server
  CEO_HIRE: 'ceo:hire',
  CEO_FIRE: 'ceo:fire',
  AGENT_CLICK: 'agent:click',
} as const;
