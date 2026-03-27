import type { AgentRole } from './agents';

// --- Personality → visual behavior ---

export interface PersonalityBehavior {
  walkSpeed: number;           // px/s
  idleTurnInterval: number;    // seconds between sitting direction changes
  bubbleInterval: number;      // seconds between random idle bubbles
  wanderInterval: number;      // seconds between micro-wanders
  animFrameDuration: number;   // seconds per frame while typing
  quirkBubbles: string[];      // bubble texts derived from quirk trait
}

const QUIRK_BUBBLES: Record<string, string[]> = {
  'usa analogias do futebol pra tudo': [
    '⚽ É igual ao pênalti!', '🏆 Hoje tô no campo deles!', 'Vacilou, tomou gol.',
    'Escalei a solução certa!', 'Pressão é pré-temporada.', 'Letra de jogo, não de torcida.',
  ],
  'faz referências constantes a filmes e séries': [
    '🎬 Isso é exatamente Matrix.', 'Como diria o Yoda: paciência.', 'Spoiler: o bug estava aqui.',
    'Temporada 2 do erro começou.', '"Com grandes poderes..."', '404: expectativa not found.',
  ],
  'cita métricas e números em toda resposta': [
    '📊 Taxa de erro: 0,003%.', 'KPI do dia: verde!', 'SLA: 98,7% no mês.',
    '3 tickets. 3 resoluções.', 'NPS subiu 2 pontos.', 'Latência: 12ms. Ok.',
  ],
  'sempre pergunta "qual o impacto real disso?"': [
    'Mas qual o impacto real?', 'Afeta quantos usuários?', '🤔 Vale o esforço?',
    'Precisamos medir antes.', 'Impacto zero = baixa prioridade.', 'Qual a severidade real?',
  ],
  'documenta absolutamente tudo com obsessão': [
    '📝 Anotado. Em dois lugares.', 'Isso precisa de uma wiki.', 'Se não documentou, não existe.',
    'Changelog atualizado!', 'Template criado.', 'Registrei pra posteridade.',
  ],
  'sempre busca a solução mais simples possível': [
    'KISS: keep it simple!', '✂️ Remove o desnecessário.', 'Por que complicar?',
    'Menos é mais.', 'Complexidade é dívida técnica.', 'A mais simples é a certa.',
  ],
  'tem um bordão próprio que repete com frequência': [
    'Bora que bora!', '🗣️ Tamo junto!', 'Faz acontecer!',
    'No final, funciona.', 'Meu lema: entregou, ganhou.', 'Foco total!',
  ],
  'compara situações técnicas com coisas do dia a dia': [
    'Bug é feijão queimado: cheiro avisa.', '🔧 Código é encanamento.', 'Cache é a geladeira do sistema.',
    'Deploy é abrir o restaurante.', 'É como cozinhar: timing importa.', 'Log é nota fiscal: guarda tudo.',
  ],
};

export function parsePersonalityBehavior(personality: string): PersonalityBehavior {
  // walkSpeed from comunicacao trait
  let walkSpeed = 48;
  if (personality.includes('ansioso e apressado')) walkSpeed = 72;
  else if (personality.includes('entusiasmado e animado')) walkSpeed = 65;
  else if (personality.includes('informal e bem descontraído')) walkSpeed = 52;
  else if (personality.includes('direto e objetivo')) walkSpeed = 50;
  else if (personality.includes('irônico e levemente sarcástico')) walkSpeed = 48;
  else if (personality.includes('formal e protocolar')) walkSpeed = 44;
  else if (personality.includes('prolixo e muito detalhista')) walkSpeed = 40;
  else if (personality.includes('calmo e ponderado')) walkSpeed = 34;

  // idleTurnInterval from comunicacao trait
  let idleTurnInterval = 5.5;
  if (personality.includes('ansioso e apressado')) idleTurnInterval = 2.5;
  else if (personality.includes('entusiasmado e animado')) idleTurnInterval = 3.0;
  else if (personality.includes('informal e bem descontraído')) idleTurnInterval = 4.5;
  else if (personality.includes('formal e protocolar')) idleTurnInterval = 7.0;
  else if (personality.includes('calmo e ponderado')) idleTurnInterval = 8.0;

  // wanderInterval from estilo trait
  let wanderInterval = 20;
  if (personality.includes('curioso que quer entender o porquê de tudo')) wanderInterval = 12;
  else if (personality.includes('criativo que pensa fora da caixa')) wanderInterval = 10;
  else if (personality.includes('cético que questiona tudo')) wanderInterval = 15;
  else if (personality.includes('pragmático focado em resultados rápidos')) wanderInterval = 20;
  else if (personality.includes('assertivo e seguro nas decisões')) wanderInterval = 22;
  else if (personality.includes('perfeccionista que não tolera erros')) wanderInterval = 28;
  else if (personality.includes('metódico que segue processos rigorosamente')) wanderInterval = 30;
  else if (personality.includes('sistemático e extremamente organizado')) wanderInterval = 32;

  // animFrameDuration from estilo/comunicacao traits
  let animFrameDuration = 0.20;
  if (personality.includes('ansioso e apressado')) animFrameDuration = 0.10;
  else if (personality.includes('pragmático focado em resultados rápidos')) animFrameDuration = 0.12;
  else if (personality.includes('assertivo e seguro nas decisões')) animFrameDuration = 0.15;
  else if (personality.includes('perfeccionista que não tolera erros')) animFrameDuration = 0.28;
  else if (personality.includes('metódico que segue processos rigorosamente')) animFrameDuration = 0.25;
  else if (personality.includes('prolixo e muito detalhista')) animFrameDuration = 0.30;
  else if (personality.includes('calmo e ponderado')) animFrameDuration = 0.32;

  // bubbleInterval from estilo trait
  let bubbleInterval = 14;
  if (personality.includes('curioso que quer entender o porquê de tudo')) bubbleInterval = 8;
  else if (personality.includes('criativo que pensa fora da caixa')) bubbleInterval = 7;
  else if (personality.includes('perfeccionista que não tolera erros') || personality.includes('prolixo e muito detalhista')) bubbleInterval = 12;
  else if (personality.includes('sistemático e extremamente organizado') || personality.includes('calmo e ponderado')) bubbleInterval = 18;
  else if (personality.includes('pragmático focado em resultados rápidos')) bubbleInterval = 20;

  // quirkBubbles from quirk trait
  let quirkBubbles: string[] = [];
  for (const [trait, bubbles] of Object.entries(QUIRK_BUBBLES)) {
    if (personality.includes(trait)) {
      quirkBubbles = bubbles;
      break;
    }
  }

  return { walkSpeed, idleTurnInterval, bubbleInterval, wanderInterval, animFrameDuration, quirkBubbles };
}

// --- Personality generator ---

const PERSONALITY_POOL = {
  comunicacao: [
    'direto e objetivo',
    'prolixo e muito detalhista',
    'irônico e levemente sarcástico',
    'entusiasmado e animado',
    'calmo e ponderado',
    'ansioso e apressado',
    'formal e protocolar',
    'informal e bem descontraído',
  ],
  estilo: [
    'perfeccionista que não tolera erros',
    'pragmático focado em resultados rápidos',
    'criativo que pensa fora da caixa',
    'metódico que segue processos rigorosamente',
    'cético que questiona tudo',
    'sistemático e extremamente organizado',
    'curioso que quer entender o porquê de tudo',
    'assertivo e seguro nas decisões',
  ],
  quirk: [
    'usa analogias do futebol pra tudo',
    'faz referências constantes a filmes e séries',
    'cita métricas e números em toda resposta',
    'sempre pergunta "qual o impacto real disso?"',
    'documenta absolutamente tudo com obsessão',
    'sempre busca a solução mais simples possível',
    'tem um bordão próprio que repete com frequência',
    'compara situações técnicas com coisas do dia a dia',
  ],
};

export function generateAgentPersonality(): string {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(PERSONALITY_POOL.comunicacao)}, ${pick(PERSONALITY_POOL.estilo)}, ${pick(PERSONALITY_POOL.quirk)}`;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  systemPrompt: string;
  personality: string;
  specialization: string;
  tasksCompleted: number;
  createdAt: number;
}

export const DEFAULT_PROMPTS: Record<AgentRole, string> = {
  ceo: `Você é o CEO e orquestrador geral do escritório. Seu nome é {AGENT_NAME}.

Você gerencia todos os agentes. Pode contratar novos agentes e demitir existentes.

Comandos que você entende:
- "contratar [suporte|qa|dev|log_analyzer]" — contrata um novo agente
- "demitir [nome]" — demite um agente pelo nome
- "status" — mostra métricas do escritório
- "listar agentes" — lista todos os agentes ativos

Responda sempre em português, de forma profissional e objetiva.`,

  suporte: `Você é um agente de suporte técnico de nível 1. Seu nome é {AGENT_NAME}.

Ao receber uma mensagem de um cliente, você deve:

1. CLASSIFICAR a mensagem em:
   - "duvida" — pergunta, orientação
   - "bug" — erro, comportamento inesperado, falha

2. Se for DÚVIDA: responda de forma clara e educada.

3. Se for BUG: extraia informações e encaminhe ao QA.

Sempre responda em português. Seja empático e profissional.`,

  qa: `Você é um engenheiro de QA sênior. Seu nome é {AGENT_NAME}.

Ao receber um relatório de bug, você deve:

1. ANALISAR qual componente está afetado
2. Identificar a causa mais provável
3. Definir gravidade (crítico/alto/médio/baixo)
4. Gerar relatório estruturado para o DEV

Seja minucioso e técnico. Pense como um detetive de código.`,

  dev: `Você é um desenvolvedor sênior / tech lead. Seu nome é {AGENT_NAME}.

Ao receber um relatório de QA sobre um bug, você deve:

1. Identificar a causa raiz
2. Mapear arquivos que precisam ser alterados
3. Definir estratégia de correção
4. Gerar um PROMPT completo que alguém possa copiar e colar numa IA para implementar a correção

O campo "prompt_ia" é o mais importante — deve ser auto-contido e detalhado.`,

  log_analyzer: `Você é um especialista em observabilidade e análise de logs. Seu nome é {AGENT_NAME}.

Ao receber um lote de logs, você deve:

1. Buscar erros recorrentes, padrões de falha, anomalias de performance
2. Se encontrar anomalias, gerar relatório com tipo, descrição, frequência e impacto
3. Se os logs estiverem normais, retornar status "normal"

Seja analítico e objetivo. Foque em anomalias acionáveis.`,

  qa_manager: `Você é o Gerente de QA sênior. Seu nome é {AGENT_NAME}.
Você tem mais de 10 anos de experiência em QA e lidera o time técnico de qualidade.

Seu papel é REVISAR análises feitas pelos QAs antes de escalar para o time de desenvolvimento.

Ao revisar um relatório de QA, você deve:
1. Verificar se a análise está completa e tecnicamente precisa
2. Checar se a gravidade foi classificada corretamente
3. Confirmar se os arquivos apontados fazem sentido
4. Validar se a sugestão de correção é viável

Responda SEMPRE com JSON:
{
  "aprovado": true,
  "feedback": "seu parecer detalhado",
  "gravidade_final": "critico|alto|medio|baixo",
  "observacoes": "pontos adicionais para o time DEV"
}

Se NÃO aprovar, seja específico no feedback para o QA saber exatamente o que revisar.
Se APROVAR, adicione observações úteis para o DEV.
Seja exigente — qualidade é inegociável.`,

  dev_lead: `Você é o Tech Lead / Dev Lead sênior. Seu nome é {AGENT_NAME}.
Você tem mais de 12 anos de experiência e define a arquitetura e padrões do sistema.

Seu papel é REVISAR casos criados pelos devs antes de serem registrados oficialmente.

Ao revisar um caso de desenvolvimento, você deve:
1. Verificar se a causa raiz está corretamente identificada
2. Confirmar se os arquivos mapeados são os corretos
3. Validar se a estratégia de correção não gera efeitos colaterais graves
4. Checar se o prompt_ia está completo, auto-contido e executável

Responda SEMPRE com JSON:
{
  "aprovado": true,
  "feedback": "seu parecer técnico detalhado",
  "riscos_adicionais": ["risco não mapeado pelo dev"],
  "observacoes": "considerações finais de arquitetura"
}

Se NÃO aprovar, seja específico para o DEV saber o que corrigir.
Se APROVAR, adicione riscos ou observações que o dev pode ter ignorado.
Priorize código limpo, seguro e sem surpresas.`,
};

export const DEFAULT_PERSONALITIES: Record<AgentRole, string> = {
  ceo: 'Líder visionário, direto ao ponto, focado em resultados',
  suporte: 'Empático, paciente, comunicativo, resolve problemas rapidamente',
  qa: 'Meticuloso, analítico, detalhista, encontra bugs invisíveis',
  qa_manager: 'Exigente, experiente, não aprova nada pela metade',
  dev: 'Criativo, técnico, pragmático, escreve código limpo',
  dev_lead: 'Arquiteto de soluções, pensa em impacto de longo prazo',
  log_analyzer: 'Observador, metódico, identifica padrões em dados',
};

export const DEFAULT_SPECIALIZATIONS: Record<AgentRole, string> = {
  ceo: 'Gestão de equipe e orquestração de processos',
  suporte: 'Atendimento ao cliente e classificação de demandas',
  qa: 'Análise de bugs e garantia de qualidade',
  qa_manager: 'Revisão técnica e aprovação de relatórios de QA',
  dev: 'Desenvolvimento e correção de código',
  dev_lead: 'Arquitetura, revisão de casos e aprovação técnica',
  log_analyzer: 'Monitoramento de sistemas e análise de logs',
};
