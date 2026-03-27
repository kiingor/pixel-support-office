import { useState } from 'react';
import { useOfficeStore } from '../stores/officeStore';
import { AgentChat } from './AgentChat';
import { MeetingChat } from './MeetingChat';
import type { AgentRole } from '../types/agents';

const TABS = ['Equipe', 'Fila', 'Casos', 'Logs'] as const;

const ROLE_LABELS: Record<AgentRole, string> = {
  ceo: 'CEO',
  suporte: 'Suporte',
  qa: 'QA',
  qa_manager: 'Gerente QA',
  dev: 'DEV',
  dev_lead: 'Tech Lead',
  log_analyzer: 'Log Analyzer',
};

const ROLE_COLORS: Record<AgentRole, string> = {
  ceo: '#f0c040',
  suporte: '#4488ff',
  qa: '#aa44ff',
  qa_manager: '#cc66ff',
  dev: '#ff8844',
  dev_lead: '#ff5522',
  log_analyzer: '#44cc88',
};

export function ControlPanel() {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('Equipe');
  const {
    agents, selectedAgentId, selectAgent, openChat,
    logEntries, tickets, cases, chatAgentId, resolveCase,
    queueSize, meetingActive,
  } = useOfficeStore();

  // Meeting takes priority
  if (meetingActive) {
    return <MeetingChat />;
  }

  // If chat is open, show the chat panel instead
  if (chatAgentId) {
    return <AgentChat />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: '#0f3460', borderBottom: '1px solid #1a1a5e' }}>
        <h2 style={{ fontSize: 16, margin: 0, color: '#e94560' }}>Pixel Support Office</h2>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #0f3460' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 4px',
              background: activeTab === tab ? '#1a1a5e' : 'transparent',
              color: activeTab === tab ? '#e94560' : '#888',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #e94560' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: activeTab === tab ? 'bold' : 'normal',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {activeTab === 'Equipe' && (
          <div>
            <div style={{ fontSize: 10, color: '#666', marginBottom: 8 }}>
              Clique num agente para conversar
            </div>
            {agents.map(agent => (
              <div
                key={agent.id}
                onClick={() => { selectAgent(agent.id); openChat(agent.id); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px',
                  marginBottom: 4,
                  background: selectedAgentId === agent.id ? '#1a1a5e' : '#0d1b3e',
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: selectedAgentId === agent.id ? '1px solid #e94560' : '1px solid transparent',
                }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: ROLE_COLORS[agent.role],
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold' }}>{agent.name}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {ROLE_LABELS[agent.role]} - {agent.status}
                  </div>
                </div>
                <span style={{ fontSize: 14, color: '#555' }}>{'>'}</span>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'Fila' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 'bold' }}>Fila de Atendimento</span>
              {queueSize > 0 && (
                <span style={{ background: '#e74c3c', color: 'white', borderRadius: 10, padding: '2px 8px', fontSize: 11 }}>
                  {queueSize} aguardando
                </span>
              )}
            </div>
            {tickets.length === 0 && <div style={{ color: '#666', fontSize: 13 }}>Nenhum ticket na fila</div>}
            {tickets.map(t => (
              <div key={t.id} style={{ padding: '6px 8px', marginBottom: 4, background: '#0d1b3e', borderRadius: 4, fontSize: 12 }}>
                <div style={{ fontWeight: 'bold' }}>{t.discordAuthor || 'Demo User'}</div>
                <div style={{ color: '#888', marginTop: 2 }}>{t.discordMessage?.slice(0, 80) || 'Ticket simulado'}</div>
                <div style={{ color: t.status === 'done' ? '#27ae60' : t.status === 'processing' ? '#f39c12' : '#888', fontSize: 11, marginTop: 2 }}>{t.status}</div>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'Casos' && (
          <div>
            {cases.length === 0 && <div style={{ color: '#666', fontSize: 13 }}>Nenhum caso aberto</div>}
            {cases.map(c => (
              <div key={c.id} style={{ padding: '8px', marginBottom: 6, background: '#0d1b3e', borderRadius: 4, fontSize: 12, border: c.status === 'resolved' ? '1px solid #27ae60' : '1px solid transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 'bold', color: c.status === 'resolved' ? '#27ae60' : '#e94560' }}>
                    {c.casoId} {c.bugId ? `(${c.bugId})` : ''}
                  </span>
                  <span style={{ fontSize: 10, color: c.status === 'resolved' ? '#27ae60' : '#f39c12' }}>
                    {c.status === 'resolved' ? 'Resolvido' : 'Aberto'}
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>{c.titulo}</div>
                {c.promptIa && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>Ver prompt de correcao</summary>
                    <pre style={{ fontSize: 10, color: '#aaa', background: '#0a1428', padding: 6, borderRadius: 3, marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{c.promptIa}</pre>
                    <button onClick={() => { navigator.clipboard.writeText(c.promptIa || ''); }}
                      style={{ marginTop: 4, background: '#1a5276', color: '#ddd', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>
                      Copiar Prompt
                    </button>
                  </details>
                )}
                {c.status !== 'resolved' && (
                  <button onClick={() => resolveCase(c.casoId)}
                    style={{ marginTop: 6, background: '#27ae60', color: 'white', border: 'none', borderRadius: 3, padding: '4px 10px', fontSize: 11, cursor: 'pointer', width: '100%' }}>
                    Marcar como Resolvido
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {activeTab === 'Logs' && (
          <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
            {logEntries.length === 0 && <div style={{ color: '#666' }}>Aguardando eventos...</div>}
            {logEntries.slice(-50).reverse().map((entry, i) => (
              <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #0a1428', color: '#aaa' }}>
                <span style={{ color: '#666' }}>{entry.time}</span> {entry.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
