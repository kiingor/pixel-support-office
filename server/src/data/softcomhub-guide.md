# SoftcomHub - Complete System Documentation

## System Overview

SoftcomHub is a multichannel customer support platform built with Next.js 16, React 19, Supabase (PostgreSQL + Auth + Realtime), and Tailwind CSS. It provides WhatsApp and Discord integration for customer service, with real-time ticket management, agent routing, and administrative dashboards. The system is written primarily in Portuguese (Brazilian).

**Tech Stack:**
- Frontend: Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI, Framer Motion, Recharts, SWR
- Backend: Next.js API Routes (App Router), Supabase (PostgreSQL + Auth + Realtime + RLS)
- File Storage: Vercel Blob
- Messaging: WhatsApp Cloud API (Meta), Evolution API (self-hosted WhatsApp)
- Authentication: Supabase Auth (email/password + master password)

---

## Architecture

### Two Main Portals

1. **Dashboard** (`/dashboard/*`) - Admin portal for managers/supervisors
2. **WorkDesk** (`/workdesk/*`) - Agent workspace for customer service representatives

### Database (Supabase/PostgreSQL)

**Core Tables:**
- `colaboradores` - Users/agents (id, nome, email, setor_id, permissao_id, is_online, ativo, is_master, pausa_atual_id, last_heartbeat)
- `clientes` - Customers (id, nome, telefone [unique], email, documento, CNPJ, Registro, PDV)
- `tickets` - Support tickets (id, numero, cliente_id, colaborador_id, setor_id, subsetor_id, status, prioridade, canal, primeira_resposta_em, criado_em, encerrado_em, is_disparo, ultima_mensagem, ultima_mensagem_em, mensagens_nao_lidas)
- `mensagens` - Chat messages (id, ticket_id, cliente_id, remetente [cliente|colaborador|bot|sistema], conteudo, tipo [texto|imagem|audio|video|documento], url_imagem, media_type, whatsapp_message_id, canal_envio, phone_number_id, enviado_em)
- `setores` - Departments/sectors (id, nome, descricao, cor, icon_url, tag_id, template_id, phone_number_id, whatsapp_token, template_language, max_disparos_dia, transmissao_ativa, setor_receptor_id, tempo_espera_minutos)
- `subsetores` - Sub-departments (id, nome, setor_id)
- `permissoes` - Permission roles (id, nome, can_view_dashboard, can_manage_users, can_view_all_tickets)
- `tags` - Category tags for sectors (id, nome, cor, ordem)

**Join Tables:**
- `colaborador_setores` / `colaboradores_setores` - Agent-to-sector assignments
- `colaboradores_subsetores` - Agent-to-subsector assignments (with setor_id)
- `setor_canais` - Channel configurations per sector (tipo [whatsapp|evolution_api], phone_number_id, whatsapp_token, instancia, evolution_base_url, evolution_api_key, template_id, ativo)

**Operational Tables:**
- `ticket_logs` - Ticket audit trail (ticket_id, tipo, descricao, colaborador_id)
- `ticket_assignment_logs` - Auto-assignment audit
- `ticket_distribution_config` - Per-sector distribution settings (setor_id, max_tickets_per_agent, auto_assign_enabled)
- `disponibilidade_logs` - Agent availability history
- `pausas` - Break/pause types per sector
- `pausas_colaboradores` - Active break records
- `disparo_logs` - Outbound message dispatch logs
- `error_logs` - Frontend error tracking (tela, rota, log, componente, resolvido)

---

## Pages and Routes

### Root (`/`)
- Server component that checks auth and redirects:
  - Unauthenticated -> `/login`
  - Has dashboard permission -> `/dashboard`
  - Otherwise -> `/workdesk`

### Login (`/login`)
- **Purpose:** Admin login for Dashboard access
- **Form fields:** Email, Password
- **Auth flow:** Supabase `signInWithPassword` -> checks `colaboradores` table for `can_view_dashboard` permission -> redirects to `/dashboard`
- **Buttons:** "Acessar Dashboard" (submit), eye toggle for password, link to WorkDesk login

### Dashboard Layout (`/dashboard`)
- Protected by auth check (redirects to `/login` if not authenticated)
- Uses `DashboardShell` component with sidebar navigation
- Sidebar navigation items:
  - **Setores** (`/dashboard`) - Main dashboard showing sector cards
  - **Monitoramento** (`/dashboard/monitoramento`) - Real-time monitoring
  - **Dashboard Geral** (`/dashboard/metricas`) - Metrics/analytics
  - **Usuarios Master** (`/dashboard/usuarios`) - Master user management (master only)
  - **Logs de Erros** (`/dashboard/logs`) - Error log viewer (master only)

### Dashboard Home / Setores (`/dashboard`)
- **Purpose:** Grid of sector cards showing all departments the user has access to
- **Features:**
  - Search/filter sectors by name
  - Create new sector (dialog with name, description, icon, color, tag, channel badges)
  - Tags management (create, edit, delete tags with name, color, order)
  - Click sector card -> navigates to `/setor/[id]`
  - Shows channel badges (WhatsApp, Evolution, Discord) on each sector card

### Sector Detail (`/setor/[id]`)
- **Purpose:** Detailed view of a single sector with tabs
- **Tabs:**
  - Tickets list with filters (status, priority, subsetor, search)
  - Metrics (charts, KPIs for this sector)
  - Agents (collaborators assigned to this sector)
  - Settings (sector config, subsetors, channel management, distribution config, transmission settings)
- **Key features:**
  - Subsetor management (create/edit/delete sub-departments)
  - Channel configuration (WhatsApp Official API or Evolution API instances)
  - Ticket distribution settings (max_tickets_per_agent, auto_assign_enabled)
  - Transmission/overflow settings (transmissao_ativa, setor_receptor_id)
  - Pause types management (create break/pause categories)

### Tickets (`/dashboard/tickets`)
- **Purpose:** Global ticket list with filtering and detail view
- **Features:**
  - Table with columns: Client name/phone, Sector, Subsector, Agent, Status, Priority, Channel, Time
  - Filters: Status (aberto/em_atendimento/encerrado), Priority (baixa/media/alta), Sector, Subsector, Search
  - Click ticket -> opens detail dialog with:
    - Ticket info card
    - Message history (chat log)
    - Ticket action logs
  - Create new ticket manually (select client, sector, priority)
  - Status badges with colors (blue=open, yellow=in_progress, green=closed)
  - Live timer showing elapsed time for open tickets
  - Tabs: "Todos", "Abertos", "Em Atendimento", "Encerrados"

### Colaboradores (`/dashboard/colaboradores`)
- **Purpose:** Manage support agents/collaborators
- **Table columns:** Nome, Email, Setores (badges), Permissao, Status (online/offline indicator)
- **Actions:**
  - "Novo Colaborador" button -> Create dialog (Nome, Email, Senha, Setores checkboxes, Permissao select)
  - "Editar" button -> Edit dialog (same fields, email disabled)
  - "Desativar/Reativar" button -> Confirmation dialog
- **Creating a collaborator:** Creates Supabase Auth user + inserts into colaboradores table + assigns sectors via colaborador_setores
- **Real-time:** Subscribes to postgres changes for online status updates

### Setores Management (`/dashboard/setores`)
- **Purpose:** CRUD for departments/sectors
- **Table columns:** Nome, Descricao, Template ID, Phone Number ID, Criado em
- **Actions:**
  - FAB "+" button -> Create dialog
  - "Editar" button per row -> Edit dialog
- **Form fields:** Nome, Descricao, Template ID (WhatsApp), Phone Number ID (WhatsApp)

### Permissoes (`/dashboard/permissoes`)
- **Purpose:** Manage permission roles
- **Table columns:** Nome, Capabilities (badges for Dashboard/Usuarios/Todos Tickets), Colaboradores count
- **Actions:**
  - FAB "+" -> Create dialog
  - "Editar" -> Edit dialog
  - "Excluir" (only if 0 collaborators assigned) -> Confirmation dialog
- **Form fields:** Nome, Checkboxes for: can_view_dashboard, can_manage_users, can_view_all_tickets

### Metricas (`/dashboard/metricas`)
- **Purpose:** Analytics dashboard with charts
- **KPI Cards:** Tempo Medio 1a Resposta, Tempo Medio Resolucao, Tickets Recebidos, Tickets Encerrados
- **Charts:** Tickets by sector (bar), Tickets by collaborator (bar), Daily volume (line)
- **Filters:** Date period (7d/15d/30d/90d/custom), Sector, Subsector
- **Pagination:** Charts support pagination for large datasets

### Monitoramento (`/dashboard/monitoramento`)
- **Purpose:** Real-time ticket monitoring
- **Features:**
  - Live ticket list with durations (HH:MM:SS format)
  - Quick filters: Status, Sector, search
  - Actions per ticket: View details, Transfer, Close
  - Transfer dialog: Select target sector + target agent (shows online/offline status)
  - Close ticket confirmation dialog
  - Phone number formatting (Brazilian format)
  - Tabs with different views

### Usuarios Master (`/dashboard/usuarios`)
- **Purpose:** Master-level user management (only visible to is_master users)
- **Features:** Full CRUD for users with master flag toggle, sector assignments, permission assignments

### Logs de Erros (`/dashboard/logs`)
- **Purpose:** View and manage frontend error logs
- **Features:**
  - Expandable rows showing error details and metadata
  - Filters: Tela (screen), Status (resolvido/pendente), search
  - Actions: Toggle resolved, Delete individual log, Refresh
  - Displays: tela, rota, componente, usuario, navegador, timestamp

---

### WorkDesk Login (`/workdesk/login`)
- **Purpose:** Agent login for WorkDesk
- **Form fields:** Email, Password
- **Auth flow:** Tries master login API first -> falls back to Supabase signInWithPassword -> checks colaboradores table -> redirects to /workdesk
- **Additional views:** Forgot password (sends reset email), Forgot password sent confirmation
- **Link:** "Esqueceu sua senha?" -> forgot password flow

### WorkDesk Reset Password (`/workdesk/reset-password`)
- **Purpose:** Set new password after recovery email
- **Features:** Password strength indicator, confirm password, auto-redirect after success
- **Flow:** Receives recovery token via URL hash -> Supabase exchanges for session -> user sets new password

### WorkDesk Layout (`/workdesk`)
- **Header components:**
  - DisponibilidadePanel - Toggle online/offline/pause status
  - NotificacoesPanel - Notification bell
  - ThemeToggle - Dark/light mode
  - User dropdown menu with: Sound preferences (Default/Buh Buh), Change password, Logout
- **Change password dialog:** Current password, New password, Confirm password -> logs out after change

### WorkDesk Main (`/workdesk`)
- **Purpose:** Primary agent workspace - chat interface
- **Layout:** Left sidebar (ticket list) + Center (chat) + Right panel (client info)
- **Ticket list features:**
  - Tabs: My tickets, All sector tickets
  - Search by client name/phone/ticket number
  - Status filters
  - Unread message count badges
  - Last message preview
  - Sort by last activity
- **Chat features:**
  - Real-time message display (text, images, audio, video, documents)
  - Send text messages (Enter to send)
  - Send images/files (upload via Vercel Blob -> send via WhatsApp/Evolution)
  - Audio playback for voice messages
  - System messages (transfers, auto-assignments)
  - Message status indicators
  - Copy message text
- **Client info panel:**
  - Client details (nome, telefone, email, CNPJ, Registro, PDV, documento)
  - Edit client info inline
  - Ticket history for this client
- **Ticket actions:**
  - Transfer ticket (to another sector/agent)
  - Close ticket (encerrar)
  - Change priority
- **Dispatch (Disparo):** Send outbound WhatsApp template messages to clients
- **Audio alerts:** Plays sound on new ticket arrival (configurable: default or "buh buh")

---

## API Endpoints

### Authentication
- `POST /api/auth/master-login` - Login as any user with master password (generates magic link session)

### Colaboradores
- `POST /api/colaborador/toggle-status` - Set online/offline/pause status (service role, bypasses RLS)
- `POST /api/colaborador/heartbeat` - Keep-alive heartbeat (updates last_heartbeat only)
- `GET /api/colaborador/heartbeat` - Get current status

### Tickets
- `POST /api/tickets/criar` - Create ticket with auto-distribution (called by bots/n8n)
- `POST /api/tickets/transferir` - Transfer ticket to another sector/agent (respects max_tickets limit)
- `POST /api/tickets/auto-assign` - Process ticket queue, auto-distribute to available agents
- `GET /api/tickets/auto-assign` - Get queue configuration
- `PATCH /api/tickets/auto-assign` - Update queue configuration
- `POST /api/tickets/disparo-externo` - External dispatch: create client + ticket + send WhatsApp message (for n8n/bots)
- `POST /api/tickets/process-queue` - Trigger queue processing

### Clientes
- `POST /api/clientes` - Create or update client (upsert by telefone)
- `GET /api/clientes` - List/search clients (by telefone, search term)
- `GET /api/clientes/lookup` - Quick lookup by phone

### Messages
- `POST /api/mensagens/save` - Save message from external source (bot/n8n)
- `POST /api/whatsapp/send` - Send WhatsApp message via Cloud API (text, image, document)
- `POST /api/whatsapp/webhook` - Receive incoming WhatsApp messages (webhook)
- `GET /api/whatsapp/webhook` - WhatsApp webhook verification
- `POST /api/whatsapp/dispatch` - Send outbound WhatsApp template dispatch
- `GET /api/whatsapp/dispatch/count` - Get dispatch count for today

### Evolution API
- `POST /api/evolution/send` - Send message via Evolution API
- `POST /api/evolution/dispatch` - Send dispatch via Evolution API
- `POST /api/evolution/instance/create` - Create new Evolution API instance
- `GET /api/evolution/instance/[instanceName]` - Get instance info
- `GET /api/evolution/instance/[instanceName]/connect` - Get QR code for instance
- `GET /api/evolution/instance/[instanceName]/status` - Get connection status

### Webhooks
- `POST /api/webhooks/dispatch` - Webhook endpoint for external dispatch events

### File Upload
- `POST /api/upload` - Upload file to Vercel Blob (images: 16MB, videos: 50MB, documents: 100MB)

### Audio
- `GET /api/audio/[type]` - Get audio files for notifications

### Admin
- `POST /api/admin/create-user` - Create user (admin)
- `POST /api/admin/delete-user` - Delete user (admin)

### Logs
- `POST /api/logs/error` - Save frontend error log
- `PATCH /api/logs/error` - Toggle resolved status
- `DELETE /api/logs/error` - Delete error log(s)

### Setor
- `GET /api/setor/lookup` - Lookup sector by criteria

### Discord
- `POST /api/discord/send` - Send message to Discord channel

---

## Ticket Distribution System

### Round-Robin Auto-Assignment
When a new ticket is created:
1. Check `ticket_distribution_config` for sector settings (max_tickets_per_agent, auto_assign_enabled)
2. Find available agents: online + active + not paused + fresh heartbeat (< 2 min)
3. Sort by: fewest active tickets first, then oldest last-assignment (round-robin)
4. Assign to best candidate if under max_tickets limit
5. If no agent available: check sector's `transmissao_ativa` -> forward to `setor_receptor_id`

### Heartbeat System
- Agents send heartbeat every ~30 seconds via `POST /api/colaborador/heartbeat`
- Agents with stale heartbeat (> 2 min) are excluded from distribution
- Agents with very stale heartbeat (> 5 min) are automatically marked offline

### Transfer Rules
- Checks target agent: must be online, not paused, heartbeat fresh (< 5 min)
- If target agent at max ticket limit: ticket goes to queue (colaborador_id = null, status = aberto)
- Inserts system message in chat documenting the transfer

---

## Authentication Flow

### Dashboard Login
1. User enters email + password at `/login`
2. Supabase `signInWithPassword`
3. Query `colaboradores` table to check `can_view_dashboard` permission
4. Redirect to `/dashboard` or show error

### WorkDesk Login
1. User enters email + password at `/workdesk/login`
2. First tries master login (`POST /api/auth/master-login`) - if password matches master password, generates magic link session for that user
3. If not master, normal Supabase `signInWithPassword`
4. Check `colaboradores` table for active status
5. Redirect to `/workdesk`

### Password Reset
1. User clicks "Esqueceu sua senha?" -> enters email
2. Supabase sends reset email with link to `/workdesk/reset-password`
3. User clicks link -> page exchanges token for session
4. User sets new password -> auto-redirect to login

### Session Management
- Middleware (`middleware.ts`) runs on all routes except API/static, using Supabase session proxy
- Dashboard layout checks auth on every page load
- WorkDesk layout checks auth and loads collaborator data

---

## Key Features

### Multi-Channel Support
- **WhatsApp Cloud API (Official):** Direct integration with Meta's API for sending/receiving messages
- **Evolution API:** Self-hosted WhatsApp bridge, supports QR code pairing
- **Discord:** Message integration via Discord bot
- Each sector can have multiple channels configured independently

### Real-time Updates
- Supabase Realtime subscriptions for:
  - Ticket status changes
  - Agent online/offline status
  - New messages
  - Collaborator status updates
- SWR with refresh intervals for data polling

### Dispatch System (Disparos)
- Send outbound WhatsApp template messages to clients
- Supports both Official API (templates) and Evolution API (direct text)
- Daily dispatch limits per sector (`max_disparos_dia`)
- Dispatch logging for audit trail

### Pause/Break System
- Configurable pause types per sector (e.g., "Almoco", "Banheiro")
- Agents can go on pause -> excluded from ticket distribution
- Pause duration tracking
- Availability history logging

### Error Tracking
- Frontend errors captured via `ErrorBoundary` and `GlobalErrorHandler`
- Logged to `error_logs` table with screen, route, component, user info, browser
- Dashboard for viewing/resolving/deleting error logs

### Sector Transmission (Overflow)
- When no agents are available in a sector, tickets can be automatically forwarded to a receptor sector
- Configurable per sector: `transmissao_ativa` + `setor_receptor_id`
- Prevents loops (no retransmission from receptor)

---

## Common User Flows

### Agent starts shift
1. Login at `/workdesk/login`
2. Click online toggle in DisponibilidadePanel
3. System sends heartbeat, starts receiving tickets
4. Tickets auto-assigned via round-robin

### Agent handles a ticket
1. Ticket appears in left sidebar (with audio alert)
2. Click ticket to open chat
3. Read customer message, type response
4. Send text/images/files
5. Transfer if needed (to another sector/agent)
6. Close ticket when resolved

### Admin creates a new agent
1. Login at `/login` (Dashboard)
2. Go to Colaboradores page
3. Click "Novo Colaborador"
4. Fill: Nome, Email, Senha, select Setores, select Permissao
5. System creates Supabase Auth user + colaboradores record + sector assignments

### Customer sends WhatsApp message
1. Message arrives at WhatsApp webhook
2. System finds/creates client by phone number
3. Finds existing open ticket or creates new one
4. Auto-assigns to available agent via round-robin
5. Agent sees ticket in WorkDesk
6. Agent responds -> message sent via WhatsApp API

### External system creates ticket (n8n/bot)
1. `POST /api/tickets/disparo-externo` with setor_id, telefone, mensagem
2. System creates/finds client
3. Creates ticket with auto-distribution
4. Sends WhatsApp message via configured channel
5. Returns ticket_id, cliente_id, colaborador_id
