-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('suporte', 'qa', 'dev', 'log_analyzer', 'ceo')),
  status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'walking', 'talking')),
  system_prompt TEXT,
  personality TEXT,
  specialization TEXT,
  tasks_completed INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  fired_at TIMESTAMPTZ
);

-- Queue / tickets
CREATE TABLE IF NOT EXISTS queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('suporte', 'qa', 'dev')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'escalated')),
  assigned_agent_id UUID REFERENCES agents(id),
  source TEXT CHECK (source IN ('discord', 'logs', 'demo', 'manual')),
  discord_author TEXT,
  discord_message TEXT,
  discord_channel_id TEXT,
  classification TEXT CHECK (classification IN ('duvida', 'bug')),
  payload JSONB,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Cases opened by DEV
CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id TEXT UNIQUE NOT NULL,
  bug_id TEXT,
  titulo TEXT NOT NULL,
  causa_raiz TEXT,
  arquivos_alterar JSONB,
  estrategia_fix TEXT,
  efeitos_colaterais JSONB,
  testes_necessarios JSONB,
  prompt_ia TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- System logs (for the log analyzer)
CREATE TABLE IF NOT EXISTS system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT CHECK (level IN ('info', 'warn', 'error', 'critical')),
  service TEXT,
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent messages / activity feed
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id UUID REFERENCES agents(id),
  to_agent_id UUID REFERENCES agents(id),
  message TEXT,
  type TEXT CHECK (type IN ('handoff', 'response', 'alert', 'chat')),
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Conversations (persistent chat history)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  ticket_id TEXT,
  agent_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
  author_name TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_ticket ON conversations(ticket_id);

-- RLS policies (run after table creation)
-- ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all on conversations" ON conversations FOR ALL USING (true) WITH CHECK (true);
