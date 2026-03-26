import { useState, useRef, useEffect } from 'react';
import { useOfficeStore } from '../stores/officeStore';

const ROLE_COLORS: Record<string, string> = {
  ceo: '#f0c040', suporte: '#4488ff', qa: '#aa44ff', dev: '#ff8844', log_analyzer: '#44cc88',
};
const ROLE_LABELS: Record<string, string> = {
  ceo: 'CEO', suporte: 'Suporte', qa: 'QA', dev: 'DEV', log_analyzer: 'Log Analyzer',
};

export function MeetingChat() {
  const {
    meetingTopic, meetingParticipants, meetingMessages,
    meetingLoading, sendMeetingMessage, endMeeting,
  } = useOfficeStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [meetingMessages.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || meetingLoading) return;
    sendMeetingMessage(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', background: '#0f3460', borderBottom: '1px solid #1a1a5e' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: 14, color: '#f0c040' }}>Sala de Reuniao</div>
            <div style={{ fontSize: 11, color: '#888' }}>{meetingTopic}</div>
          </div>
          <button onClick={endMeeting}
            style={{ background: '#c0392b', color: 'white', border: 'none', borderRadius: 3, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
            Encerrar
          </button>
        </div>
      </div>

      {/* Participants */}
      <div style={{ padding: '6px 12px', background: '#0d1b3e', borderBottom: '1px solid #0f3460', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {meetingParticipants.map(name => {
          const agent = useOfficeStore.getState().agents.find(a => a.name === name);
          const roleColor = agent ? ROLE_COLORS[agent.role] || '#888' : '#888';
          const roleLabel = agent ? ROLE_LABELS[agent.role] || agent.role : '';
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#aaa' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: roleColor }} />
              <span>{name}</span>
              <span style={{ color: '#555' }}>({roleLabel})</span>
            </div>
          );
        })}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {meetingMessages.length === 0 && (
          <div style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
            Todos os agentes foram convocados. Quando chegarem, envie uma mensagem para iniciar a reuniao.
          </div>
        )}
        {meetingMessages.map(msg => {
          const roleColor = msg.agentRole ? ROLE_COLORS[msg.agentRole] || '#888' : '#888';
          return (
            <div key={msg.id} style={{ marginBottom: 8, display: 'flex', justifyContent: msg.from === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.4, whiteSpace: 'pre-wrap',
                background: msg.from === 'user' ? '#1a5276' : '#1a1a5e', color: msg.from === 'user' ? '#ddd' : '#ccc',
                borderBottomRightRadius: msg.from === 'user' ? 2 : 8, borderBottomLeftRadius: msg.from === 'agent' ? 2 : 8,
              }}>
                {msg.from === 'agent' && (
                  <div style={{ fontSize: 10, color: roleColor, marginBottom: 2, fontWeight: 'bold' }}>
                    {msg.agentName} ({ROLE_LABELS[msg.agentRole || ''] || msg.agentRole})
                  </div>
                )}
                {msg.text}
              </div>
            </div>
          );
        })}
        {meetingLoading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div style={{ padding: '8px 14px', borderRadius: 8, background: '#1a1a5e', color: '#888', fontSize: 12 }}>
              Aguardando respostas...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #0f3460', display: 'flex', gap: 8 }}>
        <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
          disabled={meetingLoading}
          placeholder={meetingLoading ? 'Aguardando respostas...' : 'Falar na reuniao...'}
          style={{ flex: 1, padding: '8px 10px', background: '#0d1b3e', color: '#ddd', border: '1px solid #0f3460', borderRadius: 6, fontSize: 12, outline: 'none', opacity: meetingLoading ? 0.5 : 1 }} />
        <button onClick={handleSend} disabled={meetingLoading}
          style={{ padding: '8px 14px', background: meetingLoading ? '#555' : '#f0c040', color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 'bold', cursor: meetingLoading ? 'wait' : 'pointer' }}>
          Enviar
        </button>
      </div>
    </div>
  );
}
