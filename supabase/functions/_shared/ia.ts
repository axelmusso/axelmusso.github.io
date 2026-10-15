// Camada de IA: o ÚNICO lugar do sistema que fala com Anthropic e OpenAI.
// Escolhe o modelo, confere o botão de parada e o teto de gasto, chama, mede tokens e custo,
// grava em execucoes_agente e repete com espera crescente em erro temporário.
// Sem SDK: chamadas HTTP diretas (decisão do projeto: nenhuma biblioteca sem necessidade).

export type Provedor = 'anthropic' | 'openai';
export type Nivel = 'barato' | 'rotina' | 'dificil';

export interface PedidoIA {
  provedor: Provedor;
  papel: string;            // estrategista, cetico, redator, classificador, teste...
  instrucoes: string;       // o "system prompt"
  contexto: string;         // o conteúdo da tarefa
  maxTokens?: number;       // teto de saída desta chamada (inclui o raciocínio do modelo)
  nivel?: Nivel;            // barato | rotina (padrão) | dificil
  jobId?: string | null;
  manual?: boolean;         // pedido feito por uma pessoa na tela: não depende do botão de parada
  memorias?: string[];      // ids de memoria_aprendizados que entraram no contexto (fica no log)
}

export interface RespostaIA {
  texto: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
  duracaoMs: number;
  truncado: boolean;        // bateu no maxTokens antes de terminar
}

export class ErroIA extends Error {
  constructor(public codigo: 'parado' | 'teto' | 'recusa' | 'config' | 'http', mensagem: string) { super(mensagem); }
}

// Modelos por nível. Nomes conferidos na documentação oficial em 15/10/2026.
const MODELOS: Record<Provedor, Record<Nivel, string>> = {
  anthropic: { barato: 'claude-haiku-5-5', rotina: 'claude-sonnet-5-5', dificil: 'claude-opus-5-5' },
  openai: { barato: 'gpt-6-luna', rotina: 'gpt-6.1-sol', dificil: 'gpt-6.1-sol' },
};
const ESFORCO: Record<Nivel, string> = { barato: 'low', rotina: 'medium', dificil: 'high' };

// US$ por milhão de tokens: entrada, saída, leitura de cache. Fonte: páginas oficiais de preço (15/10/2026).
const PRECOS: Record<string, [number, number, number]> = {
  'claude-haiku-5-5': [0.10, 0.50, 0.01],
  'claude-sonnet-5-5': [2, 10, 0.20],
  'claude-opus-5-5': [4, 20, 0.20],
  'claude-sonnet-5': [2, 10, 0.20],
  'claude-opus-5': [5, 25, 0.50],
  'claude-opus-4-8': [5, 25, 0.50],
  'gpt-6-luna': [0.10, 0.50, 0.01],
  'gpt-6.1-sol': [2, 10, 0.10],
  'gpt-6-astra': [10, 50, 1],
  'text-embedding-3-small': [0.02, 0, 0],
};
// Modelo sem preço conhecido (ex.: substituto automático): conta pelo mais caro, para nunca subestimar.
const PRECO_DESCONHECIDO: [number, number, number] = [10, 50, 1];
const preco = (modelo: string) => PRECOS[modelo] ?? PRECO_DESCONHECIDO;

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Acesso ao banco com a chave secreta (só existe no servidor).
export async function banco(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}) {
  const res = await fetch(SB_URL + caminho, {
    method: opcoes.metodo ?? 'GET',
    headers: { apikey: SB_CHAVE, Authorization: 'Bearer ' + SB_CHAVE, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`banco ${res.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

async function registrar(linha: Record<string, unknown>) {
  try { await banco('/rest/v1/execucoes_agente', { metodo: 'POST', corpo: linha }); }
  catch (e) { console.error('Falha ao gravar execucoes_agente', e); }
}

async function conferirLiberacao(p: Pick<PedidoIA, 'manual'>) {
  if (!p.manual) {
    const cfg = await banco('/rest/v1/config?select=valor&chave=eq.sistema_ativo');
    if (cfg?.[0]?.valor !== true) throw new ErroIA('parado', 'Sistema parado (sistema_ativo = false).');
  }
  const [g] = await banco('/rest/v1/rpc/gasto_ia', { metodo: 'POST', corpo: {} });
  const hoje = Number(g.hoje_usd), mes = Number(g.mes_usd), tetoDia = Number(g.teto_diario_usd ?? 0), tetoMes = Number(g.teto_mensal_usd ?? 0);
  if (hoje >= tetoDia) throw new ErroIA('teto', `Teto diário atingido: gasto hoje US$ ${hoje.toFixed(4)} de US$ ${tetoDia.toFixed(2)}.`);
  if (mes >= tetoMes) throw new ErroIA('teto', `Teto mensal atingido: gasto no mês US$ ${mes.toFixed(4)} de US$ ${tetoMes.toFixed(2)}.`);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const temporario = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

// Até 3 tentativas: 1 s, 2 s, 4 s (+ um pouco de aleatório) entre elas, só para erro temporário.
async function comRepeticao(fazer: () => Promise<Response>): Promise<Response> {
  let ultimo: unknown;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa > 0) await esperar(1000 * 2 ** (tentativa - 1) + Math.random() * 300);
    try {
      const res = await fazer();
      if (res.ok || !temporario(res.status)) return res;
      ultimo = new ErroIA('http', `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    } catch (e) { ultimo = e; } // rede ou tempo esgotado
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

// ---------- Anthropic ----------
async function anthropic(modelo: string, p: PedidoIA, nivel: Nivel) {
  const chave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!chave) throw new ErroIA('config', 'Falta o segredo ANTHROPIC_API_KEY no Supabase.');
  // Recusa por segurança com troca automática de modelo: só Sonnet e Opus aceitam (o Haiku não).
  const comSubstituto = modelo !== 'claude-haiku-5-5';
  const corpo: Record<string, unknown> = {
    model: modelo,
    max_tokens: p.maxTokens ?? 4000,
    system: p.instrucoes,
    messages: [{ role: 'user', content: p.contexto }],
    output_config: { effort: ESFORCO[nivel] },
  };
  const cab: Record<string, string> = { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (comSubstituto) { corpo.fallbacks = 'default'; cab['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  const res = await comRepeticao(() => fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: cab, body: JSON.stringify(corpo), signal: AbortSignal.timeout(110_000) }));
  const r = await res.json();
  if (!res.ok) throw new ErroIA('http', `Anthropic ${res.status}: ${r?.error?.message ?? JSON.stringify(r).slice(0, 300)}`);

  // Custo: com troca de modelo, usage.iterations traz cada tentativa; senão, usage do topo.
  type Uso = { model?: string; input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  const partes: Uso[] = Array.isArray(r.usage?.iterations) && r.usage.iterations.length ? r.usage.iterations : [{ ...r.usage, model: r.model }];
  let entrada = 0, saida = 0, custo = 0;
  for (const u of partes) {
    const [pe, ps, pc] = preco(u.model ?? r.model ?? modelo);
    const ent = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    entrada += ent; saida += u.output_tokens ?? 0;
    custo += ((u.input_tokens ?? 0) * pe + (u.cache_creation_input_tokens ?? 0) * pe * 1.25 + (u.cache_read_input_tokens ?? 0) * pc + (u.output_tokens ?? 0) * ps) / 1e6;
  }
  const base = { modelo: r.model ?? modelo, tokensEntrada: entrada, tokensSaida: saida, custoUsd: custo };
  if (r.stop_reason === 'refusal') return { ...base, erro: 'Recusado pelo modelo' + (r.stop_details?.category ? ` (${r.stop_details.category})` : '') };
  const texto = (r.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  return { ...base, texto, truncado: r.stop_reason === 'max_tokens' };
}

// ---------- OpenAI (Responses API) ----------
async function openai(modelo: string, p: PedidoIA, nivel: Nivel) {
  const chave = Deno.env.get('OPENAI_API_KEY');
  if (!chave) throw new ErroIA('config', 'Falta o segredo OPENAI_API_KEY no Supabase.');
  const corpo = {
    model: modelo,
    instructions: p.instrucoes,
    input: p.contexto,
    max_output_tokens: p.maxTokens ?? 4000,
    reasoning: { effort: ESFORCO[nivel] },
    store: false,
  };
  const res = await comRepeticao(() => fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(110_000),
  }));
  const r = await res.json();
  if (!res.ok) throw new ErroIA('http', `OpenAI ${res.status}: ${r?.error?.message ?? JSON.stringify(r).slice(0, 300)}`);
  const u = r.usage ?? {};
  const cache = u.input_tokens_details?.cached_tokens ?? 0;
  const [pe, ps, pc] = preco(r.model && PRECOS[r.model] ? r.model : modelo);
  const base = {
    modelo: r.model ?? modelo, tokensEntrada: u.input_tokens ?? 0, tokensSaida: u.output_tokens ?? 0,
    custoUsd: (((u.input_tokens ?? 0) - cache) * pe + cache * pc + (u.output_tokens ?? 0) * ps) / 1e6,
  };
  let texto = '', recusa = '';
  for (const item of r.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text') texto += c.text;
      if (c.type === 'refusal') recusa += c.refusal ?? 'sem detalhe';
    }
  }
  if (recusa && !texto) return { ...base, erro: 'Recusado pelo modelo: ' + recusa.slice(0, 200) };
  return { ...base, texto, truncado: r.status === 'incomplete' };
}

// ---------- ponto único de entrada ----------
export async function chamarIA(p: PedidoIA): Promise<RespostaIA> {
  const nivel = p.nivel ?? 'rotina';
  const modelo = MODELOS[p.provedor]?.[nivel];
  if (!modelo) throw new ErroIA('config', `Provedor ou nível inválido: ${p.provedor}/${nivel}`);
  const linha = { job_id: p.jobId ?? null, provedor: p.provedor, modelo, papel: p.papel, memorias: p.memorias?.length ? p.memorias : null };
  const inicio = Date.now();

  try { await conferirLiberacao(p); }
  catch (e) {
    // Recusa antes de sair também fica registrada, com o motivo.
    await registrar({ ...linha, sucesso: false, erro: (e as Error).message, duracao_ms: 0 });
    throw e;
  }

  try {
    const r = p.provedor === 'anthropic' ? await anthropic(modelo, p, nivel) : await openai(modelo, p, nivel);
    const duracaoMs = Date.now() - inicio;
    await registrar({
      ...linha, modelo: r.modelo, tokens_entrada: r.tokensEntrada, tokens_saida: r.tokensSaida,
      custo_usd: Number(r.custoUsd.toFixed(6)), duracao_ms: duracaoMs, sucesso: !('erro' in r), erro: 'erro' in r ? r.erro : null,
    });
    if ('erro' in r) throw new ErroIA('recusa', r.erro as string);
    return { texto: r.texto as string, modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida, custoUsd: r.custoUsd, duracaoMs, truncado: !!r.truncado };
  } catch (e) {
    if (e instanceof ErroIA && e.codigo === 'recusa') throw e; // já registrado acima
    await registrar({ ...linha, sucesso: false, erro: (e as Error).message.slice(0, 500), duracao_ms: Date.now() - inicio });
    throw e instanceof ErroIA ? e : new ErroIA('http', (e as Error).message);
  }
}

// ---------- embedding (para a memória) ----------
// Vetor de 1536 números que representa o sentido do texto. Também passa pelo teto e fica no log.
const MODELO_EMBEDDING = 'text-embedding-3-small';
export async function gerarEmbedding(texto: string, papel = 'memoria', manual = true): Promise<number[]> {
  const linha = { provedor: 'openai', modelo: MODELO_EMBEDDING, papel };
  const inicio = Date.now();
  try { await conferirLiberacao({ manual }); }
  catch (e) { await registrar({ ...linha, sucesso: false, erro: (e as Error).message, duracao_ms: 0 }); throw e; }
  const chave = Deno.env.get('OPENAI_API_KEY');
  if (!chave) throw new ErroIA('config', 'Falta o segredo OPENAI_API_KEY no Supabase.');
  try {
    const res = await comRepeticao(() => fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELO_EMBEDDING, input: texto.slice(0, 8000) }), signal: AbortSignal.timeout(30_000),
    }));
    const r = await res.json();
    if (!res.ok) throw new ErroIA('http', `OpenAI ${res.status}: ${r?.error?.message ?? ''}`);
    const tokens = r.usage?.prompt_tokens ?? r.usage?.total_tokens ?? 0;
    await registrar({ ...linha, tokens_entrada: tokens, custo_usd: Number(((tokens * PRECOS[MODELO_EMBEDDING][0]) / 1e6).toFixed(6)), duracao_ms: Date.now() - inicio, sucesso: true });
    return r.data[0].embedding;
  } catch (e) {
    await registrar({ ...linha, sucesso: false, erro: (e as Error).message.slice(0, 500), duracao_ms: Date.now() - inicio });
    throw e instanceof ErroIA ? e : new ErroIA('http', (e as Error).message);
  }
}
