// Prospecção (Fase 6, parte A): descobrir empresas numa página pública, qualificar com nota e motivo, escrever o e-mail.
// Nada sai daqui para o mundo: os e-mails nascem como rascunho e esperam aprovação humana.
//   { acao: 'descobrir_url', url }       → lista de expositores/associados vira empresas novas (sem duplicar)
//   { acao: 'qualificar', empresa_id }   → lê o site público, dá a nota de 0 a 100 com motivo e acha o gancho
//   { acao: 'redigir', empresa_id }      → escreve o 1º e-mail (prospecção ou retomada de ex-cliente) como rascunho
import { banco, chamarIA, ErroIA } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';
import { redigirEmail, SOBRE_A_CORQUIMICA } from '../_shared/redacao.ts';
import { dominioDe, ErroWeb, jsonDe, lerPagina, type Pagina } from '../_shared/web.ts';

const q = encodeURIComponent;

const GENERICOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br', 'icloud.com', 'msn.com'];

async function suprimido(email: string) {
  const dom = email.split('@')[1]?.toLowerCase() ?? '';
  const r = await banco(`/rest/v1/lista_supressao?select=id&or=(email.ilike.${q(email)},and(email.is.null,dominio.ilike.${q(dom)}))&limit=1`);
  return r.length > 0;
}

// ---------- descobrir: página pública com lista de empresas ----------
async function descobrirUrl(url: string) {
  const pag = await lerPagina(url, 40_000);
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'prospeccao_descobrir', nivel: 'barato', manual: true, maxTokens: 6000,
    instrucoes: 'Você extrai empresas de páginas públicas (listas de expositores de feira, associados, catálogos). Responda só com JSON. Não invente: liste apenas empresas que aparecem no texto. Não inclua o dono da página (organizador, associação) nem a Corquímica.',
    contexto: `Página: ${pag.url}\nTítulo: ${pag.titulo}\n\nTEXTO:\n${pag.texto}\n\nLINKS:\n${pag.links.slice(0, 200).join('\n')}\n\nDevolva {"empresas":[{"nome":"","site":"","cidade":"","uf":"","segmento":""}]} com os campos que a página mostrar (deixe vazio o que não aparecer). Máximo 150 empresas.`,
  });
  const lista = (jsonDe<{ empresas: Record<string, string>[] }>(r.texto).empresas ?? []).filter((e) => e.nome && e.nome.trim().length > 1);
  let novas = 0, repetidas = 0;
  const ignorar = new Set(['corquimica.com.br', dominioDe(pag.url)]); // a própria Corquímica e o dono da página
  for (const e of lista) {
    const dominio = dominioDe(e.site);
    if ((dominio && ignorar.has(dominio)) || /corqu[ií]mica/i.test(e.nome)) { repetidas++; continue; }
    const uf = (e.uf ?? '').trim().toUpperCase();
    const filtro = dominio ? 'dominio=eq.' + q(dominio) : 'nome=ilike.' + q(e.nome.trim());
    const ja = await banco(`/rest/v1/empresas?select=id&${filtro}&limit=1`);
    if (ja.length) { repetidas++; continue; }
    if (dominio && (await banco(`/rest/v1/lista_supressao?select=id&dominio=ilike.${q(dominio)}&limit=1`)).length) { repetidas++; continue; } // não contatar
    await banco('/rest/v1/empresas', {
      metodo: 'POST',
      corpo: {
        nome: e.nome.trim().slice(0, 200), site: e.site || null, dominio, cidade: e.cidade || null, uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
        setor: e.segmento || null, origem: 'pagina:' + new URL(pag.url).host, fonte_url: pag.url, coletado_em: new Date().toISOString(),
        status: 'prospect', relacao: 'prospect',
      },
    });
    novas++;
  }
  return { encontradas: lista.length, novas, repetidas, custo: r.custoUsd };
}

// ---------- qualificar: nota de 0 a 100, motivo e gancho ----------
type Qualif = { criterios: Record<string, number>; motivo: string; segmento: string; gancho: string; gancho_fonte: string; cidade: string; uf: string };
async function qualificar(id: string) {
  const [e] = await banco('/rest/v1/empresas?select=*&id=eq.' + q(id));
  if (!e) throw new Error('Empresa não encontrada.');
  const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.icp');
  const icp = cfg.valor;
  // Site público: home e até 2 páginas internas sobre a empresa ou produtos.
  const paginas: Pagina[] = [];
  const avisos: string[] = [];
  if (e.site) {
    try {
      const home = await lerPagina(e.site, 15_000);
      paginas.push(home);
      const internas = home.links.filter((l) => dominioDe(l) === dominioDe(home.url) && /sobre|empresa|quem-somos|institucional|produt|servic|linha/i.test(l)).slice(0, 2);
      for (const l of internas) { try { paginas.push(await lerPagina(l, 8_000)); } catch { /* página interna opcional */ } }
    } catch (err) { avisos.push((err as Error).message); }
  }
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'prospeccao_qualificar', nivel: 'barato', manual: true, maxTokens: 2500,
    instrucoes: `Você qualifica empresas para a prospecção da Corquímica. Responda só com JSON.\n${SOBRE_A_CORQUIMICA}\nCritérios e pontos máximos:\n${JSON.stringify(icp.criterios)}\nDê para cada critério um número entre 0 e o máximo, só com base no que está no texto. Sem evidência, 0.`,
    contexto: `EMPRESA: ${JSON.stringify({ nome: e.nome, site: e.site, cidade: e.cidade, uf: e.uf, setor: e.setor, origem: e.origem, relacao: e.relacao })}
${avisos.length ? 'AVISO: ' + avisos.join('; ') + '\n' : ''}${paginas.length ? paginas.map((p) => `--- ${p.url}\n${p.texto}`).join('\n') : '(sem site para ler)'}

Devolva {"criterios":{"setor":0,"processo":0,"regiao":0,"porte":0,"momento":0},"motivo":"2 a 3 frases dizendo por que deu a nota, citando o que viu","segmento":"um dos segmentos alvo ou outro","gancho":"um fato verdadeiro e específico desta empresa visto no texto, útil para abrir um e-mail; vazio se não houver","gancho_fonte":"URL onde viu o gancho","cidade":"","uf":""}`,
  });
  const v = jsonDe<Qualif>(r.texto);
  const maximos = Object.fromEntries((icp.criterios as { id: string; pontos: number }[]).map((c) => [c.id, c.pontos]));
  const crit = Object.fromEntries(Object.keys(maximos).map((k) => [k, Math.max(0, Math.min(maximos[k], Math.round(Number(v.criterios?.[k]) || 0)))]));
  const nota = Object.values(crit).reduce((s, n) => s + n, 0);
  const uf = (v.uf || '').toUpperCase();
  // Domínio só é gravado se nenhuma outra empresa já usa (o domínio é único no cadastro).
  let dominio = e.dominio;
  const candidato = dominioDe(e.site);
  if (!dominio && candidato && !(await banco(`/rest/v1/empresas?select=id&dominio=eq.${q(candidato)}&limit=1`)).length) dominio = candidato;
  await banco('/rest/v1/empresas?id=eq.' + q(id), {
    metodo: 'PATCH',
    corpo: {
      icp_score: nota, icp_criterios: crit, icp_motivo: (v.motivo || '').slice(0, 1000) + (avisos.length ? ` (${avisos.join('; ')})` : ''),
      setor: e.setor || v.segmento || null, gancho: v.gancho?.trim() || null, gancho_fonte: v.gancho_fonte || null,
      sem_gancho: !v.gancho?.trim(), qualificado_em: new Date().toISOString(),
      cidade: e.cidade || v.cidade || null, uf: e.uf || (/^[A-Z]{2}$/.test(uf) ? uf : null), dominio,
    },
  });
  // E-mails profissionais publicados no site viram contatos (com fonte e data, base legal: legítimo interesse).
  const dom = dominioDe(e.site);
  const achados = [...new Set(paginas.flatMap((p) => p.emails.map((m) => ({ m, url: p.url }))).map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as { m: string; url: string })
    .filter((x) => !dom || x.m.endsWith('@' + dom) || GENERICOS.includes(x.m.split('@')[1]));
  let contatos = 0;
  for (const { m, url } of achados.slice(0, 5)) {
    const ja = await banco(`/rest/v1/contatos?select=id&empresa_id=eq.${q(id)}&email=ilike.${q(m)}&limit=1`);
    if (ja.length) continue;
    await banco('/rest/v1/contatos', { metodo: 'POST', corpo: { empresa_id: id, email: m, origem: 'site', fonte_url: url, coletado_em: new Date().toISOString(), base_legal: 'Legítimo interesse (contato profissional público)', pode_contatar: true } });
    contatos++;
  }
  return { nota, criterios: crit, motivo: v.motivo, gancho: v.gancho || null, contatos, custo: r.custoUsd };
}

// ---------- redigir: 1º e-mail (prospecção) ou 1º da retomada (ex-cliente), como rascunho ----------
async function redigir(id: string, quem: string) {
  const [e] = await banco('/rest/v1/empresas?select=*&id=eq.' + q(id));
  if (!e) throw new Error('Empresa não encontrada.');
  if (e.relacao === 'cliente_ativo') throw new Error('Cliente ativo: não recebe e-mail de prospecção.');
  const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.icp');
  const retomada = e.relacao === 'ex_cliente';
  if (!retomada) {
    if (e.icp_score == null) throw new Error('Qualifique a empresa antes de escrever.');
    if (e.icp_score < cfg.valor.nota_minima) throw new Error(`Nota ${e.icp_score} abaixo do mínimo (${cfg.valor.nota_minima}): não contata.`);
    if (e.sem_gancho) throw new Error('Empresa marcada "sem gancho": não há nada específico e verdadeiro para dizer.');
  }
  const pend = await banco(`/rest/v1/emails?select=id&empresa_id=eq.${q(id)}&status=in.(rascunho,aprovado)&limit=1`);
  if (pend.length) throw new Error('Já existe um rascunho esperando aprovação para esta empresa.');
  const ativa = await banco(`/rest/v1/cadencias?select=id&empresa_id=eq.${q(id)}&status=in.(ativa,pausada)&limit=1`);
  if (ativa.length) throw new Error('Esta empresa já está numa cadência; os próximos e-mails saem por ela.');
  // Contato com e-mail, liberado e fora da lista de supressão.
  const contatos = await banco(`/rest/v1/contatos?select=id,nome,cargo,email&empresa_id=eq.${q(id)}&pode_contatar=is.true&email=not.is.null`);
  let contato = null;
  for (const c of contatos) if (!(await suprimido(c.email))) { contato = c; break; }
  if (!contato) throw new Error('Nenhum e-mail liberado para esta empresa (sem contato ou todos na lista de não contatar).');

  const r = await redigirEmail({ empresa: e, contato, passo: 1, tipo: retomada ? 'retomada' : 'prospeccao', manual: true });
  if (r.sem_gancho) {
    await banco('/rest/v1/empresas?id=eq.' + q(id), { metodo: 'PATCH', corpo: { sem_gancho: true, icp_motivo: (e.icp_motivo ?? '') + ' | Sem gancho: ' + r.motivo } });
    return { sem_gancho: true, motivo: r.motivo, custo: r.custo };
  }
  const [em] = await banco('/rest/v1/emails', {
    metodo: 'POST',
    corpo: { empresa_id: id, contato_id: contato.id, para: contato.email, passo: 1, angulo: r.angulo, assunto: r.assunto, corpo: r.corpo, status: 'rascunho', memorias: r.memorias, erro: r.revisar.length ? 'Revisar: ' + r.revisar.join('; ') : null },
  });
  await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: id, contato_id: contato.id, tipo: 'email', direcao: 'interna', assunto: 'Rascunho criado: ' + r.assunto, conteudo: `Rascunho do ${retomada ? '1º e-mail de retomada' : '1º e-mail'} aguardando aprovação.`, agente_id: 'redator' } });
  return { email_id: em.id, assunto: r.assunto, revisar: r.revisar, custo: r.custo, pedido_por: quem };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador') return json(req, 403, { erro: 'Seu papel não pode usar a prospecção.' });
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }
  try {
    if (c.acao === 'descobrir_url') return json(req, 200, await descobrirUrl(String(c.url ?? '')));
    if (c.acao === 'qualificar') return json(req, 200, await qualificar(String(c.empresa_id ?? '')));
    if (c.acao === 'redigir') return json(req, 200, await redigir(String(c.empresa_id ?? ''), quem.id));
    return json(req, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    if (e instanceof ErroWeb) return json(req, 422, { erro: e.message });
    const codigo = e instanceof ErroIA ? e.codigo : 'http';
    return json(req, codigo === 'teto' || codigo === 'parado' ? 429 : e instanceof ErroIA ? 502 : 400, { erro: (e as Error).message, codigo });
  }
});
