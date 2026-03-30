import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../../.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize tables (run schema if needed)
export async function initDatabase() {
  console.log('Connecting to Supabase:', supabaseUrl);

  // Test connection
  const { data, error } = await supabase.from('agents').select('count').limit(1);
  if (error) {
    console.warn('Supabase tables may not exist yet. Run schema.sql manually in Supabase SQL editor.');
    console.warn('Error:', error.message);
    return false;
  }
  console.log('Supabase connected successfully');
  return true;
}

// Agent CRUD
export async function dbCreateAgent(agent: {
  id: string;
  name: string;
  type: string;
  system_prompt: string;
  personality: string;
  specialization: string;
}) {
  const { data, error } = await supabase
    .from('agents')
    .upsert(agent, { onConflict: 'id' })
    .select()
    .single();
  if (error) console.error('dbCreateAgent error:', error);
  return data;
}

export async function dbFireAgent(id: string) {
  const { error } = await supabase
    .from('agents')
    .update({ fired_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('dbFireAgent error:', error);
}

export async function dbGetActiveAgents() {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .is('fired_at', null)
    .order('created_at');
  if (error) console.error('dbGetActiveAgents error:', error);
  return data || [];
}

// Queue / Tickets
export async function dbCreateTicket(ticket: {
  type: string;
  source: string;
  discord_author?: string;
  discord_message?: string;
  discord_channel_id?: string;
}) {
  const { data, error } = await supabase
    .from('queue')
    .insert(ticket)
    .select()
    .single();
  if (error) console.error('dbCreateTicket error:', error);
  return data;
}

export async function dbUpdateTicket(id: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('queue')
    .update(updates)
    .eq('id', id);
  if (error) console.error('dbUpdateTicket error:', error);
}

export async function dbGetPendingTickets(type?: string) {
  let query = supabase.from('queue').select('*').eq('status', 'pending').order('created_at');
  if (type) query = query.eq('type', type);
  const { data, error } = await query;
  if (error) console.error('dbGetPendingTickets error:', error);
  return data || [];
}

// Get all tickets (recent, any status)
export async function dbGetAllTickets(limit = 100) {
  const { data, error } = await supabase
    .from('queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('dbGetAllTickets error:', error);
  return data || [];
}

// Cases
export async function dbCreateCase(c: {
  caso_id: string;
  bug_id?: string;
  titulo: string;
  causa_raiz?: string;
  estrategia_fix?: string;
  prompt_ia: string;
  created_by?: string;
}) {
  const { data, error } = await supabase
    .from('cases')
    .insert(c)
    .select()
    .single();
  if (error) console.error('dbCreateCase error:', error);
  return data;
}

export async function dbGetCases() {
  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) console.error('dbGetCases error:', error);
  return data || [];
}

// System logs
export async function dbInsertLog(log: {
  level: string;
  service: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from('system_logs').insert(log);
  if (error) console.error('dbInsertLog error:', error);
}

export async function dbGetRecentLogs(limit = 100) {
  const { data, error } = await supabase
    .from('system_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('dbGetRecentLogs error:', error);
  return data || [];
}

// Agent messages
export async function dbLogAgentMessage(msg: {
  from_agent_id?: string;
  to_agent_id?: string;
  message: string;
  type: string;
  payload?: Record<string, unknown>;
}) {
  const { error } = await supabase.from('agent_messages').insert(msg);
  if (error) console.error('dbLogAgentMessage error:', error);
}

// Conversations
export async function dbSaveMessage(msg: {
  channel_id: string;
  ticket_id?: string;
  agent_id?: string;
  role: 'user' | 'agent' | 'system';
  author_name: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from('conversations').insert(msg);
  if (error) console.error('dbSaveMessage error:', error);
}

export async function dbGetConversation(channelId: string, limit = 20): Promise<Array<{ role: string; author_name: string; message: string; created_at: string }>> {
  const { data, error } = await supabase
    .from('conversations')
    .select('role, author_name, message, created_at')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) console.error('dbGetConversation error:', error);
  return data || [];
}

export async function dbGetTicketChannel(ticketId: string): Promise<string | null> {
  const { data } = await supabase
    .from('queue')
    .select('discord_channel_id')
    .eq('id', ticketId)
    .single();
  return data?.discord_channel_id || null;
}

export async function dbUpdateCase(casoId: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('cases')
    .update(updates)
    .eq('caso_id', casoId);
  if (error) console.error('dbUpdateCase error:', error);
}

export async function dbGetCaseWithTicket(casoId: string) {
  const { data } = await supabase
    .from('cases')
    .select('*, queue!cases_bug_id_fkey(discord_channel_id)')
    .eq('caso_id', casoId)
    .single();
  return data;
}

export async function dbUpdateAgent(id: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('agents')
    .update(updates)
    .eq('id', id);
  if (error) console.error('dbUpdateAgent error:', error);
}

// Agent skill learnings
const MAX_LEARNINGS_PER_AGENT = 10;

export async function dbAddLearning(learning: {
  agent_name: string;
  role: string;
  learning: string;
  task_context: string;
  tasks_completed_at: number;
}) {
  // Insert new learning
  const { error } = await supabase.from('agent_learnings').insert(learning);
  if (error) { console.error('dbAddLearning error:', error); return; }

  // Enforce max: delete oldest if over limit
  const { data: all } = await supabase
    .from('agent_learnings')
    .select('id, created_at')
    .eq('agent_name', learning.agent_name)
    .order('created_at', { ascending: false });

  if (all && all.length > MAX_LEARNINGS_PER_AGENT) {
    const toDelete = all.slice(MAX_LEARNINGS_PER_AGENT).map((r: { id: string }) => r.id);
    await supabase.from('agent_learnings').delete().in('id', toDelete);
  }
}

export async function dbGetLearnings(agentName: string): Promise<Array<{ learning: string; tasks_completed_at: number; created_at: string }>> {
  const { data, error } = await supabase
    .from('agent_learnings')
    .select('learning, tasks_completed_at, created_at')
    .eq('agent_name', agentName)
    .order('created_at', { ascending: true });
  if (error) console.error('dbGetLearnings error:', error);
  return data || [];
}

// Agent activity queries — for injecting real data into chat context
export async function dbGetAgentTickets(agentName: string, limit = 10) {
  // Tickets where this agent was involved (conversations as agent)
  const { data, error } = await supabase
    .from('conversations')
    .select('channel_id, ticket_id, message, created_at')
    .eq('author_name', agentName)
    .eq('role', 'agent')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('dbGetAgentTickets error:', error);
  return data || [];
}

export async function dbGetAgentCases(agentName: string, limit = 10) {
  const { data, error } = await supabase
    .from('cases')
    .select('caso_id, bug_id, titulo, causa_raiz, status, created_at')
    .eq('created_by', agentName)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('dbGetAgentCases error:', error);
  return data || [];
}

export async function dbGetRecentTicketsWithAgent(limit = 20) {
  // All recent tickets with their conversation agents
  const { data, error } = await supabase
    .from('queue')
    .select('id, discord_author, discord_message, status, classification, result, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('dbGetRecentTicketsWithAgent error:', error);
  return data || [];
}

export async function dbGetRecentAnomalies(limit = 5) {
  const { data, error } = await supabase
    .from('system_logs')
    .select('level, service, message, created_at')
    .in('level', ['error', 'warn', 'anomaly'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('dbGetRecentAnomalies error:', error);
  return data || [];
}

export async function dbIncrementTasksCompleted(agentName: string): Promise<number> {
  // Fetch current count first
  const { data: agent } = await supabase
    .from('agents')
    .select('id, tasks_completed')
    .eq('name', agentName)
    .is('fired_at', null)
    .single();

  if (!agent) return 0;
  const newCount = (agent.tasks_completed || 0) + 1;
  await supabase.from('agents').update({ tasks_completed: newCount }).eq('id', agent.id);
  return newCount;
}
