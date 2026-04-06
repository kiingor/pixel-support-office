import OpenAI from 'openai';
import dotenv from 'dotenv';
import { buildCodeContextForBug, searchCode, getProjectStructure, syncRepo } from './codeAnalysis.js';

// Try multiple .env paths since working dir varies
dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../../.env' });

// ── Qwen 3.6 Plus via OpenRouter (FREE) — used for ALL tasks ──
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});
const QWEN_MODEL = 'qwen/qwen3.6-plus:free';

// ── Google Gemini — ONLY for multimodal (video/audio transcription) ──
const gemini = new OpenAI({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey: process.env.GOOGLE_API_KEY,
});

/** Helper: Call Qwen via OpenRouter — drop-in for all AI calls */
async function qwenChat(system: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const response = await openrouter.chat.completions.create({
    model: QWEN_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
  });
  return response.choices[0]?.message?.content || '';
}

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
    const text = await qwenChat(
      systemPrompt.replace('{AGENT_NAME}', agentName),
      userMessage,
      1024,
    );

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

    const text = await qwenChat(enhancedPrompt, `Bug Report:\n${bugReport}\n\nBug ID: ${bugId}`, 4096);
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

REGRAS OBRIGATÓRIAS PARA O CASO:

1. BASEIE-SE APENAS no código fonte REAL fornecido abaixo
2. O campo "prompt_ia" deve conter APENAS:
   - O QUE está errado (descrição do erro/comportamento)
   - ONDE no código ocorre (arquivo real + trecho de código real)
   - POR QUE está errado (causa raiz técnica)
3. O "prompt_ia" NÃO PODE conter:
   - Contexto genérico ("Você está trabalhando no SoftcomHub...")
   - Soluções, correções ou código corrigido
   - Seção "Como testar" ou "Como corrigir"
   - Seção "O que precisa mudar"
   - Código hipotético ou inventado
4. Deixe "estrategia_fix", "efeitos_colaterais" e "testes_necessarios" VAZIOS
5. Se o código relevante não está disponível, diga "código não disponível para inspeção"

${codeContext}`;

    const text = await qwenChat(
      enhancedPrompt,
      `Relatório do QA:\n${JSON.stringify(qaReport, null, 2)}\n\nCase ID: ${caseId}`,
      8192,
    );

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

// QA Manager: review QA analysis
export async function reviewQA(
  managerName: string,
  systemPrompt: string,
  qaReport: QAReport,
  bugId: string,
): Promise<QAReviewResult> {
  try {
    const text = await qwenChat(
      systemPrompt.replace('{AGENT_NAME}', managerName),
      `Revise esta análise de QA feita pelo seu time:\n\n${JSON.stringify(qaReport, null, 2)}\n\nBug ID: ${bugId}`,
      2048,
    );
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
    const text = await qwenChat(
      systemPrompt.replace('{AGENT_NAME}', leadName),
      `Revise este caso criado pelo dev:\n\n${JSON.stringify(devCase, null, 2)}\n\nCase ID: ${caseId}`,
      2048,
    );
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

// Log analyzer: analyze system logs
export async function analyzeLogs(
  agentName: string,
  systemPrompt: string,
  logs: string,
): Promise<{ hasAnomaly: boolean; report?: string }> {
  try {
    const text = await qwenChat(
      systemPrompt.replace('{AGENT_NAME}', agentName),
      `Logs recentes:\n${logs}`,
      1024,
    );

    if (text.toLowerCase().includes('"status": "normal"') || text.toLowerCase().includes('normal')) {
      return { hasAnomaly: false };
    }

    return { hasAnomaly: true, report: text };
  } catch (error) {
    console.error('AI analyzeLogs error:', error);
    return { hasAnomaly: false };
  }
}

/**
 * Classify an external error log from SoftcomHub.
 * Returns classification: real_error, known_issue, or false_positive
 * Plus a structured bug report if it's a real error.
 */
export async function classifyExternalLog(
  agentName: string,
  systemPrompt: string,
  logData: {
    log: string;
    tela: string;
    rota: string;
    componente: string;
    usuarios: string[];
    ocorrencias: number;
    primeiraOcorrencia: string;
    ultimaOcorrencia: string;
  },
): Promise<{
  classification: 'real_error' | 'known_issue' | 'false_positive';
  titulo: string;
  descricao: string;
  prioridade: 'alta' | 'media' | 'baixa';
}> {
  const prompt = `Analise este log de erro do sistema SoftcomHub e classifique:

TELA: ${logData.tela}
ROTA: ${logData.rota}
COMPONENTE: ${logData.componente}
OCORRÊNCIAS: ${logData.ocorrencias}x
USUÁRIOS AFETADOS: ${logData.usuarios.join(', ')}
PRIMEIRA OCORRÊNCIA: ${logData.primeiraOcorrencia}
ÚLTIMA OCORRÊNCIA: ${logData.ultimaOcorrencia}

LOG:
${logData.log.slice(0, 1500)}

Classifique como:
- "real_error": Bug real na aplicação que precisa ser corrigido
- "known_issue": Problema conhecido/inofensivo (ResizeObserver, Extension context invalidated, etc.)
- "false_positive": Não é um erro real (warning, info, etc.)

Responda APENAS em JSON:
{"classification": "real_error|known_issue|false_positive", "titulo": "Titulo curto do erro", "descricao": "Descrição técnica breve", "prioridade": "alta|media|baixa"}`;

  try {
    const text = await qwenChat(
      systemPrompt.replace('{AGENT_NAME}', agentName),
      prompt,
      300,
    );

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        classification: parsed.classification || 'false_positive',
        titulo: parsed.titulo || 'Erro não classificado',
        descricao: parsed.descricao || text,
        prioridade: parsed.prioridade || 'media',
      };
    }
    return { classification: 'false_positive', titulo: 'Erro não classificado', descricao: text, prioridade: 'baixa' };
  } catch (error) {
    console.error('AI classifyExternalLog error:', error);
    return { classification: 'false_positive', titulo: 'Erro de classificação', descricao: 'Falha ao classificar', prioridade: 'baixa' };
  }
}

export interface Attachment {
  url: string;
  type: 'image' | 'video' | 'audio' | 'document';
  name: string;
}

/**
 * Describe/transcribe a video or audio file using Google Gemini (supports multimodal).
 * Qwen via OpenRouter does NOT support multimodal, so Gemini is kept for this.
 */
async function describeMediaWithGemini(url: string, type: 'video' | 'audio', name: string): Promise<string> {
  try {
    const prompt = type === 'video'
      ? `Analise este vídeo e descreva em detalhes o que está acontecendo. Se houver texto na tela (erro, interface), transcreva-o. Se houver áudio/fala, transcreva o que foi dito. Responda em português brasileiro.`
      : `Transcreva o áudio completo deste arquivo. Se não conseguir transcrever, descreva o que ouviu (tom, idioma, contexto). Responda em português brasileiro.`;

    const response = await gemini.chat.completions.create({
      model: 'gemini-2.0-flash',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            // @ts-ignore - Gemini OpenAI-compat supports media URLs
            { type: 'image_url', image_url: { url } },
          ] as any,
        },
      ],
    });
    const description = response.choices[0]?.message?.content?.trim();
    if (description) {
      console.log(`[Media] Gemini described ${type} "${name}" (${description.length} chars)`);
      return description;
    }
    return `[${type.toUpperCase()} recebido: ${name} — não foi possível processar o conteúdo]`;
  } catch (error: any) {
    console.warn(`[Media] Gemini failed to describe ${type} "${name}":`, error?.message || error);
    return `[${type.toUpperCase()} recebido: ${name} — URL: ${url} — conteúdo não processado automaticamente]`;
  }
}

/**
 * Support agent chat — uses Qwen via OpenRouter.
 * Injects real SoftcomHub code context and supports multimodal attachments (via Gemini).
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

  // Build enriched user message with media transcriptions
  let enrichedMessage = userMessage;
  const imageAttachments = attachments.filter(a => a.type === 'image');
  const videoAttachments = attachments.filter(a => a.type === 'video');
  const audioAttachments = attachments.filter(a => a.type === 'audio');
  const docAttachments = attachments.filter(a => a.type === 'document');

  for (const vid of videoAttachments) {
    const desc = await describeMediaWithGemini(vid.url, 'video', vid.name);
    enrichedMessage += `\n\n[VIDEO] ${vid.name}:\n${desc}`;
  }
  for (const aud of audioAttachments) {
    const desc = await describeMediaWithGemini(aud.url, 'audio', aud.name);
    enrichedMessage += `\n\n[AUDIO] ${aud.name}:\n${desc}`;
  }
  if (imageAttachments.length > 0) {
    enrichedMessage += `\n\n[IMAGENS RECEBIDAS: ${imageAttachments.map(a => a.name).join(', ')} — análise visual não disponível neste modelo]`;
  }
  if (docAttachments.length > 0) {
    enrichedMessage += `\n\nDocumentos: ${docAttachments.map(a => `${a.name}: ${a.url}`).join(', ')}`;
  }

  // Build messages for OpenRouter (OpenAI-compatible)
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: enhancedSystem },
    ...conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: enrichedMessage },
  ];

  try {
    const response = await openrouter.chat.completions.create({
      model: QWEN_MODEL,
      max_tokens: 1024,
      messages,
    });
    return response.choices[0]?.message?.content || 'Sem resposta.';
  } catch (error: any) {
    console.error('[AI] supportChat error:', error?.message);
    return 'Desculpe, estou com dificuldades técnicas no momento.';
  }
}

// Generic chat with any agent — uses Qwen via OpenRouter
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

  try {
    const response = await openrouter.chat.completions.create({
      model: QWEN_MODEL,
      max_tokens: 2048,
      messages,
    });
    return response.choices[0]?.message?.content || 'Sem resposta.';
  } catch (error: any) {
    console.error('[AI] chatWithAgent error:', error?.message);
    return 'Estou com dificuldades técnicas. Tente novamente em alguns segundos.';
  }
}

// Generate a dynamic bubble text based on agent personality
export async function generateBubble(
  agentName: string,
  agentPersonality: string,
  situation: string,
): Promise<string> {
  const systemPrompt = `Você é ${agentName}, um agente de suporte de TI com a seguinte personalidade: ${agentPersonality}.
Gere UMA frase curta (máx 8 palavras) que este agente pensaria ou falaria em voz alta na situação dada.
Seja fiel à personalidade. Responda APENAS a frase, sem aspas, sem explicação.
Use português brasileiro informal.`;

  try {
    const response = await openrouter.chat.completions.create({
      model: QWEN_MODEL,
      max_tokens: 60,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: situation },
      ],
    });
    return response.choices[0]?.message?.content?.trim() || situation;
  } catch {
    return situation;
  }
}

/**
 * Generate a single skill learning insight after a completed task.
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
    const text = await qwenChat(
      `Você é um sistema de registro de aprendizado de agentes de IA.
Seu único trabalho é extrair UM insight específico e concreto que o agente "${agentName}" (${role}, nível ${levelLabel}) acabou de aprender ao concluir uma tarefa.
O insight deve ser:
- 1 a 2 frases no máximo
- Específico (não genérico como "aprendi a me comunicar melhor")
- Em primeira pessoa do agente (ex: "Aprendi que...", "Percebi que...", "Quando X acontece, Y é a melhor abordagem")
- Acionável — algo que mudará como o agente age no futuro
- Em português brasileiro
Responda APENAS com o texto do insight, sem JSON, sem rodeios.`,
      `Resumo da tarefa concluída:\n${taskSummary}\n\nQual foi o principal aprendizado desta tarefa?`,
      150,
    );

    return text.trim() || '';
  } catch (error) {
    console.error('generateLearningInsight error:', error);
    return '';
  }
}
