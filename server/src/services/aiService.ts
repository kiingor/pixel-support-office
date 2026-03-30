import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { buildCodeContextForBug, searchCode, getProjectStructure, syncRepo } from './codeAnalysis.js';

// Try multiple .env paths since working dir varies
dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../../.env' });

// Claude — skill execution (deep technical tasks)
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 3, // auto-retry on 529 overloaded with exponential backoff
});
const MODEL = 'claude-sonnet-4-6';
const CHEAP_MODEL = 'claude-haiku-4-5-20251001'; // For low-cost fallbacks (bubbles, logs)


// Google Gemini — thinking layer (chat, bubbles, meetings, personality)
const openrouter = new OpenAI({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey: process.env.GOOGLE_API_KEY,
});
const THINKING_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.0-flash-lite';

export interface ClassificationResult {
  classificacao: 'duvida' | 'bug';
  resposta?: string; // For questions
  titulo?: string;
  descricao?: string;
  passos_reproducao?: string[];
  erro_reportado?: string;
  prioridade?: string;
  contexto_cliente?: string;
}

export interface QAReport {
  bug_id: string;
  titulo: string;
  analise_qa: string;
  componente_afetado: string;
  causa_provavel: string;
  arquivos_investigar: string[];
  gravidade: string;
  passos_reproducao: string[];
  sugestao_fix: string;
}

export interface DevCase {
  caso_id: string;
  bug_id: string;
  titulo: string;
  causa_raiz: string;
  arquivos_alterar: Array<{ arquivo: string; alteracao: string }>;
  estrategia_fix: string;
  efeitos_colaterais: string[];
  testes_necessarios: string[];
  prompt_ia: string;
}

export interface QAReviewResult {
  aprovado: boolean;
  feedback: string;
  gravidade_final: string;
  observacoes: string;
}

export interface DevReviewResult {
  aprovado: boolean;
  feedback: string;
  riscos_adicionais: string[];
  observacoes: string;
}

// Support agent: classify ticket and respond
export async function classifyTicket(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
): Promise<ClassificationResult> {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt.replace('{AGENT_NAME}', agentName),
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Try to parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.classificacao === 'bug') {
          return parsed as ClassificationResult;
        }
      } catch { /* not JSON, treat as question response */ }
    }

    // If it's a question response (no JSON), return as duvida
    return {
      classificacao: 'duvida',
      resposta: text,
    };
  } catch (error) {
    console.error('AI classifyTicket error:', error);
    return {
      classificacao: 'duvida',
      resposta: 'Desculpe, estou com dificuldades técnicas. Tente novamente em alguns instantes.',
    };
  }
}

// QA agent: analyze bug report WITH real code context
export async function analyzeQA(
  agentName: string,
  systemPrompt: string,
  bugReport: string,
  bugId: string,
): Promise<QAReport> {
  try {
    // Sync latest SoftcomHub code before analysis
    await syncRepo();

    // Build code context from the actual project
    const codeContext = buildCodeContextForBug(bugReport, 6000);

    const enhancedPrompt = systemPrompt.replace('{AGENT_NAME}', agentName) + `

IMPORTANTE: Você tem acesso ao código fonte real do projeto SoftcomHub (Next.js).
Use o código fornecido abaixo para fazer uma análise precisa do bug.
Identifique os arquivos reais afetados, as linhas de código problemáticas,
e sugira correções baseadas no código real.

${codeContext}`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: enhancedPrompt,
      messages: [{ role: 'user', content: `Bug Report:\n${bugReport}\n\nBug ID: ${bugId}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as QAReport;
      } catch { /* fallback below */ }
    }

    return {
      bug_id: bugId,
      titulo: 'Bug reportado',
      analise_qa: text,
      componente_afetado: 'Desconhecido',
      causa_provavel: 'A ser investigado',
      arquivos_investigar: [],
      gravidade: 'medio',
      passos_reproducao: [],
      sugestao_fix: 'Investigação necessária',
    };
  } catch (error) {
    console.error('AI analyzeQA error:', error);
    return {
      bug_id: bugId,
      titulo: 'Erro na análise',
      analise_qa: 'Falha ao analisar o bug com IA',
      componente_afetado: 'Desconhecido',
      causa_provavel: 'Erro no serviço de IA',
      arquivos_investigar: [],
      gravidade: 'medio',
      passos_reproducao: [],
      sugestao_fix: 'Retry manual',
    };
  }
}

// DEV agent: generate case with implementation prompt + real code
export async function generateDevCase(
  agentName: string,
  systemPrompt: string,
  qaReport: QAReport,
  caseId: string,
): Promise<DevCase> {
  try {
    // Build deeper code context using QA's findings
    const searchTerms = [
      qaReport.componente_afetado,
      ...(qaReport.arquivos_investigar || []),
      qaReport.titulo,
    ].filter(Boolean).join(' ');

    const codeContext = buildCodeContextForBug(searchTerms, 10000);

    const enhancedPrompt = systemPrompt.replace('{AGENT_NAME}', agentName) + `

IMPORTANTE: Você tem acesso ao código fonte REAL do projeto SoftcomHub (Next.js/TypeScript).
Use o código abaixo para gerar um caso PRECISO com arquivos reais, linhas reais, e um prompt_ia
que contenha o código atual e as mudanças exatas necessárias.

O campo "prompt_ia" deve ser um prompt COMPLETO que alguém pode copiar e colar no Claude
para implementar a correção, incluindo trechos do código atual e o que deve ser alterado.

${codeContext}`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: enhancedPrompt,
      messages: [{
        role: 'user',
        content: `Relatório do QA:\n${JSON.stringify(qaReport, null, 2)}\n\nCase ID: ${caseId}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as DevCase;
      } catch { /* fallback below */ }
    }

    return {
      caso_id: caseId,
      bug_id: qaReport.bug_id,
      titulo: qaReport.titulo,
      causa_raiz: 'A ser determinada',
      arquivos_alterar: [],
      estrategia_fix: text,
      efeitos_colaterais: [],
      testes_necessarios: [],
      prompt_ia: text,
    };
  } catch (error) {
    console.error('AI generateDevCase error:', error);
    return {
      caso_id: caseId,
      bug_id: qaReport.bug_id,
      titulo: qaReport.titulo,
      causa_raiz: 'Erro no serviço de IA',
      arquivos_alterar: [],
      estrategia_fix: 'Retry manual',
      efeitos_colaterais: [],
      testes_necessarios: [],
      prompt_ia: 'Falha ao gerar prompt. Tente novamente.',
    };
  }
}

// QA Manager: review QA analysis before escalating to DEV
export async function reviewQA(
  managerName: string,
  systemPrompt: string,
  qaReport: QAReport,
  bugId: string,
): Promise<QAReviewResult> {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt.replace('{AGENT_NAME}', managerName),
      messages: [{
        role: 'user',
        content: `Revise esta análise de QA feita pelo seu time:\n\n${JSON.stringify(qaReport, null, 2)}\n\nBug ID: ${bugId}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as QAReviewResult;
      } catch { /* fallback */ }
    }

    return { aprovado: true, feedback: text, gravidade_final: qaReport.gravidade, observacoes: '' };
  } catch (error) {
    console.error('AI reviewQA error:', error);
    return { aprovado: true, feedback: 'Aprovado sem revisão (erro no serviço)', gravidade_final: qaReport.gravidade, observacoes: '' };
  }
}

// Dev Lead: review dev case before saving to DB
export async function reviewDevCase(
  leadName: string,
  systemPrompt: string,
  devCase: DevCase,
  caseId: string,
): Promise<DevReviewResult> {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt.replace('{AGENT_NAME}', leadName),
      messages: [{
        role: 'user',
        content: `Revise este caso criado pelo dev:\n\n${JSON.stringify(devCase, null, 2)}\n\nCase ID: ${caseId}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as DevReviewResult;
      } catch { /* fallback */ }
    }

    return { aprovado: true, feedback: text, riscos_adicionais: [], observacoes: '' };
  } catch (error) {
    console.error('AI reviewDevCase error:', error);
    return { aprovado: true, feedback: 'Aprovado sem revisão (erro no serviço)', riscos_adicionais: [], observacoes: '' };
  }
}

// Log analyzer: analyze system logs (uses cheap model — runs every 5 min)
export async function analyzeLogs(
  agentName: string,
  systemPrompt: string,
  logs: string,
): Promise<{ hasAnomaly: boolean; report?: string }> {
  try {
    const response = await client.messages.create({
      model: CHEAP_MODEL,
      max_tokens: 1024,
      system: systemPrompt.replace('{AGENT_NAME}', agentName),
      messages: [{ role: 'user', content: `Logs recentes:\n${logs}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    if (text.toLowerCase().includes('"status": "normal"') || text.toLowerCase().includes('normal')) {
      return { hasAnomaly: false };
    }

    return { hasAnomaly: true, report: text };
  } catch (error) {
    console.error('AI analyzeLogs error:', error);
    return { hasAnomaly: false };
  }
}

export interface Attachment {
  url: string;
  type: 'image' | 'video' | 'audio' | 'document';
  name: string;
}

/**
 * Support agent chat — always uses Claude (main model).
 * Injects real SoftcomHub code context and supports image attachments via Claude vision.
 */
export async function supportChat(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  attachments: Attachment[] = [],
): Promise<string> {
  // Inject relevant SoftcomHub code context
  const codeContext = buildCodeContextForBug(userMessage, 3000);
  const enhancedSystem = systemPrompt.replace('{AGENT_NAME}', agentName) + `

## Código Fonte Real do SoftcomHub
Use os trechos abaixo para responder com precisão — entenda o sistema pelo código real, não só pela documentação.
${codeContext}`;

  // Build user message content — text + optional images (Claude vision)
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'url'; url: string } };

  const userContent: ContentBlock[] = [{ type: 'text', text: userMessage }];

  const imageAttachments = attachments.filter(a => a.type === 'image');
  const otherAttachments = attachments.filter(a => a.type !== 'image');

  for (const img of imageAttachments) {
    userContent.push({ type: 'image', source: { type: 'url', url: img.url } });
  }

  if (otherAttachments.length > 0) {
    const fileList = otherAttachments.map(a => `[${a.type.toUpperCase()}] ${a.name}: ${a.url}`).join('\n');
    userContent.push({ type: 'text', text: `\nArquivos enviados:\n${fileList}` });
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: enhancedSystem,
      messages: [
        ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent.length === 1 ? userMessage : userContent },
      ],
    });
    return response.content[0].type === 'text' ? response.content[0].text : 'Sem resposta.';
  } catch (error) {
    console.error('AI supportChat error:', error);
    return 'Desculpe, estou com dificuldades técnicas no momento.';
  }
}

// Generic chat with any agent — uses Gemini (personality/thinking layer), falls back to Claude
export async function chatWithAgent(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt.replace('{AGENT_NAME}', agentName) },
    ...conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  // Try OpenRouter first
  try {
    const response = await openrouter.chat.completions.create({
      model: THINKING_MODEL,
      max_tokens: 1024,
      messages,
    });
    return response.choices[0]?.message?.content || 'Sem resposta.';
  } catch (error: any) {
    const isRateLimit = error?.status === 429;
    console.warn(`[OpenRouter] ${isRateLimit ? 'Rate limited' : 'Error'} — falling back to Claude`);
  }

  // Fallback to Claude Haiku (cheap)
  try {
    const response = await client.messages.create({
      model: CHEAP_MODEL,
      max_tokens: 1024,
      system: systemPrompt.replace('{AGENT_NAME}', agentName),
      messages: conversationHistory.map(m => ({ role: m.role, content: m.content }))
        .concat([{ role: 'user', content: userMessage }]),
    });
    return response.content[0].type === 'text' ? response.content[0].text : 'Sem resposta.';
  } catch (error) {
    console.error('AI chatWithAgent fallback error:', error);
    return 'Desculpe, estou com dificuldades técnicas no momento.';
  }
}

// Generate a dynamic bubble text based on agent personality — uses OpenRouter, falls back to Claude
export async function generateBubble(
  agentName: string,
  agentPersonality: string,
  situation: string,
): Promise<string> {
  const systemPrompt = `Você é ${agentName}, um agente de suporte de TI com a seguinte personalidade: ${agentPersonality}.
Gere UMA frase curta (máx 8 palavras) que este agente pensaria ou falaria em voz alta na situação dada.
Seja fiel à personalidade. Responda APENAS a frase, sem aspas, sem explicação.
Use português brasileiro informal.`;

  // Try OpenRouter first
  try {
    const response = await openrouter.chat.completions.create({
      model: THINKING_MODEL,
      max_tokens: 60,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: situation },
      ],
    });
    return response.choices[0]?.message?.content?.trim() || situation;
  } catch (error: any) {
    console.warn(`[OpenRouter] generateBubble ${error?.status === 429 ? 'rate limited' : 'error'} — falling back to Claude`);
  }

  // Fallback to Claude Haiku (cheap)
  try {
    const response = await client.messages.create({
      model: CHEAP_MODEL,
      max_tokens: 60,
      system: systemPrompt,
      messages: [{ role: 'user', content: situation }],
    });
    return response.content[0].type === 'text' ? response.content[0].text.trim() : situation;
  } catch {
    return situation;
  }
}

/**
 * Generate a single skill learning insight after a completed task.
 * Returns 1-2 sentences describing what the agent "learned" from this specific case.
 * Uses a fast, cheap call — haiku-class token budget.
 */
export async function generateLearningInsight(
  agentName: string,
  role: string,
  taskSummary: string,
  tasksCompleted: number,
): Promise<string> {
  const levelLabel = tasksCompleted < 5 ? 'Júnior'
    : tasksCompleted < 20 ? 'Pleno'
    : tasksCompleted < 50 ? 'Sênior'
    : 'Especialista';

  try {
    const response = await client.messages.create({
      model: CHEAP_MODEL,
      max_tokens: 150,
      system: `Você é um sistema de registro de aprendizado de agentes de IA.
Seu único trabalho é extrair UM insight específico e concreto que o agente "${agentName}" (${role}, nível ${levelLabel}) acabou de aprender ao concluir uma tarefa.
O insight deve ser:
- 1 a 2 frases no máximo
- Específico (não genérico como "aprendi a me comunicar melhor")
- Em primeira pessoa do agente (ex: "Aprendi que...", "Percebi que...", "Quando X acontece, Y é a melhor abordagem")
- Acionável — algo que mudará como o agente age no futuro
- Em português brasileiro
Responda APENAS com o texto do insight, sem JSON, sem rodeios.`,
      messages: [{
        role: 'user',
        content: `Resumo da tarefa concluída:\n${taskSummary}\n\nQual foi o principal aprendizado desta tarefa?`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    return text || '';
  } catch (error) {
    console.error('generateLearningInsight error:', error);
    return '';
  }
}

