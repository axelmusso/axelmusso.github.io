// Conselho: Claude (estrategista) e ChatGPT (cético) discutem um tema com o mesmo dossiê do banco.
// Protocolo fixo: rodada 1 (plano e ataque), rodada 2 (revisão e o que ficou no ar), fechamento (relator).
// Se o cético concordar na rodada 1, vai direto ao fechamento. Teto de tokens por sessão força o fechamento.
// Cada chamada desta função executa UM passo, para caber no tempo da Edge Function e deixar o dono intervir entre passos.
//   { acao: 'abrir', tema, nivel? }      → cria a sessão com o dossiê
//   { acao: 'avancar', sessao_id }       → roda o próximo passo
//   { acao: 'intervir', sessao_id, texto } → orientação do dono, que os dois passam a seguir
// A revisão semanal (worker, papel "sistema") abre e avança sessões sozinha. O relator fecha com até 3 ações
// de tipos fechados, que vão para acoes_propostas e só valem depois que o dono aprova.
import { banco, chamarIA, ErroIA, type Nivel, type Provedor } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';
import { buscarMemoria, gravarAprendizado, idCurto } from '../_shared/memoria.ts';

type Msg = { rodada: number; provedor: string; papel: string; conteudo: string };
type Passo = { rodada: number; provedor: Provedor; papel: 'estrategista' | 'cetico' | 'relator'; pedido: string; maxTokens: number };

const REGRAS = `Você faz parte do Conselho comercial da Corquímica, fabricante de vernizes UV, lacas, tintas para plásticos (ABS/PS) e metais, tintas para piso, corantes e solventes, em Estância Velha (RS), com mais de 100 clientes no Brasil.
Regras do Conselho:
1. Use apenas o DOSSIÊ e a conversa. Toda afirmação com número ou fato termina com [fonte: <bloco do dossiê ou tabela e filtro>]. Para usar um aprendizado da memória, cite [fonte: memória #<id>].
2. O que não tiver fonte começa com "HIPÓTESE:" e não pode virar decisão.
3. Se faltam dados para responder, diga exatamente quais dados faltam e como obtê-los. Não invente números.
4. Orientação do DONO na conversa tem prioridade sobre o plano.
5. Português direto, sem floreio, no máximo 350 palavras.`;

const PASSOS: Passo[] = [
  { rodada: 1, provedor: 'anthropic', papel: 'estrategista', maxTokens: 3000,
    pedido: 'Papel: ESTRATEGISTA. Proponha um plano com no máximo 5 passos concretos para o tema. Para cada passo: o que fazer, quem faz e o número que vai dizer se deu certo.' },
  { rodada: 1, provedor: 'openai', papel: 'cetico', maxTokens: 2500,
    pedido: 'Papel: CÉTICO. Ataque o plano do estrategista: o que não tem evidência no dossiê, o que pode já ter sido tentado, o custo real (tempo, dinheiro, reputação do domínio de e-mail), o que pode dar errado. Não proponha outro plano. Na última linha escreva exatamente "CONCORDA: sim" se o plano se sustenta sem mudança relevante, ou "CONCORDA: não".' },
  { rodada: 2, provedor: 'anthropic', papel: 'estrategista', maxTokens: 3000,
    pedido: 'Papel: ESTRATEGISTA, rodada 2. Responda às críticas que considerar válidas, corte do plano o que não se sustenta e mostre o plano revisado.' },
  { rodada: 2, provedor: 'openai', papel: 'cetico', maxTokens: 2500,
    pedido: 'Papel: CÉTICO, rodada 2. Aponte o que ainda ficou no ar no plano revisado. Na última linha escreva "CONCORDA: sim" ou "CONCORDA: não".' },
  { rodada: 3, provedor: 'anthropic', papel: 'relator', maxTokens: 3500,
    pedido: `Papel: RELATOR. Escreva o fechamento usando só o que se sustentou na conversa, exatamente com estes títulos:
## Decisão recomendada
## Três maiores riscos
## Próximo passo e número que diz se deu certo (com prazo)
## Precisa de aprovação humana
## Hipóteses ainda sem fonte
## Ações propostas
Termine com um bloco \`\`\`json no formato {"acoes":[...]} com no máximo 3 ações que a plataforma aplica sozinha depois que o dono aprovar. Só estes tipos:
- "icp_nota_segmento": parametros {"segmento": id que existe em regras_atuais.segmentos, "nota": 0 a 100}. Muda a nota do segmento; as empresas dele são recalculadas.
- "icp_nota_minima": parametros {"nota": 30 a 90}. Nota mínima para receber e-mail.
- "regra_qualificacao": parametros {"texto": regra objetiva para classificar empresas, até 300 caracteres}. Entra nas instruções do robô que qualifica.
- "regra_redacao": parametros {"texto": regra objetiva para escrever os e-mails, até 300 caracteres}. Entra nas instruções do robô que escreve.
- "conteudo": parametros {"titulo", "url_sugerida", "esboco": [seções]}. Vira proposta de página na tela Conteúdo.
- "tarefa": parametros {"titulo", "descricao"}. Só o que exige uma pessoa de fora do sistema: ligar, decidir preço ou rota, validar conteúdo técnico, fornecer um dado que não está no banco. A descrição diz exatamente o que fazer e qual resposta trazer (a pessoa escreve o resultado ao concluir). NUNCA proponha como tarefa conferir números, reconciliar indicadores, testar amostras ou analisar dados do banco: isso o dossiê ou um novo Conselho resolvem.
Cada ação: {"tipo", "titulo" (curto), "parametros", "por_que" (com [fonte: ...]), "metrica" (uma chave de indicadores.atual que a ação deve mover), "meta" (ex.: "descarte_rascunhos abaixo de 15%"), "medir_em_dias" (14 a 90)}.
Sem evidência suficiente, devolva {"acoes":[]}. Não repita uma ação que o dono recusou (acoes_recentes) sem evidência nova, e respeite o motivo da recusa.` },
];
const RELATOR = PASSOS[4];
const NOMES: Record<string, string> = { estrategista: 'Claude (estrategista)', cetico: 'ChatGPT (cético)', relator: 'Claude (relator)', dono: 'DONO (orientação, tem prioridade)' };

const TIPOS_ACAO = ['icp_nota_segmento', 'icp_nota_minima', 'regra_qualificacao', 'regra_redacao', 'conteudo', 'tarefa'];
const BLOCO_JSON = /```json\s*([\s\S]*?)```/i;
// Ações do fechamento (bloco json). O que não estiver nos tipos fechados é ignorado; parâmetros são conferidos ao aplicar.
function acoesDe(texto: string, metricas: string[]) {
  const m = texto.match(BLOCO_JSON);
  if (!m) return [];
  let v: { acoes?: Record<string, any>[] };
  try { v = JSON.parse(m[1]); } catch { return []; }
  return (Array.isArray(v?.acoes) ? v.acoes : []).filter((a) => TIPOS_ACAO.includes(a?.tipo) && String(a?.titulo ?? '').trim()).slice(0, 3).map((a) => ({
    tipo: a.tipo, titulo: String(a.titulo).trim().slice(0, 200),
    parametros: a.parametros && typeof a.parametros === 'object' ? a.parametros : {},
    por_que: a.por_que ? String(a.por_que).slice(0, 1500) : null,
    metrica: metricas.includes(a.metrica) ? a.metrica : null,
    meta: a.meta ? String(a.meta).slice(0, 300) : null,
    medir_em_dias: Math.min(90, Math.max(14, Number(a.medir_em_dias) || 28)),
  }));
}

const fontesDe = (t: string) => [...new Set([...t.matchAll(/\[fonte:\s*([^\]]+)\]/gi)].map((m) => m[1].trim()))];
const concorda = (t: string) => /CONCORDA:\s*sim/i.test(t.slice(-200));

function proximoPasso(msgs: Msg[], tokens: number, teto: number): { passo: Passo | null; forcado: boolean } {
  const ia = msgs.filter((m) => m.provedor !== 'humano');
  if (ia.some((m) => m.papel === 'relator')) return { passo: null, forcado: false };
  if (tokens >= teto) return { passo: RELATOR, forcado: true };
  if (ia.length === 2 && concorda(ia[1].conteudo)) return { passo: RELATOR, forcado: false }; // concordância rápida: encerra
  return { passo: PASSOS[ia.length] ?? RELATOR, forcado: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador' && quem.papel !== 'sistema') return json(req, 403, { erro: 'Seu papel não pode usar o Conselho.' });

  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }

  try {
    if (c.acao === 'abrir') {
      const tema = String(c.tema ?? '').trim();
      if (tema.length < 3) return json(req, 400, { erro: 'Escreva o tema ou a pergunta.' });
      const nivel = c.nivel === 'dificil' ? 'dificil' : 'rotina';
      // Só o sistema (revisão semanal) abre sessão com outro gatilho; pela tela é sempre "manual".
      const gatilho = quem.papel === 'sistema' ? String(c.gatilho ?? 'sistema').slice(0, 60) : 'manual';
      const dossie = await banco('/rest/v1/rpc/dossie_conselho', { metodo: 'POST', corpo: {} });
      // Aprendizados parecidos com o tema (confiança > 0,6, não refutados) entram no dossiê dos dois.
      const mem = await buscarMemoria(tema, 5, gatilho === 'manual');
      dossie.memoria = {
        fonte: 'memoria_aprendizados parecidos com o tema (confiança > 0,6, não refutados)',
        ids: mem.map((m) => m.id),
        itens: mem.map((m: Record<string, unknown>) => ({ id: idCurto(m.id as string), hipotese: m.hipotese, confianca: m.confianca, status: m.status, visto_vezes: m.visto_vezes, evidencia: m.evidencia })),
      };
      const [s] = await banco('/rest/v1/conselho_sessoes', { metodo: 'POST', corpo: { tema: tema.slice(0, 2000), nivel, dossie, gatilho } });
      return json(req, 200, { sessao_id: s.id });
    }

    const id = String(c.sessao_id ?? '');
    const [s] = await banco('/rest/v1/conselho_sessoes?select=*&id=eq.' + encodeURIComponent(id));
    if (!s) return json(req, 404, { erro: 'Sessão não encontrada.' });
    if (s.status !== 'em_andamento') return json(req, 409, { erro: 'Esta sessão já foi fechada.' });
    const msgs: Msg[] = await banco('/rest/v1/conselho_mensagens?select=rodada,provedor,papel,conteudo&order=criado_em&sessao_id=eq.' + encodeURIComponent(id));

    if (c.acao === 'intervir') {
      const texto = String(c.texto ?? '').trim().slice(0, 2000);
      if (!texto) return json(req, 400, { erro: 'Escreva a orientação.' });
      const rodada = Math.max(1, ...msgs.map((m) => m.rodada));
      await banco('/rest/v1/conselho_mensagens', { metodo: 'POST', corpo: { sessao_id: id, rodada, provedor: 'humano', papel: 'dono', conteudo: texto } });
      return json(req, 200, { ok: true });
    }

    if (c.acao !== 'avancar') return json(req, 400, { erro: 'Ação desconhecida.' });
    const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.teto_tokens_conselho');
    const teto = Number(cfg?.valor ?? 60000);
    const { passo, forcado } = proximoPasso(msgs, Number(s.tokens), teto);
    if (!passo) {
      await banco('/rest/v1/conselho_sessoes?id=eq.' + encodeURIComponent(id), { metodo: 'PATCH', corpo: { status: 'fechada' } });
      return json(req, 200, { status: 'fechada' });
    }

    const conversa = msgs.map((m) => `[Rodada ${m.rodada} · ${NOMES[m.papel] ?? m.papel}]\n${m.conteudo}`).join('\n\n') || '(ainda não há mensagens)';
    const aviso = forcado ? `\n\nATENÇÃO: o teto de ${teto} tokens da sessão foi atingido. Feche agora com o que já se sustentou e registre o que ficou em aberto.` : '';
    const r = await chamarIA({
      provedor: passo.provedor, papel: 'conselho_' + passo.papel, nivel: s.nivel as Nivel, manual: s.gatilho === 'manual', maxTokens: passo.maxTokens,
      memorias: s.dossie.memoria?.ids ?? [],
      instrucoes: REGRAS + '\n\n' + passo.pedido,
      contexto: `TEMA: ${s.tema}\n\nDOSSIÊ (dados do banco em ${s.dossie.gerado_em}):\n${JSON.stringify(s.dossie)}\n\nCONVERSA ATÉ AGORA:\n${conversa}${aviso}\n\nSua vez: ${NOMES[passo.papel]}.`,
    });
    const bruto = r.texto.trim();
    const fechou = passo.papel === 'relator';
    // O bloco json de ações sai do texto (vira linhas em acoes_propostas, mostradas na tela).
    const acoes = fechou ? acoesDe(bruto, Object.keys(s.dossie?.indicadores?.atual ?? {})) : [];
    const conteudo = (fechou ? bruto.replace(BLOCO_JSON, '').trim() : bruto) + (r.truncado ? '\n\n(resposta cortada no limite de tokens)' : '');
    await banco('/rest/v1/conselho_mensagens', {
      metodo: 'POST', corpo: { sessao_id: id, rodada: passo.rodada, provedor: passo.provedor, papel: passo.papel, conteudo, fontes: fontesDe(conteudo) },
    });
    if (acoes.length) await banco('/rest/v1/acoes_propostas', { metodo: 'POST', corpo: acoes.map((a) => ({ ...a, sessao_id: id })) });
    // Decisão fechada vira memória com status "proposta"; volta a ser tocada quando houver resultado medido.
    let aprendizado: string | null = null;
    if (fechou) {
      const secao = (titulo: string) => (conteudo.split(/^##\s*/m).find((x) => x.toLowerCase().startsWith(titulo)) ?? '').replace(/^[^\n]*\n/, '').trim();
      const decisao = secao('decisão') || conteudo;
      try {
        const g = await gravarAprendizado({
          hipotese: ('Decisão do Conselho: ' + decisao.replace(/\s+/g, ' ')).slice(0, 600),
          evidencia: [{ tipo: 'decisao_conselho', sessao_id: id, proximo_passo: secao('próximo passo').slice(0, 800) }],
          status: 'proposta', tags: ['conselho'], origem: 'conselho', origem_id: id,
        }, s.gatilho === 'manual');
        aprendizado = g.id;
      } catch (e) { console.error('Não gravou a decisão na memória:', (e as Error).message); }
    }
    await banco('/rest/v1/conselho_sessoes?id=eq.' + encodeURIComponent(id), {
      metodo: 'PATCH',
      corpo: {
        tokens: Number(s.tokens) + r.tokensEntrada + r.tokensSaida,
        custo_usd: Number((Number(s.custo_usd) + r.custoUsd).toFixed(6)),
        ...(fechou ? { status: 'fechada', decisao: conteudo } : {}),
      },
    });
    return json(req, 200, { status: fechou ? 'fechada' : 'em_andamento', papel: passo.papel, rodada: passo.rodada, forcado, aprendizado, acoes: acoes.length });
  } catch (e) {
    const codigo = e instanceof ErroIA ? e.codigo : 'http';
    // A sessão continua aberta: dá para tentar de novo quando o problema (teto, rede) passar.
    return json(req, codigo === 'teto' || codigo === 'parado' ? 429 : 502, { erro: (e as Error).message, codigo });
  }
});
