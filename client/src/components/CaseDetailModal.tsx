import { useState, useEffect } from 'react';
import { useOfficeStore } from '../stores/officeStore';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (
  window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''
);

interface ConversationMessage {
  role: string;
  author_name: string;
  message: string;
  created_at: string;
}

export function CaseDetailModal() {
  const { cases, selectedCaseId, caseDetailOpen, closeCaseDetail, resolveCase, deleteCase } = useOfficeStore();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const caseInfo = cases.find(c => c.casoId === selectedCaseId);

  useEffect(() => {
    if (!selectedCaseId || !caseDetailOpen) return;
    setLoading(true);
    setMessages([]);
    setConfirmDelete(false);
    fetch(`${SERVER_URL}/api/cases/${selectedCaseId}/conversation`)
      .then(r => r.json())
      .then(data => setMessages(data.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [selectedCaseId, caseDetailOpen]);

  if (!caseDetailOpen || !caseInfo) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(caseInfo.promptIa || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteCase(caseInfo.casoId);
  };

  const isOpen = caseInfo.status !== 'resolved';

  return (
    <div className="modal-overlay" onClick={closeCaseDetail}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`status-dot ${isOpen ? 'status-open' : 'status-resolved'}`} />
            <h3 style={{ margin: 0, fontSize: 16 }}>{caseInfo.casoId}</h3>
            {caseInfo.bugId && <span className="badge badge-bug">{caseInfo.bugId}</span>}
            <span className={`badge ${isOpen ? 'badge-open' : 'badge-resolved'}`}>
              {isOpen ? 'Aberto' : 'Resolvido'}
            </span>
          </div>
          <button className="btn-icon" onClick={closeCaseDetail} title="Fechar">X</button>
        </div>

        {/* Case Info */}
        <div className="modal-section">
          <h4 className="section-title">Detalhes do Caso</h4>
          <p style={{ fontSize: 13, color: '#ccc', marginBottom: 8 }}>{caseInfo.titulo}</p>

          {caseInfo.promptIa && (
            <div className="prompt-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#888', fontWeight: 'bold' }}>PROMPT DE CORRECAO</span>
                <button className="btn-sm btn-secondary" onClick={handleCopy}>
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
              <pre className="prompt-code">{caseInfo.promptIa}</pre>
            </div>
          )}
        </div>

        {/* Conversation */}
        <div className="modal-section" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <h4 className="section-title">Conversa do Ticket</h4>
          <div className="conversation-list">
            {loading && <div className="text-muted">Carregando conversa...</div>}
            {!loading && messages.length === 0 && (
              <div className="text-muted">Nenhuma conversa vinculada a este caso</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role === 'agent' ? 'msg-agent' : 'msg-user'}`}>
                <div className="msg-header">
                  <span className="msg-author">{m.author_name}</span>
                  <span className="msg-time">
                    {new Date(m.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <div className="msg-text">{m.message}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="modal-actions">
          {isOpen && (
            <button className="btn btn-success" onClick={() => resolveCase(caseInfo.casoId)}>
              Resolver Caso
            </button>
          )}
          <button
            className={`btn ${confirmDelete ? 'btn-danger-confirm' : 'btn-danger'}`}
            onClick={handleDelete}
          >
            {confirmDelete ? 'Confirmar Exclusao?' : 'Deletar Caso'}
          </button>
          <button className="btn btn-secondary" onClick={closeCaseDetail}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
