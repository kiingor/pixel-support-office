import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { buildCodeContextForBug, searchCode, getProjectStructure } from './codeAnalysis.js';

// Try multiple .env paths since working dir varies
dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../../.env' });

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-20250514';

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

// Log analyzer: analyze system logs
export async function analyzeLogs(
  agentName: string,
  systemPrompt: string,
  logs: string,
): Promise<{ hasAnomaly: boolean; report?: string }> {
  try {
    const response = await client.messages.create({
      model: MODEL,
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

// Generic chat with any agent
export async function chatWithAgent(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<string> {
  try {
    const messages = [
      ...conversationHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt.replace('{AGENT_NAME}', agentName),
      messages,
    });

    return response.content[0].type === 'text' ? response.content[0].text : 'Sem resposta.';
  } catch (error) {
    console.error('AI chatWithAgent error:', error);
    return 'Desculpe, estou com dificuldades técnicas no momento.';
  }
}
