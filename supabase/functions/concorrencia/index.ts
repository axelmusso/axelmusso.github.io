// Concorrência e mercado (Fase 7): coleta pública dos sites dos concorrentes e análise feita pela dupla do Conselho.
//   { acao: 'coletar', concorrente_id }  → home, produtos, blog, preço, institucional e llms.txt; grava só o que mudou (hash)
//   { acao: 'abrir_analise' }            → monta o dossiê (páginas coletadas + o nosso site) e abre uma análise
//   { acao: 'avancar', analise_id }      → roda o próximo passo: Claude propõe, ChatGPT confere, Claude fecha
// Cada chamada faz UM passo, para caber no tempo da Edge Function. Respeita robots.txt e não entra em área com login.
// Site que recusa robô fica registrado como bloqueado: não disfarçamos o robô de navegador.
import { banco, chamarIA, ErroIA, type Provedor } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';
import { jsonDe, permitido, ROBO } from '../_shared/web.ts';

const q = encodeURIComponent;
class ErroColeta extends Error {}

// ---------- coleta ----------
const MAX_PAGINAS = 10;
const ARQUIVO = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|mp4|mp3)(\?|$)/i;
// Sobra de código no HTML (ex.: "/noticias/${e.slug}"), não é página.
const MOLDE = /%7B|%7D|\$\{|\{\{/;
const TIPOS: [RegExp, string][] = [
  [/pre[cç]o|price|loja|shop|comprar|carrinho/i, 'preco'],
  [/blog|noticia|not%C3%ADcia|artigo|news|post|conteudo|dicas/i, 'blog'],
  [/sobre|empresa|quem-somos|about|historia|institucional/i, 'institucional'],
  [/produt|linha|verniz|tinta|laca|uv|catalog|solu[cç]|aplica|segment|mercado|coating|primer|seladora|resina|corante|solvente|industria/i, 'produto'],
];
// Dentro do produto, o que mais interessa para a Corquímica aparece primeiro.
const INTERESSE = /uv|verniz|plast|laca|metaliz|abs|cosm|moveis|movel|calcad|salto|automot|resina|corante/i;

const limpar = (s?: string | null) => (s ?? '').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

async function baixar(endereco: string, aceita = 'text/html') {
  const url = new URL(endereco);
  if (!(await permitido(url))) throw new ErroColeta('o robots.txt não permite ler esta página');
  let r: Response;
  try { r = await fetch(url, { headers: { 'User-Agent': ROBO, Accept: aceita }, signal: AbortSignal.timeout(15_000), redirect: 'follow' }); }
  catch { throw new ErroColeta('fora do ar ou lento demais'); }
  if ([401, 403, 429, 503, 520].includes(r.status)) throw new ErroColeta(`o site bloqueia robôs (HTTP ${r.status})`);
  if (!r.ok) throw new ErroColeta(`HTTP ${r.status}`);
  return { url: r.url || url.href, tipo: r.headers.get('content-type') ?? '', corpo: (await r.text()).slice(0, 1_500_000) };
}

// Tipos schema.org da página: JSON-LD (inclusive @graph) e microdados.
function tiposSchema(html: string) {
  const tipos = new Set<string>();
  const visitar = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(visitar);
    if (!o || typeof o !== 'object') return;
    const t = (o as Record<string, unknown>)['@type'];
    (Array.isArray(t) ? t : [t]).forEach((x) => typeof x === 'string' && tipos.add(x));
    Object.values(o).forEach((v) => typeof v === 'object' && visitar(v));
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { visitar(JSON.parse(m[1])); } catch { /* JSON-LD inválido */ } }
  for (const m of html.matchAll(/itemtype=["']https?:\/\/schema\.org\/(\w+)/gi)) tipos.add(m[1]);
  return [...tipos];
}

function extrair(html: string, base: string) {
  const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name=["']description["']/i.test(t));
  const texto = html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|section|article|td)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const links = [...new Set([...html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(m[1], base).href; } catch { return ''; } }))];
  return {
    titulo: limpar(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).slice(0, 300),
    h1: limpar(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]).slice(0, 300),
    meta: limpar(meta?.match(/content=["']([^"']*)["']/i)?.[1]).slice(0, 500),
    texto: texto.slice(0, 20_000),
    schema: tiposSchema(html),
    links,
  };
}

async function hash(t: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// URLs do sitemap (e de até 3 sitemaps filhos), só dentro do caminho do concorrente.
async function doSitemap(origem: string, dentro: (u: string) => boolean) {
  const urls: string[] = [];
  for (const nome of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const s = await baixar(origem + nome, 'application/xml,text/xml');
      const locs = [...s.corpo.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
      const filhos = locs.filter((l) => /\.xml(\?|$)/i.test(l)).sort((a, b) => Number(/produ|page|post/i.test(b)) - Number(/produ|page|post/i.test(a))).slice(0, 3);
      urls.push(...locs.filter((l) => !/\.xml(\?|$)/i.test(l)));
      for (const f of filhos) {
        try { urls.push(...[...(await baixar(f, 'application/xml,text/xml')).corpo.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'))); } catch { /* sitemap filho fora do ar */ }
      }
      if (urls.length) break;
    } catch { /* sem sitemap: usa os links da home */ }
  }
  return urls.filter(dentro);
}

const tipoDe = (u: string) => TIPOS.find(([re]) => re.test(new URL(u).pathname))?.[1] ?? 'outra';

// Home + até 5 de produto + 2 de blog + 1 de preço + 1 institucional, sem repetir.
function escolher(home: string, candidatas: string[]) {
  const norm = (u: string) => { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); };
  const vistas = new Set([norm(home)]);
  const unicas = candidatas.filter((u) => !ARQUIVO.test(u) && !MOLDE.test(u)).filter((u) => { const n = norm(u); if (vistas.has(n)) return false; vistas.add(n); return true; });
  const cotas: Record<string, number> = { produto: 5, blog: 2, preco: 1, institucional: 1 };
  const por = (t: string) => unicas.filter((u) => tipoDe(u) === t)
    .sort((a, b) => Number(INTERESSE.test(b)) - Number(INTERESSE.test(a)) || a.length - b.length).slice(0, cotas[t]);
  return [home, ...Object.keys(cotas).flatMap(por)].slice(0, MAX_PAGINAS);
}

// vistos: hashes já gravados nesta coleta. Site montado no navegador devolve a mesma casca em toda página: guarda uma só.
async function gravar(concorrenteId: string, url: string, tipo: string, d: { titulo: string; h1: string; meta: string; texto: string; schema: string[] }, vistos: Set<string>) {
  const h = await hash([d.titulo, d.h1, d.meta, d.texto].join('\n'));
  if (vistos.has(h)) return 'repetida';
  vistos.add(h);
  const [ant] = await banco(`/rest/v1/coletas_concorrente?select=html_hash&concorrente_id=eq.${q(concorrenteId)}&url=eq.${q(url)}&order=coletado_em.desc&limit=1`);
  if (ant?.html_hash === h) return 'igual';
  await banco('/rest/v1/coletas_concorrente', {
    metodo: 'POST',
    corpo: { concorrente_id: concorrenteId, url, tipo, html_hash: h, titulo: d.titulo, h1: d.h1, meta: d.meta, texto: d.texto, dados_estruturados: d.schema, mudou: !!ant },
  });
  return ant ? 'mudou' : 'nova';
}

async function coletar(id: string) {
  const [c] = await banco('/rest/v1/concorrentes?select=*&id=eq.' + q(id));
  if (!c) throw new ErroColeta('Concorrente não encontrado.');
  const partida = new URL(c.site);
  const host = (u: URL) => u.hostname.replace(/^www\./, '');
  const dentro = (s: string) => { try { const u = new URL(s); return host(u) === host(partida) && u.pathname.startsWith(partida.pathname); } catch { return false; } };
  const conta = { paginas: 0, novas: 0, mudaram: 0, iguais: 0, repetidas: 0, erros: [] as string[] };
  const vistos = new Set<string>();
  const somar = (r: string) => { if (r === 'repetida') { conta.repetidas++; return; } conta.paginas++; if (r === 'nova') conta.novas++; else if (r === 'mudou') conta.mudaram++; else conta.iguais++; };
  try {
    const home = await baixar(c.site);
    const dh = extrair(home.corpo, home.url);
    somar(await gravar(id, home.url, 'home', dh, vistos));
    const doMapa = await doSitemap(partida.origin, dentro);
    const lista = escolher(home.url, [...doMapa, ...dh.links.filter(dentro)]).slice(1);
    // Três por vez, para não pesar no site deles nem estourar o tempo da função.
    for (let i = 0; i < lista.length; i += 3) {
      await Promise.all(lista.slice(i, i + 3).map(async (u) => {
        try {
          const p = await baixar(u);
          if (!/html/i.test(p.tipo)) return;
          somar(await gravar(id, p.url, tipoDe(p.url), extrair(p.corpo, p.url), vistos));
        } catch (e) { conta.erros.push(`${u}: ${(e as Error).message}`); }
      }));
    }
    // llms.txt na raiz: o que o concorrente diz às IAs.
    try {
      const l = await baixar(partida.origin + '/llms.txt', 'text/plain');
      if (/text\/plain|markdown/i.test(l.tipo)) {
        somar(await gravar(id, l.url, 'llms', { titulo: 'llms.txt', h1: '', meta: '', texto: l.corpo.slice(0, 20_000), schema: [] }, vistos));
      }
    } catch { /* a maioria não tem llms.txt */ }
    await banco('/rest/v1/concorrentes?id=eq.' + q(id), { metodo: 'PATCH', corpo: { ultima_coleta_em: new Date().toISOString(), ultimo_erro: null } });
  } catch (e) {
    const msg = (e as Error).message;
    await banco('/rest/v1/concorrentes?id=eq.' + q(id), { metodo: 'PATCH', corpo: { ultima_coleta_em: new Date().toISOString(), ultimo_erro: msg.slice(0, 300) } });
    throw new ErroColeta(`${c.nome}: ${msg}`);
  }
  return conta;
}

// ---------- análise ----------
const LIMITE_PAGINA = 1500, LIMITE_NOSSO = 1200, LIMITE_NOSSO_TOTAL = 28_000;

async function montarDossie() {
  const cons = await banco('/rest/v1/concorrentes?select=id,nome,site,ultima_coleta_em,ultimo_erro&ativo=is.true&order=nome');
  const coletas = await banco('/rest/v1/coletas_concorrente?select=concorrente_id,url,tipo,titulo,h1,meta,texto,dados_estruturados,coletado_em&order=coletado_em.desc&limit=3000');
  const vistas = new Set<string>();
  const ultimas = coletas.filter((p: Record<string, string>) => !vistas.has(p.url) && vistas.add(p.url));
  const concorrentes = cons.map((c: Record<string, string>) => {
    const paginas = ultimas.filter((p: Record<string, string>) => p.concorrente_id === c.id).map((p: Record<string, any>) => ({
      url: p.url, tipo: p.tipo, titulo: p.titulo, h1: p.h1, descricao: p.meta, schema: p.dados_estruturados,
      texto: String(p.texto ?? '').slice(0, p.tipo === 'llms' ? 3000 : LIMITE_PAGINA),
    }));
    return { nome: c.nome, site: c.site, coletado_em: c.ultima_coleta_em, ...(paginas.length ? { paginas } : { sem_dados: c.ultimo_erro ?? 'ainda não coletado' }) };
  });
  // O nosso site, pela versão completa para IAs (só português), para saber o que a Corquímica já responde.
  let nosso: { url: string; texto: string }[] = [];
  try {
    const r = await fetch('https://corquimica.com.br/llms-full.txt', { headers: { 'User-Agent': ROBO }, signal: AbortSignal.timeout(15_000) });
    let total = 0;
    nosso = (await r.text()).split(/\n---\n/).map((s) => ({ url: s.match(/^URL:\s*(\S+)/m)?.[1] ?? '', texto: s.replace(/^URL:.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, LIMITE_NOSSO) }))
      .filter((s) => s.url && !/\/(es|en)\//.test(s.url))
      .filter((s) => (total += s.texto.length) <= LIMITE_NOSSO_TOTAL);
  } catch { /* segue sem o nosso site; o dossiê avisa */ }
  return { gerado_em: new Date().toISOString(), concorrentes, nosso_site: nosso.length ? nosso : 'não foi possível ler corquimica.com.br/llms-full.txt' };
}

const CONTEXTO = `A Corquímica fabrica vernizes UV (Base e Top Coat para metalização a vácuo), lacas, tintas para ABS e PS, corantes UV, resinas 3D e solventes, em Estância Velha (RS), desde 1997.
O escopo é PLÁSTICO: metalizadoras de plástico, fita de borda, saltos e solados, enfeites e bijuterias, pés e puxadores de móveis, embalagens de cosméticos, revestimentos PET/PVC, linha branca (bebedouros, chuveiros, sifões), gráficas com verniz UV, peças plásticas automotivas, impressão 3D. Metal só entra em enfeites e bijuterias e em pés e puxadores de móveis (zamac ou aço); galvanização, zincagem e anodização de metal, madeira e construção civil ficam fora.
O comprador costuma procurar fornecedor novo por problema de qualidade ou para homologar um segundo fornecedor.`;

const REGRAS = `${CONTEXTO}
Regras:
1. Use apenas o DOSSIÊ. Todo fato sobre um concorrente ou sobre o site da Corquímica termina com [fonte: URL do dossiê].
2. O que não tiver fonte começa com "HIPÓTESE:". Não temos volume de busca: a demanda é estimativa e precisa dizer em que se baseia.
3. Concorrente sem páginas no dossiê (bloqueou o robô ou não foi coletado): diga que não há dados; não preencha de memória.
4. Lacuna é pergunta que o comprador faz antes de escolher fornecedor e que ninguém responde bem, nem os concorrentes nem a Corquímica.
5. Proposta de conteúdo usa só fatos que a Corquímica pode comprovar; o que faltar (pedido mínimo, prazo, capacidade, certificações, números de teste) vai em "dados_que_faltam". Nunca invente número.
6. Português direto.`;

const FORMATO = `Responda SOMENTE com um JSON neste formato:
{
 "matriz": [{"concorrente": "", "promete": "", "prova": "", "vocabulario": [""], "cobre_bem": [""], "fortes": [""], "fracos": [""], "fontes": ["URL"]}],
 "vocabulario_comum": [{"termo": "", "quem_usa": [""], "corquimica_usa": true}],
 "lacunas": [{"prioridade": 1, "tema": "", "pergunta_do_comprador": "", "por_que_e_lacuna": "", "evidencia": "", "demanda": "alta|media|baixa", "demanda_motivo": "", "facilidade": "alta|media|baixa", "facilidade_motivo": ""}],
 "propostas": [{"lacuna": "", "tipo": "pagina|artigo|faq", "titulo": "", "url_sugerida": "/caminho/", "esboco": ["seção"], "dados_que_faltam": [""], "por_que": ""}]
}
Um item na matriz por concorrente do dossiê. No máximo 8 lacunas, ordenadas por prioridade (demanda e facilidade). De 3 a 6 propostas, cada uma ligada a uma lacuna.`;

type Passo = { nome: string; provedor: Provedor; papel: string; maxTokens: number; pedido: string };
const PASSOS: Passo[] = [
  { nome: 'proposta', provedor: 'anthropic', papel: 'mercado_estrategista', maxTokens: 12000,
    pedido: 'Papel: ESTRATEGISTA. Monte a matriz de forte e fraco por concorrente (o que promete, que prova apresenta, que palavras usa para nomear o produto, o que cobre bem), as lacunas e as propostas de conteúdo para o site da Corquímica.\n' + FORMATO },
  { nome: 'critica', provedor: 'openai', papel: 'mercado_cetico', maxTokens: 5000,
    pedido: 'Papel: CÉTICO. Confira a proposta do estrategista contra o DOSSIÊ: (a) alguma "lacuna" já é respondida por um concorrente ou pelo site da Corquímica? cite a URL; (b) afirmações sem fonte ou com fonte errada; (c) demanda estimada sem base; (d) propostas fora do escopo (plástico) ou que dependem de número inventado. Termine com uma linha por lacuna: "MANTER", "AJUSTAR: motivo" ou "CORTAR: motivo". Não escreva outra análise. Máximo 500 palavras.' },
  { nome: 'final', provedor: 'anthropic', papel: 'mercado_relator', maxTokens: 12000,
    pedido: 'Papel: RELATOR. Reescreva a análise aceitando as críticas válidas do cético (corte ou ajuste o que ele mostrou que não se sustenta; mantenha o que tem fonte).\n' + FORMATO },
];

async function abrirAnalise() {
  const [aberta] = await banco('/rest/v1/analises_mercado?select=id&status=eq.em_andamento&limit=1');
  if (aberta) return { analise_id: aberta.id, ja_aberta: true };
  const dossie = await montarDossie();
  if (!dossie.concorrentes.some((c: Record<string, unknown>) => c.paginas)) throw new ErroColeta('Nenhum concorrente coletado ainda: rode a coleta antes.');
  const [a] = await banco('/rest/v1/analises_mercado', { metodo: 'POST', corpo: { dossie } });
  return { analise_id: a.id };
}

async function avancar(id: string) {
  const [a] = await banco('/rest/v1/analises_mercado?select=*&id=eq.' + q(id));
  if (!a) throw new ErroColeta('Análise não encontrada.');
  if (a.status !== 'em_andamento') return { status: a.status };
  const feitos: { nome: string; texto: string }[] = a.passos ?? [];
  const passo = PASSOS[feitos.length];
  if (!passo) return { status: a.status };
  const anteriores = feitos.map((f) => `[${f.nome.toUpperCase()}]\n${f.texto}`).join('\n\n') || '(primeiro passo)';
  const r = await chamarIA({
    provedor: passo.provedor, papel: passo.papel, nivel: 'rotina', manual: true, maxTokens: passo.maxTokens,
    instrucoes: REGRAS + '\n\n' + passo.pedido,
    contexto: `DOSSIÊ (coletado dos sites públicos):\n${JSON.stringify(a.dossie)}\n\nPASSOS ANTERIORES:\n${anteriores}`,
  });
  const custo = { custo_usd: Number((Number(a.custo_usd) + r.custoUsd).toFixed(6)), tokens: Number(a.tokens) + r.tokensEntrada + r.tokensSaida };
  if (r.truncado) {
    await banco('/rest/v1/analises_mercado?id=eq.' + q(id), { metodo: 'PATCH', corpo: custo });
    throw new ErroColeta(`A resposta do passo "${passo.nome}" foi cortada no limite de tokens. Tente de novo.`);
  }
  const passos = [...feitos, { nome: passo.nome, provedor: passo.provedor, texto: r.texto.trim(), em: new Date().toISOString() }];
  let fim: Record<string, unknown> = {};
  if (passo.nome === 'final') {
    let j: Record<string, any>;
    try { j = jsonDe(r.texto); } catch {
      // Não grava o passo: dá para tentar o fechamento de novo.
      await banco('/rest/v1/analises_mercado?id=eq.' + q(id), { metodo: 'PATCH', corpo: custo });
      throw new ErroColeta('O fechamento não veio em JSON válido. Tente de novo.');
    }
    const matriz = Array.isArray(j.matriz) ? j.matriz : [];
    fim = {
      status: 'fechada', matriz, lacunas: j.lacunas ?? [], propostas: j.propostas ?? [], vocabulario: j.vocabulario_comum ?? [],
      pontos_fortes: matriz.map((m: Record<string, unknown>) => ({ concorrente: m.concorrente, itens: m.fortes ?? [] })),
      pontos_fracos: matriz.map((m: Record<string, unknown>) => ({ concorrente: m.concorrente, itens: m.fracos ?? [] })),
    };
  }
  await banco('/rest/v1/analises_mercado?id=eq.' + q(id), { metodo: 'PATCH', corpo: { passos, ...custo, ...fim } });
  return { status: fim.status ?? 'em_andamento', passo: passo.nome };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador') return json(req, 403, { erro: 'Seu papel não pode usar a análise de concorrência.' });
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }
  try {
    if (c.acao === 'coletar') return json(req, 200, await coletar(String(c.concorrente_id ?? '')));
    if (c.acao === 'abrir_analise') return json(req, 200, await abrirAnalise());
    if (c.acao === 'avancar') return json(req, 200, await avancar(String(c.analise_id ?? '')));
    return json(req, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    if (e instanceof ErroIA) return json(req, e.codigo === 'teto' || e.codigo === 'parado' ? 429 : 502, { erro: e.message, codigo: e.codigo });
    return json(req, e instanceof ErroColeta ? 422 : 400, { erro: (e as Error).message });
  }
});
