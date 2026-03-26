export const SOFTCOMHUB_KNOWLEDGE = `
=== SOFTCOMHUB - SISTEMA DE ATENDIMENTO MULTICANAL ===

VISAO GERAL:
SoftcomHub e uma plataforma de atendimento ao cliente multicanal (WhatsApp + Discord).
Possui dois portais: Dashboard (admin/gestor) e WorkDesk (atendentes).
Usa Next.js, Supabase (banco + auth + realtime), WhatsApp Cloud API e Evolution API.

--- PORTAIS ---

DASHBOARD (/login -> /dashboard):
- Login com email/senha (precisa permissao can_view_dashboard)
- Pagina inicial mostra cards dos setores do usuario
- Sidebar: Setores, Monitoramento, Dashboard Geral, Usuarios Master (master only), Logs de Erros (master only)

WORKDESK (/workdesk/login -> /workdesk):
- Login com email/senha (ou senha master)
- Interface de chat para atendentes
- Lista de tickets na esquerda, chat no centro, info do cliente na direita
- Toggle online/offline/pausa no header
- Alerta sonoro ao receber novo ticket
- Suporta envio de texto, imagens, documentos, audio

--- PAGINAS DO DASHBOARD ---

/dashboard - Grid de setores (cards com icone, cor, canais). Criar setor, gerenciar tags.
/dashboard/monitoramento - Monitoramento em tempo real de tickets ativos. Transferir, encerrar tickets.
/dashboard/metricas - Graficos e KPIs (tempo medio resposta, resolucao, volume diario, tickets por setor/atendente).
/dashboard/colaboradores - CRUD de colaboradores (nome, email, senha, setores, permissao). Ativar/desativar.
/dashboard/setores - CRUD de setores (nome, descricao, template_id WhatsApp, phone_number_id).
/dashboard/permissoes - CRUD de permissoes (nome, can_view_dashboard, can_manage_users, can_view_all_tickets).
/dashboard/usuarios - Gestao master de usuarios (apenas para is_master).
/dashboard/logs - Visualizar/resolver/deletar logs de erros do frontend.
/setor/[id] - Detalhe do setor com abas: Tickets, Metricas, Agentes, Configuracoes (subsetores, canais, distribuicao, pausas, transmissao).

--- PAGINAS DO WORKDESK ---

/workdesk/login - Login do atendente (email/senha, esqueci senha, senha master).
/workdesk/reset-password - Redefinir senha (via link de email).
/workdesk - Workspace do atendente (chat com clientes).

--- ENTIDADES DO BANCO ---

colaboradores: id, nome, email, setor_id, permissao_id, is_online, ativo, is_master, pausa_atual_id, last_heartbeat
clientes: id, nome, telefone (unico), email, documento, CNPJ, Registro, PDV
tickets: id, numero, cliente_id, colaborador_id, setor_id, subsetor_id, status (aberto|em_atendimento|encerrado), prioridade (normal|urgente|baixa|media|alta), canal, primeira_resposta_em, criado_em, encerrado_em, is_disparo
mensagens: id, ticket_id, cliente_id, remetente (cliente|colaborador|bot|sistema), conteudo, tipo (texto|imagem|audio|video|documento), url_imagem, media_type, whatsapp_message_id
setores: id, nome, descricao, cor, icon_url, tag_id, template_id, phone_number_id, whatsapp_token, transmissao_ativa, setor_receptor_id, max_disparos_dia
subsetores: id, nome, setor_id
permissoes: id, nome, can_view_dashboard, can_manage_users, can_view_all_tickets
setor_canais: tipo (whatsapp|evolution_api), phone_number_id, whatsapp_token, instancia, evolution_base_url, evolution_api_key, ativo
ticket_distribution_config: setor_id, max_tickets_per_agent, auto_assign_enabled
pausas: id, nome, descricao, ativo, setor_id

--- SISTEMA DE DISTRIBUICAO DE TICKETS ---

1. Novo ticket criado (via webhook WhatsApp ou API)
2. Busca config do setor (max_tickets_per_agent, auto_assign_enabled)
3. Busca atendentes: online + ativo + sem pausa + heartbeat fresco (<2 min)
4. Se tem subsetor: busca atendentes do subsetor (colaboradores_subsetores)
5. Ordena: menos tickets primeiro, depois quem recebeu ha mais tempo (round-robin)
6. Atribui ao melhor candidato se abaixo do limite
7. Se ninguem disponivel: verifica transmissao_ativa -> encaminha para setor_receptor_id
8. Se mesmo assim nao atribui: ticket fica na fila (status=aberto, colaborador_id=null)

HEARTBEAT:
- Atendentes enviam heartbeat a cada ~30 segundos
- Heartbeat > 2 min = excluido da distribuicao
- Heartbeat > 5 min = marcado offline automaticamente

TRANSFERENCIA:
- Verifica atendente destino: online, sem pausa, heartbeat fresco (<5 min)
- Se destino no limite de tickets: ticket vai para fila
- Insere mensagem de sistema no chat documentando transferencia
- Limpa subsetor ao transferir entre setores

--- AUTENTICACAO ---

LOGIN DASHBOARD:
- Email/senha via Supabase signInWithPassword
- Verifica permissao can_view_dashboard na tabela colaboradores/permissoes
- Redireciona para /dashboard

LOGIN WORKDESK:
- Tenta login master primeiro (senha master fixa permite logar como qualquer usuario)
- Se nao e master, faz login normal Supabase
- Verifica se colaborador existe e esta ativo
- Redireciona para /workdesk

RECUPERACAO DE SENHA:
- Envia email com link para /workdesk/reset-password
- Link contem token no hash da URL
- Usuario define nova senha (min 6 caracteres)

--- API ENDPOINTS PRINCIPAIS ---

POST /api/tickets/criar - Criar ticket com distribuicao automatica (bots/n8n)
POST /api/tickets/transferir - Transferir ticket (setor/atendente)
POST /api/tickets/auto-assign - Processar fila de tickets
POST /api/tickets/disparo-externo - Disparo externo: criar cliente + ticket + enviar WhatsApp (n8n)
POST /api/whatsapp/send - Enviar mensagem WhatsApp (texto, imagem, documento)
POST /api/whatsapp/webhook - Receber mensagens WhatsApp (webhook)
POST /api/whatsapp/dispatch - Enviar disparo WhatsApp (template)
POST /api/evolution/send - Enviar mensagem via Evolution API
POST /api/clientes - Criar/atualizar cliente (upsert por telefone)
GET /api/clientes - Buscar clientes (por telefone ou termo)
POST /api/mensagens/save - Salvar mensagem de fonte externa (bot/n8n)
POST /api/colaborador/toggle-status - Alterar status online/offline/pausa
POST /api/colaborador/heartbeat - Keep-alive do atendente
POST /api/upload - Upload de arquivo (Vercel Blob)
POST /api/auth/master-login - Login master como qualquer usuario
POST /api/logs/error - Salvar log de erro frontend

--- CANAIS DE ATENDIMENTO ---

WHATSAPP (API OFICIAL META):
- Usa Cloud API v21.0 (graph.facebook.com)
- Configurado por setor: phone_number_id + whatsapp_token + template_id
- Recebe mensagens via webhook POST /api/whatsapp/webhook
- Envia respostas via POST /api/whatsapp/send
- Disparos usam templates aprovados pela Meta

EVOLUTION API:
- WhatsApp self-hosted (whatsapi.mensageria.softcomtecnologia.com)
- Configurado por setor via setor_canais (instancia, evolution_api_key)
- Suporta QR code para parear WhatsApp
- Envia texto direto (sem necessidade de template)

--- FUNCIONALIDADES-CHAVE ---

SISTEMA DE PAUSAS:
- Tipos de pausa configuraveis por setor (ex: Almoco, Banheiro)
- Atendente em pausa = excluido da distribuicao
- Historico de pausas rastreado

TRANSMISSAO/OVERFLOW:
- Quando nao ha atendentes no setor, tickets podem ir para setor receptor
- Configuravel: transmissao_ativa + setor_receptor_id
- Evita loops (receptor nao retransmite)

DISPAROS (OUTBOUND):
- Enviar mensagens proativas para clientes
- Via template (API Oficial) ou texto direto (Evolution)
- Limite diario configuravel (max_disparos_dia)
- Log de disparos para auditoria

MONITORAMENTO EM TEMPO REAL:
- Tickets ativos com timers ao vivo (HH:MM:SS)
- Status dos atendentes (online/offline/pausa)
- Transferir/encerrar tickets direto do monitoramento

TRACKING DE ERROS:
- Erros do frontend capturados automaticamente (ErrorBoundary)
- Salvos com tela, rota, componente, usuario, navegador
- Dashboard para visualizar/resolver erros

--- FLUXOS COMUNS ---

ATENDENTE INICIA TURNO:
1. Login em /workdesk/login
2. Ativa toggle online
3. Comeca a receber tickets automaticamente

ATENDENTE ATENDE TICKET:
1. Ticket aparece na sidebar (com alerta sonoro)
2. Clica no ticket para abrir chat
3. Le mensagem, digita resposta, envia
4. Pode enviar imagens/documentos
5. Pode transferir para outro setor/atendente
6. Encerra ticket quando resolvido

ADMIN CRIA COLABORADOR:
1. Login em /login (Dashboard)
2. Vai para Colaboradores
3. Clica "Novo Colaborador"
4. Preenche: Nome, Email, Senha, Setores, Permissao
5. Sistema cria usuario Auth + registro + vinculo com setores

CLIENTE ENVIA WHATSAPP:
1. Mensagem chega no webhook
2. Sistema encontra/cria cliente por telefone
3. Encontra ticket aberto ou cria novo
4. Auto-atribui para atendente via round-robin
5. Atendente ve ticket no WorkDesk e responde

SISTEMA EXTERNO CRIA TICKET (N8N/BOT):
1. POST /api/tickets/disparo-externo com setor_id, telefone, mensagem
2. Cria/encontra cliente
3. Cria ticket com distribuicao automatica
4. Envia mensagem via canal configurado
5. Retorna ticket_id, cliente_id, colaborador_id
`;
