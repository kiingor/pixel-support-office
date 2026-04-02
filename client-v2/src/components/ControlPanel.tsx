import { useState, useEffect } from 'react';
import { useOfficeStore } from '../stores/officeStore';
import { AgentChat } from './AgentChat';
import { MeetingChat } from './MeetingChat';
import type { AgentRole } from '../types/agents';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (
  window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''
);

const TABS = ['Equipe', 'Fila', 'Casos', 'Chat', 'Logs'] as const;
const TAB_ICONS: Record<string, string> = { Equipe: '\u{1F465}', Fila: '\u{1F4CB}', Casos: '\u{1F41B}', Chat: '\u{1F4AC}', Logs: '\u{1F4C4}' };

const ROLE_LABELS: Record<AgentRole, string> = {
  ceo: 'CEO', suporte: 'Suporte', qa: 'QA', qa_manager: 'Gerente QA',
  dev: 'DEV', dev_lead: 'Tech Lead', log_analyzer: 'Log Analyzer',
};

const ROLE_COLORS: Record<AgentRole, string> = {
  ceo: '#f0c040', suporte: '#4488ff', qa: '#aa44ff', qa_manager: '#cc66ff',
  dev: '#ff8844', dev_lead: '#ff5522', log_analyzer: '#44cc88',
};

export function ControlPanel() {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('Equipe');
  const {
    agents, selectedAgentId, selectAgent, openChat,
    logEntries, tickets, cases, chatAgentId, resolveCase, deleteCase,
    queueSize, meetingActive, openCaseDetail, renameAgent, agentConversations,
    agentWorkStatuses,
  } = useOfficeStore();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [caseFilter, setCaseFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [caseSearch, setCaseSearch] = useState('');
  const [chatLoaded, setChatLoaded] = useState(false);

  // Load agent conversations from DB when Chat tab is first opened
  useEffect(() => {
    if (activeTab === 'Chat' && !chatLoaded && agentConversations.length === 0) {
      setChatLoaded(true);
      fetch(`${SERVER_URL}/api/agent-conversations`)
        .then(r => r.json())
        .then(data => {
          const convs = (data.conversations || []).reverse();
          for (const c of convs) {
            const p = c.payload as any;
            if (p?.fromAgent && p?.toAgent) {
              useOfficeStore.getState().addAgentConversation({
                from: p.fromAgent,
                fromRole: p.fromRole || '',
                to: p.toAgent,
                toRole: p.toRole || '',
                message: p.message || c.message,
              });
            }
          }
        })
        .catch(() => {});
    }
  }, [activeTab, chatLoaded, agentConversations.length]);

  if (meetingActive) return <MeetingChat />;
  if (chatAgentId) return <AgentChat />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#16213e' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', background: '#0f3460', borderBottom: '2px solid #1a4a8a' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#e94560', letterSpacing: 1 }}>
          PIXEL SUPPORT OFFICE
        </div>
        <div style={{ fontSize: 10, color: '#5a7a9a', marginTop: 2 }}>
          {agents.length} agentes ativos
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#0d1b3e', borderBottom: '1px solid #1a3a5c' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 11,
              fontWeight: activeTab === tab ? 700 : 400,
              color: activeTab === tab ? '#e94560' : '#5a7a9a',
              background: activeTab === tab ? '#16213e' : 'transparent',
              borderBottom: activeTab === tab ? '2px solid #e94560' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ marginRight: 4 }}>{TAB_ICONS[tab]}</span>
            {tab}
            {tab === 'Fila' && queueSize > 0 && (
              <span style={{ marginLeft: 4, background: '#e74c3c', color: 'white', borderRadius: 8, padding: '0 5px', fontSize: 9 }}>
                {queueSize}
              </span>
            )}
            {tab === 'Casos' && cases.filter(c => c.status !== 'resolved').length > 0 && (
              <span style={{ marginLeft: 4, background: '#e94560', color: 'white', borderRadius: 8, padding: '0 5px', fontSize: 9 }}>
                {cases.filter(c => c.status !== 'resolved').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px' }}>

        {/* === EQUIPE === */}
        {activeTab === 'Equipe' && (
          <div>
            <div className="text-muted" style={{ marginBottom: 8 }}>Clique num agente para conversar</div>
            {agents.map(agent => (
              <div
                key={agent.id}
                className={`panel-card ${selectedAgentId === agent.id ? 'active' : ''}`}
                onClick={() => { if (renamingId !== agent.id) { selectAgent(agent.id); openChat(agent.id); } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="status-dot" style={{ background: ROLE_COLORS[agent.role], boxShadow: `0 0 6px ${ROLE_COLORS[agent.role]}66` }} />
                  <div style={{ flex: 1 }}>
                    {renamingId === agent.id ? (
                      <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                        <input
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && renameValue.trim()) {
                              renameAgent(agent.id, renameValue.trim());
                              setRenamingId(null);
                            }
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          autoFocus
                          style={{ background: '#0a1428', border: '1px solid #4488ff', borderRadius: 3, color: '#fff', padding: '2px 6px', fontSize: 12, width: '100%' }}
                        />
                        <button className="btn btn-sm btn-primary" onClick={() => { if (renameValue.trim()) { renameAgent(agent.id, renameValue.trim()); setRenamingId(null); } }}>OK</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{agent.name}</span>
                        <span
                          onClick={e => { e.stopPropagation(); setRenamingId(agent.id); setRenameValue(agent.name); }}
                          style={{ fontSize: 10, color: '#445', cursor: 'pointer', padding: '0 3px' }}
                          title="Renomear"
                        >&#9998;</span>
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#5a7a9a' }}>
                      {ROLE_LABELS[agent.role]} - {agentWorkStatuses.get(agent.name)
                        ? <span style={{ color: '#2ecc71', fontWeight: 600 }}>{agentWorkStatuses.get(agent.name)}</span>
                        : <span style={{ color: '#666' }}>Ocioso</span>
                      }
                    </div>
                  </div>
                  {renamingId !== agent.id && <span style={{ fontSize: 12, color: '#334' }}>{'>'}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* === FILA === */}
        {activeTab === 'Fila' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Fila de Atendimento</span>
              {queueSize > 0 && <span className="badge badge-open">{queueSize} aguardando</span>}
            </div>
            {tickets.length === 0 && <div className="text-muted">Nenhum ticket na fila</div>}
            {tickets.map(t => {
              const statusClass = t.status === 'done' ? 'badge-done' : t.status === 'processing' ? 'badge-processing' : 'badge-pending';
              return (
                <div key={t.id} className="panel-card" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{t.discordAuthor || 'Demo User'}</span>
                    <span className={`badge ${statusClass}`}>{t.status}</span>
                  </div>
                  <div style={{ color: '#6a8aaa', marginTop: 3, fontSize: 11 }}>
                    {t.discordMessage?.slice(0, 80) || 'Ticket simulado'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* === CASOS === */}
        {activeTab === 'Casos' && (
          <div>
            {/* Filters */}
            <div style={{ marginBottom: 8 }}>
              <input
                type="text"
                placeholder="Buscar caso, bug ou titulo..."
                value={caseSearch}
                onChange={e => setCaseSearch(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', background: '#0a1428', border: '1px solid #1a3a5c', borderRadius: 4, color: '#fff', fontSize: 11, marginBottom: 6 }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                {(['all', 'open', 'resolved'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setCaseFilter(f)}
                    className={`btn btn-sm ${caseFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1, fontSize: 10 }}
                  >
                    {f === 'all' ? `Todos (${cases.length})` : f === 'open' ? `Abertos (${cases.filter(c => c.status !== 'resolved').length})` : `Resolvidos (${cases.filter(c => c.status === 'resolved').length})`}
                  </button>
                ))}
              </div>
            </div>
            {cases.length === 0 && <div className="text-muted">Nenhum caso aberto</div>}
            {[...cases]
            .filter(c => {
              if (caseFilter === 'open' && c.status === 'resolved') return false;
              if (caseFilter === 'resolved' && c.status !== 'resolved') return false;
              if (caseSearch) {
                const q = caseSearch.toLowerCase();
                return c.casoId.toLowerCase().includes(q) || (c.bugId || '').toLowerCase().includes(q) || c.titulo.toLowerCase().includes(q) || (c.createdBy || '').toLowerCase().includes(q);
              }
              return true;
            })
            .sort((a, b) => {
              const numA = parseInt(a.casoId.replace(/\D/g, '')) || 0;
              const numB = parseInt(b.casoId.replace(/\D/g, '')) || 0;
              return numB - numA;
            }).map(c => {
              const isOpen = c.status !== 'resolved';
              return (
                <div
                  key={c.id}
                  className="panel-card"
                  style={{ borderLeft: `3px solid ${isOpen ? '#e74c3c' : '#2ecc71'}` }}
                  onClick={() => openCaseDetail(c.casoId)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: isOpen ? '#e94560' : '#2ecc71' }}>
                        {c.casoId}
                      </span>
                      {c.bugId && <span className="badge badge-bug">{c.bugId}</span>}
                    </div>
                    <span className={`badge ${isOpen ? 'badge-open' : 'badge-resolved'}`}>
                      {isOpen ? 'Aberto' : 'Resolvido'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#8aa', marginBottom: 4 }}>{c.titulo}</div>
                  {c.createdBy && (
                    <div style={{ fontSize: 10, color: '#5a7a9a', marginBottom: 4 }}>
                      Criado por: <span style={{ color: '#ff8844', fontWeight: 600 }}>{c.createdBy}</span>
                      {c.sourceSector && <span> ({c.sourceSector})</span>}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    {isOpen && (
                      <button className="btn btn-sm btn-success" onClick={() => resolveCase(c.casoId)}>
                        Resolver
                      </button>
                    )}
                    <button
                      className={`btn btn-sm ${confirmDeleteId === c.casoId ? 'btn-danger-confirm' : 'btn-danger'}`}
                      onClick={() => {
                        if (confirmDeleteId === c.casoId) {
                          deleteCase(c.casoId);
                          setConfirmDeleteId(null);
                        } else {
                          setConfirmDeleteId(c.casoId);
                          setTimeout(() => setConfirmDeleteId(null), 3000);
                        }
                      }}
                    >
                      {confirmDeleteId === c.casoId ? 'Confirmar?' : 'Deletar'}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => openCaseDetail(c.casoId)}>
                      Detalhes
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* === CHAT (Agent Conversations) === */}
        {activeTab === 'Chat' && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Conversas entre Agentes</div>
            {agentConversations.length === 0 && (
              <div className="text-muted">Nenhuma conversa registrada ainda</div>
            )}
            {[...agentConversations].reverse().map((conv, i) => (
              <div key={i} className="panel-card" style={{ cursor: 'default', borderLeft: '3px solid #f39c12' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 11 }}>
                    <span style={{ fontWeight: 700, color: '#4488ff' }}>{conv.from}</span>
                    <span style={{ color: '#555' }}> ({conv.fromRole})</span>
                    <span style={{ color: '#888' }}> → </span>
                    <span style={{ fontWeight: 700, color: '#2ecc71' }}>{conv.to}</span>
                    <span style={{ color: '#555' }}> ({conv.toRole})</span>
                  </span>
                  <span style={{ fontSize: 9, color: '#555' }}>{conv.time}</span>
                </div>
                <div style={{ fontSize: 11, color: '#aaa' }}>{conv.message}</div>
              </div>
            ))}
          </div>
        )}

        {/* === LOGS === */}
        {activeTab === 'Logs' && (
          <div>
            {logEntries.length === 0 && <div className="text-muted">Aguardando eventos...</div>}
            {logEntries.slice(-50).reverse().map((entry, i) => {
              const isError = entry.message.toLowerCase().includes('error') || entry.message.toLowerCase().includes('erro');
              const isWarn = entry.message.toLowerCase().includes('warn') || entry.message.toLowerCase().includes('fila');
              const logClass = isError ? 'log-error' : isWarn ? 'log-warn' : 'log-info';
              return (
                <div key={i} className="log-entry">
                  <span className="log-time">{entry.time}</span>
                  <span className={logClass}>{entry.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
