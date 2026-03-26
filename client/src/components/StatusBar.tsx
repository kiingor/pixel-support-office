import { useOfficeStore } from '../stores/officeStore';

export function StatusBar() {
  const { agents, tickets } = useOfficeStore();
  const activeAgents = agents.filter(a => a.role !== 'ceo').length;
  const pendingTickets = tickets.filter(t => t.status === 'pending').length;
  const resolvedTickets = tickets.filter(t => t.status === 'done').length;

  return (
    <div style={{
      display: 'flex',
      gap: 24,
      padding: '6px 16px',
      background: '#0f3460',
      borderTop: '2px solid #1a1a5e',
      fontSize: 12,
      color: '#aaa',
    }}>
      <span>Agentes: <b style={{ color: '#4488ff' }}>{activeAgents}</b></span>
      <span>Fila: <b style={{ color: pendingTickets > 3 ? '#e94560' : '#f39c12' }}>{pendingTickets}</b></span>
      <span>Resolvidos: <b style={{ color: '#27ae60' }}>{resolvedTickets}</b></span>
      <span style={{ marginLeft: 'auto', color: '#666' }}>Pixel Support Office v1.0 - Demo Mode</span>
    </div>
  );
}
