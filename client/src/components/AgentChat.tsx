import { useState, useRef, useEffect } from 'react';
import { useOfficeStore } from '../stores/officeStore';

const ROLE_COLORS: Record<string, string> = {
  ceo: '#f0c040', suporte: '#4488ff', qa: '#aa44ff', dev: '#ff8844', log_analyzer: '#44cc88',
};
const ROLE_LABELS: Record<string, string> = {
  ceo: 'CEO', suporte: 'Suporte', qa: 'QA', dev: 'DEV', log_analyzer: 'Log Analyzer',
};

export function AgentChat() {
  const {
    chatAgentId, agents, chatHistories, closeChat,
    sendChatMessage, agentProfiles, updateAgentPrompt,
    fireAgent, renameAgent, chatLoading,
  } = useOfficeStore();
  const [input, setInput] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agent = agents.find(a => a.id === chatAgentId);
  const profile = chatAgentId ? agentProfiles.get(chatAgentId) : undefined;
  const history = chatAgentId ? chatHistories.get(chatAgentId) || [] : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history.length]);

  if (!agent || !chatAgentId) return null;

  const roleColor = ROLE_COLORS[agent.role] || '#888';

  const handleSend = () => {
    const text = input.trim();
    if (!text || chatLoading) return;
    sendChatMessage(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleRename = () => {
    if (nameInput.trim() && nameInput.trim() !== agent.name) {
      renameAgent(chatAgentId!, nameInput.trim());
    }
    setEditingName(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', background: '#0f3460', borderBottom: '1px solid #1a1a5e', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={closeChat} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>{'<'}</button>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: roleColor }} />
        <div style={{ flex: 1 }}>
          {editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={handleRename}
              onKeyDown={e => e.key === 'Enter' && handleRename()}
              style={{ background: '#0d1b3e', color: '#fff', border: '1px solid #0f3460', borderRadius: 3, padding: '2px 6px', fontSize: 14, fontWeight: 'bold', width: '100%' }}
            />
          ) : (
            <div style={{ fontWeight: 'bold', fontSize: 14, cursor: 'pointer' }}
              onClick={() => { setNameInput(agent.name); setEditingName(true); }}
              title="Clique para renomear">
              {agent.name} <span style={{ fontSize: 10, color: '#666' }}>&#9998;</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#888' }}>{ROLE_LABELS[agent.role]} - {agent.status}</div>
        </div>
        {agent.role !== 'ceo' && (
          <button onClick={() => { fireAgent(agent.id); closeChat(); }}
            style={{ background: '#c0392b', color: 'white', border: 'none', borderRadius: 3, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
            Demitir
          </button>
        )}
      </div>

      {/* Profile */}
      <div style={{ padding: '8px 12px', background: '#0d1b3e', borderBottom: '1px solid #0f3460', fontSize: 12 }}>
        <div style={{ color: '#888' }}>{profile?.personality}</div>
        <div style={{ color: '#666', marginTop: 2 }}>{profile?.specialization}</div>
        <button onClick={() => setShowPrompt(!showPrompt)}
          style={{ marginTop: 4, background: '#1a1a5e', color: '#aaa', border: '1px solid #333', borderRadius: 3, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>
          {showPrompt ? 'Fechar Prompt' : 'Editar Prompt'}
        </button>
      </div>

      {showPrompt && profile && (
        <div style={{ padding: '8px 12px', background: '#0a1428', borderBottom: '1px solid #0f3460' }}>
          <textarea value={profile.systemPrompt} onChange={e => updateAgentPrompt(chatAgentId!, e.target.value)}
            style={{ width: '100%', height: 120, background: '#0d1b3e', color: '#ccc', border: '1px solid #333', borderRadius: 4, padding: 8, fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} />
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {history.length === 0 && (
          <div style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
            {agent.role === 'ceo'
              ? 'Converse com o CEO para gerenciar a equipe.'
              : `Converse com ${agent.name}. As respostas usam IA real (Claude).`}
          </div>
        )}
        {history.map(msg => (
          <div key={msg.id} style={{ marginBottom: 8, display: 'flex', justifyContent: msg.from === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.4, whiteSpace: 'pre-wrap',
              background: msg.from === 'user' ? '#1a5276' : '#1a1a5e', color: msg.from === 'user' ? '#ddd' : '#ccc',
              borderBottomRightRadius: msg.from === 'user' ? 2 : 8, borderBottomLeftRadius: msg.from === 'agent' ? 2 : 8,
            }}>
              {msg.from === 'agent' && <div style={{ fontSize: 10, color: roleColor, marginBottom: 2, fontWeight: 'bold' }}>{agent.name}</div>}
              {msg.text}
            </div>
          </div>
        ))}
        {chatLoading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div style={{ padding: '8px 14px', borderRadius: 8, background: '#1a1a5e', color: '#888', fontSize: 12 }}>
              <span style={{ color: roleColor, fontWeight: 'bold', fontSize: 10 }}>{agent.name}</span><br />
              Pensando...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #0f3460', display: 'flex', gap: 8 }}>
        <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
          disabled={chatLoading}
          placeholder={chatLoading ? 'Aguardando resposta...' : `Falar com ${agent.name}...`}
          style={{ flex: 1, padding: '8px 10px', background: '#0d1b3e', color: '#ddd', border: '1px solid #0f3460', borderRadius: 6, fontSize: 12, outline: 'none', opacity: chatLoading ? 0.5 : 1 }} />
        <button onClick={handleSend} disabled={chatLoading}
          style={{ padding: '8px 14px', background: chatLoading ? '#555' : roleColor, color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 'bold', cursor: chatLoading ? 'wait' : 'pointer' }}>
          Enviar
        </button>
      </div>
    </div>
  );
}
