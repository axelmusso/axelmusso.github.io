// Prospecção (Fase 6, parte A): descobrir empresas numa página pública, qualificar com nota e motivo, escrever o e-mail.
// Nada sai daqui para o mundo: os e-mails nascem como rascunho e esperam aprovação humana.
//   { acao: 'descobrir_url', url, feira_id? } → lista de expositores/associados vira empresas novas (sem duplicar); com feira_id, marca a origem e a leitura da feira
//   { acao: 'qualificar', empresa_id }   → lê o site público, classifica no segmento (a nota vem dele, em config.icp.segmentos) e acha o gancho
//   { acao: 'redigir', empresa_id }      → escreve o 1º e-mail (prospecção ou retomada de ex-cliente) como rascunho
//   { acao: 'dados_cnpj', empresa_id }   → completa CNAE, cidade, UF e porte pelo cadastro público do CNPJ (base do perfil de cliente)
//   { acao: 'refazer', email_id }        → reescreve um rascunho que o dono reprovou, levando o motivo em conta
//   { acao: 'buscar_ia', segmento, uf }  → pesquisa na web empresas de um segmento prioritário num estado; entram sem nota e vão para a qualificação
import { banco, chamarIA, ErroIA } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';
import { redigirEmail, SOBRE_A_CORQUIMICA } from '../_shared/redacao.ts';
import { melhorContato } from '../_shared/contatos.ts';
import { dominioDe, ErroWeb, jsonDe, lerPagina, type Pagina } from '../_shared/web.ts';

const q = encodeURIComponent;

// Igual à coluna gerada empresas.nome_chave (sem acento, sem pontuação, minúsculo).
const nomeChave = (nome: string) => nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const GENERICOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br', 'icloud.com', 'msn.com'];

// ---------- descobrir: página pública com lista de empresas ----------
async function descobrirUrl(url: string, feiraId?: string) {
  const [feira] = feiraId ? await banco('/rest/v1/feiras?select=id,nome,expositores_importados&id=eq.' + q(feiraId)) : [];
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
    // Já cadastrada (pelo domínio ou pelo nome sem acento e pontuação): não duplica, e cliente ou ex-cliente não vira prospect.
    const chave = nomeChave(e.nome);
    const filtro = dominio ? `or=(dominio.eq.${q(dominio)},nome_chave.eq.${q(chave)})` : 'nome_chave=eq.' + q(chave);
    const ja = await banco(`/rest/v1/empresas?select=id&${filtro}&limit=1`);
    if (ja.length) { repetidas++; continue; }
    if (dominio && (await banco(`/rest/v1/lista_supressao?select=id&dominio=ilike.${q(dominio)}&limit=1`)).length) { repetidas++; continue; } // não contatar
    await banco('/rest/v1/empresas', {
      metodo: 'POST',
      corpo: {
        nome: e.nome.trim().slice(0, 200), site: e.site || null, dominio, cidade: e.cidade || null, uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
        setor: e.segmento || null, origem: feira ? 'feira:' + feira.nome : 'pagina:' + new URL(pag.url).host, fonte_url: pag.url, coletado_em: new Date().toISOString(),
        status: 'prospect', relacao: 'prospect',
      },
    });
    novas++;
  }
  if (feira) await banco('/rest/v1/feiras?id=eq.' + feira.id, { metodo: 'PATCH', corpo: { ultima_leitura: new Date().toISOString(), expositores_importados: (feira.expositores_importados ?? 0) + novas, situacao: 'com_lista', url_expositores: url } });
  return { encontradas: lista.length, novas, repetidas, custo: r.custoUsd };
}

// ---------- qualificar: nota de 0 a 100, motivo e gancho ----------
// Regra do dono (20/10/2026): quem só injeta (ou sopra, extruda) e não pinta, não enverniza nem metaliza a peça não é cliente.
//   acabamento "nao"     → segmento injecao_plastica (fora), em qualquer segmento de peça, salvo impressão 3D
//   acabamento "incerto" → nos segmentos genéricos de peça plástica, vira sem_informacao (abaixo da nota mínima)
// Empresa que cai abaixo da nota mínima: rascunhos esperando aprovação são descartados e a cadência para.
const SEM_ACABAMENTO_NAO_PESA = ['impressao_3d'];
const PRECISA_PROVA = ['injecao_plastica', 'plastico_auto_linha_branca', 'plastico_acabamento'];
type Qualif = { segmento: string; evidencia: string; motivo: string; gancho: string; gancho_fonte: string; perfil?: string; perfil_evidencia?: string; acabamento?: string; acabamento_evidencia?: string; cidade: string; uf: string };
type Segmento = { id: string; nome: string; nota: number; grupo: string; perfil?: string };
async function qualificar(id: string) {
  const [e] = await banco('/rest/v1/empresas?select=*&id=eq.' + q(id));
  if (!e) throw new Error('Empresa não encontrada.');
  const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.icp');
  const icp = cfg.valor;
  // Site público: home e até 3 páginas internas (sobre, produtos, contato).
  const paginas: Pagina[] = [];
  const avisos: string[] = [];
  if (e.site) {
    try {
      const home = await lerPagina(e.site, 15_000);
      paginas.push(home);
      const internas = home.links.filter((l) => dominioDe(l) === dominioDe(home.url) && /sobre|empresa|quem-somos|institucional|produt|servic|linha/i.test(l)).slice(0, 2);
      const contato = home.links.find((l) => dominioDe(l) === dominioDe(home.url) && /contato|fale-?conosco|atendimento/i.test(l));
      for (const l of contato ? [...internas, contato] : internas) { try { paginas.push(await lerPagina(l, 8_000)); } catch { /* página interna opcional */ } }
    } catch (err) { avisos.push((err as Error).message); }
  }
  const segmentos = (icp.segmentos ?? []) as Segmento[];
  // O que o dono já ensinou: regras aprovadas (ações do Conselho) e empresas descartadas, com o motivo.
  const regrasExtras = ((icp.regras_extras ?? []) as { texto: string }[]).map((r) => '- ' + r.texto).join('\n');
  const descartes = (await banco(`/rest/v1/empresas?select=nome,setor,segmento_icp,descarte_motivo&descartada_em=gte.${q(new Date(Date.now() - 90 * 864e5).toISOString())}&descarte_motivo=not.is.null&order=descartada_em.desc&limit=12`))
    .map((d: Record<string, string>) => `- ${d.nome} (${d.setor ?? 's/ setor'}; estava como ${d.segmento_icp ?? '?'}): ${d.descarte_motivo}`).join('\n');
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'prospeccao_qualificar', nivel: 'barato', manual: true, maxTokens: 2500,
    instrucoes: `Você classifica empresas para a prospecção da Corquímica. Responda só com JSON.\n${SOBRE_A_CORQUIMICA}\nA nota vem do SEGMENTO: escolha o segmento que descreve o que a empresa FABRICA, pelo texto do site e pelo setor informado.\nSEGMENTOS (id: descrição):\n${segmentos.map((g) => `${g.id}: ${g.nome}`).join('\n')}\n` +
      'Exemplos dados pelo dono: fita de borda melamínica ou de PVC (CPI Tegus, Plastibordo) = fita_borda; enfeites, correntes e argolas metálicas para calçados e bolsas (Nil Arte) = enfeites_bijuterias; ' +
      'revestimentos, painéis, forros e laminados de PET ou PVC (Lamiecco, Allparts, Plasbil) = revestimento_pet_pvc; bebedouros (Acquabios), chuveiros elétricos (Zagonel, Lorenzetti), sifões e peças plásticas de banheiro = sanitarios_linha_branca, salvo se metalizam as peças (Fiamon, Aplivac) = metalizacao; ' +
      'vidros para móveis (Danglass, Vidrotech) = vidro; fábrica ou loja de móveis = madeira_moveis ou loja_revenda; metalizadora = metalizacao SÓ se metaliza PLÁSTICO (vácuo ou galvanoplastia em plástico); galvanização, zincagem, anodização, cromo duro e tratamento de superfície em METAL = ferragens_metalurgia (regra do dono); CNAE ou nome com "galvano", "zinc", "anodiza" sem prova de plástico = ferragens_metalurgia. ' +
      'puxadores_acessorios (ALVO PRIORITÁRIO, como o cliente AKEO) SÓ para quem fabrica pés de sofá, pés de cama ou puxadores de móveis, em plástico, zamac ou aço; rodízios e sapatas = plastico_tecnico; "acessórios" ou "componentes" para móveis sem prova de que são pés ou puxadores = sem_informacao; atuadores, automação, motores = maquinas_servicos; corrediças, dobradiças e outras ferragens de aço = ferragens_metalurgia. ' +
      'O setor informado pela feira VALE como evidência mesmo sem site: "saltos e solados" = saltos_solados; "acessórios e enfeites" = enfeites_bijuterias; calçadista = calcados_fabricante; injetados para calçados = saltos_solados. TACOS (ponteiras de salto) = plastico_tecnico (o dono descartou a Goldtech). ' +
      'plastico_tecnico também para rodízios, sapatas, núcleos e chapas estruturais (ex. C-Core) e painéis e chapas de acrílico (ex. Al Componenti). ' +
      'Impressão digital UV é TINTA, não verniz: só conte grafica_uv ou plastico_acabamento se o texto mostrar verniz, laca, pintura, metalização ou hot stamping em peça plástica. ' +
      'REGRA DO DONO: a Corquímica só serve a quem dá ACABAMENTO na peça (pinta, aplica verniz ou laca, ou metaliza; só imprimir, serigrafar ou aplicar adesivo não conta). Quem só injeta, sopra, extruda ou termoforma e entrega a peça crua NÃO é cliente: segmento injecao_plastica. Quem injeta E pinta, enverniza ou metaliza = plastico_acabamento (ou metalizacao, se metaliza). ' +
      'Sem site: nome com alumínio/alumi, aço, metal, madeira ou vidro já indica o segmento fora (ex. Alumiconte = ferragens_metalurgia). Sem texto suficiente para decidir, use sem_informacao.' +
      (regrasExtras ? `\nREGRAS APROVADAS PELO DONO (valem sobre os exemplos acima):\n${regrasExtras}` : '') +
      (descartes ? `\nEMPRESAS QUE O DONO DESCARTOU RECENTEMENTE E POR QUÊ (empresa parecida, pelo mesmo motivo, vai para o segmento que reflete o motivo, nunca para um alvo):\n${descartes}` : ''),
    contexto: `EMPRESA: ${JSON.stringify({ nome: e.nome, site: e.site, cidade: e.cidade, uf: e.uf, setor: e.setor, origem: e.origem, relacao: e.relacao })}
${avisos.length ? 'AVISO: ' + avisos.join('; ') + '\n' : ''}${paginas.length ? paginas.map((p) => `--- ${p.url}\n${p.texto}`).join('\n') : '(sem site para ler)'}

Devolva {"segmento":"id da lista","evidencia":"frase curta do texto que mostra o que a empresa fabrica","motivo":"1 a 2 frases sobre a escolha","gancho":"um fato verdadeiro e específico desta empresa visto no texto, útil para abrir um e-mail; vazio se não houver","gancho_fonte":"URL onde viu o gancho","perfil":"verniz | metalizacao | resina3d | geral","perfil_evidencia":"frase do texto que prova o uso; vazio se geral","cidade":"","uf":""}
Perfil: "metalizacao" só se o texto mostrar metalização a vácuo ou galvanoplastia; "verniz" só se mostrar que a empresa aplica verniz, laca ou pintura na própria produção; "resina3d" só se mostrar impressão 3D com resina; sem prova clara, "geral".
Acrescente ao JSON "acabamento" e "acabamento_evidencia":
- "sim": o texto mostra que a própria empresa PINTA, aplica VERNIZ ou LACA, ou METALIZA as peças, ou vende um produto que já é acabamento (fita de borda, revestimento envernizado, gráfica com verniz, metalizadora). Só impressão (serigrafia, tampografia, impressão UV ou digital, adesivo, hot stamping) NÃO basta: sem pintura, verniz ou metalização, é "incerto". Cor no próprio plástico (pigmento, masterbatch, aditivo UV ou proteção UV na resina) NÃO é pintura nem verniz;
- "nao": o texto descreve a produção (injeção, sopro, extrusão, termoformagem, ferramentaria) e não mostra nenhum acabamento próprio, ou diz que o acabamento é feito por terceiros;
- "incerto": o texto não mostra o processo (ou não há site).
"acabamento_evidencia": frase do texto que sustenta a resposta; vazio se incerto.`,
  });
  const v = jsonDe<Qualif>(r.texto);
  // Correção manual do Áxel vale sobre a IA; segmento fora da lista vira "sem informação".
  let seg = e.icp_manual && e.segmento_icp ? e.segmento_icp : segmentos.some((g) => g.id === v.segmento) ? v.segmento : 'sem_informacao';
  const acabamento = ['sim', 'nao', 'incerto'].includes(v.acabamento ?? '') ? v.acabamento! : 'incerto';
  let nota_acabamento = '';
  if (!e.icp_manual && !SEM_ACABAMENTO_NAO_PESA.includes(seg)) {
    if (acabamento === 'sim' && seg === 'injecao_plastica') { nota_acabamento = ' | Injeta e dá acabamento'; seg = 'plastico_acabamento'; }
    else if (acabamento === 'nao' && seg !== 'injecao_plastica') { nota_acabamento = ` | Só fabrica, sem acabamento próprio (era ${seg})`; seg = 'injecao_plastica'; }
    else if (acabamento === 'incerto' && PRECISA_PROVA.includes(seg) && seg !== 'injecao_plastica') { nota_acabamento = ` | Sem prova de pintura, verniz ou metalização (era ${seg})`; seg = 'sem_informacao'; }
  }
  const nomeSeg = segmentos.find((g) => g.id === seg)?.nome ?? seg;
  const uf = (v.uf || '').toUpperCase();
  // Domínio só é gravado se nenhuma outra empresa já usa (o domínio é único no cadastro).
  let dominio = e.dominio;
  const candidato = dominioDe(e.site);
  if (!dominio && candidato && !(await banco(`/rest/v1/empresas?select=id&dominio=eq.${q(candidato)}&limit=1`)).length) dominio = candidato;
  await banco('/rest/v1/empresas?id=eq.' + q(id), {
    metodo: 'PATCH',
    corpo: {
      // A nota sai do segmento (gatilho no banco, tabela em config.icp.segmentos).
      segmento_icp: seg, icp_criterios: null,
      icp_motivo: `${nomeSeg}${e.icp_manual ? ' (definido pelo Áxel)' : ''}: ${(v.evidencia || v.motivo || '').slice(0, 500)}` + nota_acabamento + (v.acabamento_evidencia?.trim() ? ` | Acabamento: ${v.acabamento_evidencia.trim().slice(0, 200)}` : '') + (avisos.length ? ` (${avisos.join('; ')})` : ''),
      acabamento,
      setor: e.setor || nomeSeg, gancho: v.gancho?.trim() || null, gancho_fonte: v.gancho_fonte || null,
      sem_gancho: !v.gancho?.trim(), qualificado_em: new Date().toISOString(),
      // Perfil pelo site (o da base de clientes vale mais); o gatilho do segmento pode impor o dele (fita de borda → verniz).
      ...(e.origem === 'base_clientes' ? {} : { perfil_produto: ['verniz', 'metalizacao', 'resina3d'].includes(v.perfil ?? '') && v.perfil_evidencia?.trim() ? v.perfil : 'geral', perfil_fonte: v.perfil_evidencia?.trim() ? 'site: ' + v.perfil_evidencia.trim().slice(0, 300) : 'sem evidência no site' }),
      cidade: e.cidade || v.cidade || null, uf: e.uf || (/^[A-Z]{2}$/.test(uf) ? uf : null), dominio,
    },
  });
  // E-mails profissionais publicados no site viram contatos (com fonte e data, base legal: legítimo interesse).
  // Com domínio próprio, só e-mails do domínio da empresa: Gmail e afins no site costumam ser de representantes, não da empresa.
  const dom = dominioDe(e.site);
  const achados = [...new Set(paginas.flatMap((p) => p.emails.map((m) => ({ m, url: p.url }))).map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as { m: string; url: string })
    .filter((x) => (dom && !GENERICOS.includes(dom) ? x.m.endsWith('@' + dom) || x.m.endsWith('.' + dom) : true));
  let contatos = 0;
  for (const { m, url } of achados.slice(0, 8)) {
    const ja = await banco(`/rest/v1/contatos?select=id&empresa_id=eq.${q(id)}&email=ilike.${q(m)}&limit=1`);
    if (ja.length) continue;
    await banco('/rest/v1/contatos', { metodo: 'POST', corpo: { empresa_id: id, email: m, origem: 'site', fonte_url: url, coletado_em: new Date().toISOString(), base_legal: 'Legítimo interesse (contato profissional público)', pode_contatar: true } });
    contatos++;
  }
  const [atual] = await banco('/rest/v1/empresas?select=icp_score,relacao&id=eq.' + q(id));
  // Caiu abaixo da nota mínima (prospect): o que esperava aprovação sai da fila e a cadência para.
  let retirados = 0;
  if (atual?.relacao === 'prospect' && (atual.icp_score ?? 0) < Number(icp.nota_minima ?? 50)) {
    const motivo = `Reavaliada: ${nomeSeg} (nota ${atual.icp_score ?? 0}, abaixo de ${icp.nota_minima}).${nota_acabamento}`.slice(0, 500);
    retirados = (await banco(`/rest/v1/emails?empresa_id=eq.${q(id)}&status=eq.rascunho`, { metodo: 'PATCH', corpo: { status: 'descartado', erro: motivo } })).length;
    // Aprovado e ainda não enviado: volta para a aprovação, com o aviso (a decisão é do dono).
    await banco(`/rest/v1/emails?empresa_id=eq.${q(id)}&status=eq.aprovado`, { metodo: 'PATCH', corpo: { status: 'rascunho', aprovado_em: null, erro: motivo + ' Confira antes de aprovar de novo.' } });
    await banco(`/rest/v1/cadencias?empresa_id=eq.${q(id)}&status=in.(ativa,pausada)`, { metodo: 'PATCH', corpo: { status: 'encerrada', motivo_fim: 'reavaliada: fora do perfil', proximo_em: null } });
  }
  return { nota: atual?.icp_score ?? null, segmento: nomeSeg, acabamento, motivo: v.evidencia || v.motivo, gancho: v.gancho || null, contatos, retirados, custo: r.custoUsd };
}

// ---------- buscar com IA: pesquisa na web empresas de um segmento prioritário num estado ----------
// Pedido do dono (23/10/2026): achar as empresas dos segmentos prioritários que a Receita e o Maps não trazem, em todo o foco
// (RS, SC, PR, SP, MG, RJ). A IA só sugere: cada empresa entra sem nota e passa pela qualificação de sempre (leitura do site).
// Teto próprio por dia (config.busca_ia.teto_dia_usd), dentro do teto geral, para não tirar verba dos rascunhos e das respostas.
type Achada = { nome?: string; site?: string; cidade?: string; uf?: string; evidencia?: string; fonte?: string };
const SITE_QUE_NAO_E_DA_EMPRESA = /(mercadolivre|mercadolibre|facebook|instagram|linkedin|google|youtube|wikipedia|cnpj|empresaqui|econodata|solutudo|guiamais|apontador|olx|telelistas|gov\.br|reclameaqui|indeed|infojobs)/i;
async function buscarIa(segmentoId: string, uf: string, jobId: string | null) {
  const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.busca_ia');
  const conf = cfg?.valor ?? {};
  const seg = ((conf.segmentos ?? []) as { id: string; nome: string; termos: string[] }[]).find((s) => s.id === segmentoId);
  if (!seg) throw new Error('Segmento fora da lista da busca com IA (config.busca_ia).');
  const inicioDia = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00').toISOString();
  const gastoHoje = (await banco(`/rest/v1/execucoes_agente?select=custo_usd&papel=eq.prospeccao_busca_ia&criado_em=gte.${q(inicioDia)}`))
    .reduce((s: number, x: { custo_usd: number }) => s + Number(x.custo_usd ?? 0), 0);
  const teto = Number(conf.teto_dia_usd ?? 0.45);
  if (gastoHoje >= teto) return { pulou: `Teto do dia da busca com IA atingido (US$ ${gastoHoje.toFixed(2)} de ${teto.toFixed(2)}).` };
  // Quem já conhecemos neste estado e segmento não volta (a IA procura outras).
  const conhecidas = [...new Set((await banco(`/rest/v1/empresas?select=nome&uf=eq.${q(uf)}&or=(segmento_icp.eq.${q(seg.id)},origem.eq.${q('ia:' + seg.id)})&limit=120`))
    .map((e: { nome: string }) => e.nome))];
  const n = Number(conf.empresas_por_vez ?? 10);
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'prospeccao_busca_ia', nivel: 'rotina', manual: false, maxTokens: 4000, jobId,
    ferramentas: [{ type: 'web_search_20260209', name: 'web_search', max_uses: Number(conf.buscas_por_vez ?? 5), user_location: { type: 'approximate', country: 'BR' } }],
    instrucoes: `Você pesquisa na web empresas brasileiras para a prospecção da Corquímica. ${SOBRE_A_CORQUIMICA}\n` +
      'Faça várias pesquisas diferentes, cada uma com um termo e uma cidade industrial do estado (ex.: \"metalização a vácuo Guarulhos\"), e aproveite todos os fabricantes que aparecerem nos resultados, não só o primeiro. ' +
      'Só liste empresa cujo site oficial apareceu nos resultados da pesquisa; nunca invente nome, site ou cidade. ' +
      'Queremos FABRICANTES que fazem o processo na própria fábrica. Fora: revendas, lojas, distribuidores, representantes, fornecedores de máquinas ou de tintas, e serviços em metal (galvanização, zincagem, cromo duro em aço). ' +
      'No fim, responda só com o JSON pedido.',
    contexto: `SEGMENTO: ${seg.nome}\nESTADO: ${uf}\nTERMOS PARA PESQUISAR (combine com o estado e cidades industriais dele): ${seg.termos.join('; ')}\n` +
      `${conhecidas.length ? 'JÁ CONHECEMOS (não repita):\n' + conhecidas.join('; ') + '\n' : ''}\n` +
      `Ache até ${n} empresas deste segmento com fábrica no estado ${uf}.\n` +
      'Devolva {"empresas":[{"nome":"","site":"https://...","cidade":"","uf":"","evidencia":"frase curta do resultado que mostra o processo (pintura, verniz, metalização, revestimento ou embalagem)","fonte":"URL onde viu"}]}',
  });
  const ini = r.texto.lastIndexOf('{"empresas"');
  const lista = (jsonDe<{ empresas?: Achada[] }>(ini >= 0 ? r.texto.slice(ini) : r.texto).empresas ?? []).filter((e) => e.nome?.trim() && e.site?.trim());
  let novas = 0, repetidas = 0, fora = 0;
  for (const e of lista) {
    const dominio = dominioDe(e.site);
    if (!dominio || SITE_QUE_NAO_E_DA_EMPRESA.test(dominio) || /corqu[ií]mica/i.test(e.nome!)) { fora++; continue; }
    const chave = nomeChave(e.nome!);
    if ((await banco(`/rest/v1/empresas?select=id&or=(dominio.eq.${q(dominio)},nome_chave.eq.${q(chave)})&limit=1`)).length) { repetidas++; continue; }
    if ((await banco(`/rest/v1/lista_supressao?select=id&dominio=ilike.${q(dominio)}&limit=1`)).length) { repetidas++; continue; }
    const ufE = (e.uf ?? '').trim().toUpperCase();
    const [nova] = await banco('/rest/v1/empresas', {
      metodo: 'POST',
      corpo: {
        nome: e.nome!.trim().slice(0, 200), site: e.site!.trim(), dominio, cidade: e.cidade?.trim() || null, uf: /^[A-Z]{2}$/.test(ufE) ? ufE : uf,
        setor: seg.nome, origem: 'ia:' + seg.id, fonte_url: e.fonte || e.site, coletado_em: new Date().toISOString(),
        icp_motivo: e.evidencia ? ('Achada pela busca com IA: ' + e.evidencia).slice(0, 500) : null, status: 'prospect', relacao: 'prospect',
      },
    });
    // A nota vem da qualificação de sempre, que lê o site; entra na fila na frente da qualificação da noite.
    await banco('/rest/v1/rpc/enfileirar', { metodo: 'POST', corpo: { p_tipo: 'qualificar', p_payload: { empresa_id: nova.id }, p_prioridade: 5, p_chave: 'qualificar:' + nova.id, p_origem: 'busca_ia' } });
    novas++;
  }
  return { segmento: seg.nome, uf, encontradas: lista.length, novas, repetidas, fora, custo: r.custoUsd };
}

// ---------- dados do CNPJ: CNAE, cidade, UF e porte (cadastro público da Receita, via BrasilAPI) ----------
// Serve para conhecer o perfil dos clientes (quais CNAEs e cidades) e achar empresas parecidas. Não sobrescreve o que já foi preenchido.
async function dadosCnpj(id: string) {
  const [e] = await banco('/rest/v1/empresas?select=id,cnpj,cidade,uf,porte&id=eq.' + q(id));
  if (!e) throw new Error('Empresa não encontrada.');
  const cnpj = String(e.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('Empresa sem CNPJ válido.');
  const fonte = 'https://brasilapi.com.br/api/cnpj/v1/' + cnpj;
  const r = await fetch(fonte, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Consulta do CNPJ respondeu ${r.status}.`);
  const d = await r.json();
  const fmt = (c: unknown) => String(c ?? '').padStart(7, '0').replace(/^(\d{4})(\d)(\d{2})$/, '$1-$2/$3');
  const cnae = d.cnae_fiscal ? `${fmt(d.cnae_fiscal)} ${d.cnae_fiscal_descricao ?? ''}`.trim() : null;
  const secundarios = (d.cnaes_secundarios ?? []).filter((c: { codigo: number }) => c.codigo).map((c: { codigo: number; descricao: string }) => `${fmt(c.codigo)} ${c.descricao ?? ''}`.trim());
  const cidade = d.municipio ? String(d.municipio).toLowerCase().replace(/(^|\s)\S/g, (x: string) => x.toUpperCase()) : null;
  await banco('/rest/v1/empresas?id=eq.' + q(id), {
    metodo: 'PATCH',
    corpo: { cnae, cnaes_secundarios: secundarios, situacao_cadastral: d.descricao_situacao_cadastral ?? null, cidade: e.cidade || cidade, uf: e.uf || d.uf || null, porte: e.porte || d.porte || null },
  });
  return { cnae, uf: e.uf || d.uf || null, situacao: d.descricao_situacao_cadastral ?? null };
}

// ---------- redigir: 1º e-mail (prospecção) ou 1º da retomada (ex-cliente), como rascunho ----------
async function redigir(id: string, quem: string) {
  const [e] = await banco('/rest/v1/empresas?select=*&id=eq.' + q(id));
  if (!e) throw new Error('Empresa não encontrada.');
  if (e.relacao === 'cliente_ativo') throw new Error('Cliente ativo: não recebe e-mail de prospecção.');
  if (['BAIXADA', 'INAPTA', 'SUSPENSA', 'NULA'].includes(e.situacao_cadastral)) throw new Error(`CNPJ ${e.situacao_cadastral.toLowerCase()} na Receita: empresa fechada, não contata.`);
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
  // Melhor e-mail ainda não tentado (área de decisão antes de caixa geral; nota fiscal por último).
  // Sem e-mail, ou só com caixa fiscal: procura outros no site e no CNPJ antes.
  const contato = await melhorContato(e);
  if (!contato) throw new Error('Nenhum e-mail liberado para esta empresa (procurei no site e no CNPJ; os que existem já foram tentados ou estão na lista de não contatar).');

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

// O motivo do dono pode corrigir o que a empresa faz ou o produto a oferecer (ex.: "na verdade é metalizadora,
// fale de verniz UV"). A correção vale sobre a planilha e sobre o site: sem ela, o perfil antigo (ex.: só resina 3D)
// proíbe o redator de falar do produto que o dono pediu.
const PERFIS_VALIDOS = ['verniz', 'metalizacao', 'resina3d', 'geral'];
async function corrigirClassificacao(e: Record<string, any>, motivo: string, manual: boolean) {
  const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.icp');
  const segmentos = (cfg.valor.segmentos ?? []) as Segmento[];
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'prospeccao_corrigir', nivel: 'barato', manual, maxTokens: 400,
    instrucoes: 'Você lê o motivo que o dono da Corquímica escreveu ao reprovar um e-mail e diz se ele corrige o que a empresa faz (segmento) ou o produto a oferecer (perfil). Responda só com JSON. Se o motivo não fala disso (ex.: tom, tamanho, saudação), devolva null nos dois.',
    contexto: `EMPRESA: ${e.nome} · segmento atual: ${e.segmento_icp ?? '?'} · perfil atual: ${e.perfil_produto ?? '?'}
MOTIVO DO DONO: ${motivo}
SEGMENTOS (id: descrição):\n${segmentos.map((g) => `${g.id}: ${g.nome}`).join('\n')}
PERFIS: verniz (aplica verniz, laca ou pintura na produção), metalizacao (metalizadora: Verniz UV Base e Top Coat), resina3d (só resina para impressão 3D), geral (não se sabe o que usa).
Devolva {"segmento": "id da lista ou null", "perfil": "verniz|metalizacao|resina3d|geral ou null"}`,
  });
  let v: { segmento?: string | null; perfil?: string | null } = {};
  try { v = jsonDe(r.texto); } catch { return e; }
  const corpo: Record<string, unknown> = {};
  if (v.segmento && v.segmento !== e.segmento_icp && segmentos.some((g) => g.id === v.segmento)) {
    Object.assign(corpo, { segmento_icp: v.segmento, icp_manual: true, icp_motivo: ('Corrigido pelo dono: ' + motivo).slice(0, 600) });
  }
  if (v.perfil && v.perfil !== e.perfil_produto && PERFIS_VALIDOS.includes(v.perfil)) {
    Object.assign(corpo, { perfil_produto: v.perfil, perfil_fonte: ('dono: ' + motivo).slice(0, 300) });
  }
  if (!Object.keys(corpo).length) return e;
  const [nova] = await banco('/rest/v1/empresas?id=eq.' + q(e.id), { metodo: 'PATCH', corpo });
  await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: e.id, tipo: 'nota', direcao: 'interna', assunto: 'Classificação corrigida pelo dono', conteudo: `Segmento ${e.segmento_icp} → ${nova.segmento_icp}; perfil ${e.perfil_produto} → ${nova.perfil_produto}. Motivo: ${motivo}`.slice(0, 1000), agente_id: 'redator' } });
  return nova;
}

// ---------- refazer: o dono reprovou o texto (refazer) ou o endereço (contato), não a empresa ----------
async function refazer(emailId: string, manual: boolean) {
  const [m] = await banco('/rest/v1/emails?select=*,empresas(*),contatos(*),cadencias(tipo)&id=eq.' + q(emailId));
  if (!m) throw new Error('Rascunho não encontrado.');
  if (m.descarte_tipo !== 'refazer' && m.descarte_tipo !== 'contato') throw new Error('Este rascunho não foi marcado para refazer.');
  const [ja] = await banco(`/rest/v1/emails?select=id&refeito_de=eq.${q(emailId)}&limit=1`);
  if (ja) return { ja_refeito: true, email_id: ja.id };
  let e = m.empresas;
  if (e.status === 'descartada' || e.relacao === 'cliente_ativo') throw new Error('Empresa descartada ou cliente ativo: não reescrevo.');
  if ((await banco(`/rest/v1/emails?select=id&empresa_id=eq.${q(e.id)}&status=in.(rascunho,aprovado)&limit=1`)).length) throw new Error('Já existe outro rascunho esperando aprovação para esta empresa.');
  if (m.descarte_tipo === 'contato') {
    // Endereço reprovado: outro e-mail da empresa (o informado pelo dono primeiro; senão site e CNPJ), e um 1º e-mail novo para ele.
    const novo = await melhorContato(e);
    if (!novo) {
      await banco('/rest/v1/emails?id=eq.' + q(m.id), { metodo: 'PATCH', corpo: { erro: 'Não refeito: nenhum outro e-mail que combine com a empresa (procurei no site e no CNPJ).' } });
      return { sem_contato: true };
    }
    const tipoNovo = e.relacao === 'ex_cliente' ? 'retomada' : 'prospeccao';
    const r = await redigirEmail({ empresa: e, contato: novo, passo: 1, tipo: tipoNovo, manual });
    if (r.sem_gancho) {
      await banco('/rest/v1/emails?id=eq.' + q(m.id), { metodo: 'PATCH', corpo: { erro: ('Não refeito: ' + r.motivo).slice(0, 500) } });
      return { sem_gancho: true, motivo: r.motivo, custo: r.custo };
    }
    const [n] = await banco('/rest/v1/emails', {
      metodo: 'POST',
      corpo: { empresa_id: e.id, contato_id: novo.id, para: novo.email, passo: 1, angulo: r.angulo, assunto: r.assunto, corpo: r.corpo, status: 'rascunho', memorias: r.memorias, refeito_de: m.id, erro: r.revisar.length ? 'Revisar: ' + r.revisar.join('; ') : null },
    });
    await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: e.id, contato_id: novo.id, tipo: 'email', direcao: 'interna', assunto: 'Novo contato após endereço reprovado', conteudo: `${m.para} reprovado pelo dono; rascunho novo para ${novo.email} (fonte: ${novo.origem ?? 'sem fonte'}).`, agente_id: 'redator' } });
    return { email_id: n.id, para: novo.email, assunto: r.assunto, revisar: r.revisar, custo: r.custo };
  }
  const contato = m.contatos;
  if (!contato?.email || !contato.pode_contatar) throw new Error('O contato deste rascunho não pode mais receber e-mail.');
  // O motivo pode corrigir segmento e perfil de produto; a correção vale antes de reescrever.
  e = await corrigirClassificacao(e, m.descarte_motivo ?? '', manual);
  // Indicação: recupera quem indicou pelo texto reprovado ("por indicação de Fulano").
  const indicadoPor = m.angulo === 'indicacao' ? (String(m.corpo).match(/indica[çc][ãa]o d[aeo]s?\s+([^.,;!?\n]{2,40})/i)?.[1]?.trim() ?? 'a equipe de vocês') : undefined;
  const tipo = m.cadencias?.tipo ?? (e.relacao === 'ex_cliente' ? 'retomada' : 'prospeccao');
  const r = await redigirEmail({ empresa: e, contato, passo: m.passo, tipo, manual, indicadoPor, ajuste: { assunto: m.assunto, corpo: m.corpo, motivo: m.descarte_motivo ?? '' } });
  if (r.sem_gancho) {
    // Sem algo honesto e novo para dizer: registra e não tenta de novo (o worker só refaz rascunho sem erro).
    await banco('/rest/v1/emails?id=eq.' + q(m.id), { metodo: 'PATCH', corpo: { erro: ('Não refeito: ' + r.motivo).slice(0, 500) } });
    return { sem_gancho: true, motivo: r.motivo, custo: r.custo };
  }
  const [novo] = await banco('/rest/v1/emails', {
    metodo: 'POST',
    corpo: { cadencia_id: m.cadencia_id, empresa_id: e.id, contato_id: contato.id, para: contato.email, passo: m.passo, angulo: m.angulo === 'indicacao' ? 'indicacao' : r.angulo, assunto: r.assunto, corpo: r.corpo, status: 'rascunho', memorias: r.memorias, refeito_de: m.id, erro: r.revisar.length ? 'Revisar: ' + r.revisar.join('; ') : null },
  });
  await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: e.id, contato_id: contato.id, tipo: 'email', direcao: 'interna', assunto: 'Rascunho refeito: ' + r.assunto, conteudo: 'Reescrito com o motivo do dono: ' + (m.descarte_motivo ?? ''), agente_id: 'redator' } });
  return { email_id: novo.id, assunto: r.assunto, revisar: r.revisar, custo: r.custo };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador' && quem.papel !== 'sistema') return json(req, 403, { erro: 'Seu papel não pode usar a prospecção.' });
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }
  try {
    if (c.acao === 'descobrir_url') return json(req, 200, await descobrirUrl(String(c.url ?? ''), c.feira_id ? String(c.feira_id) : undefined));
    if (c.acao === 'qualificar') return json(req, 200, await qualificar(String(c.empresa_id ?? '')));
    if (c.acao === 'buscar_ia') return json(req, 200, await buscarIa(String(c.segmento ?? ''), String(c.uf ?? '').toUpperCase(), null));
    if (c.acao === 'dados_cnpj') return json(req, 200, await dadosCnpj(String(c.empresa_id ?? '')));
    if (c.acao === 'redigir') return json(req, 200, await redigir(String(c.empresa_id ?? ''), quem.id ?? ''));
    if (c.acao === 'refazer') return json(req, 200, await refazer(String(c.email_id ?? ''), quem.papel !== 'sistema'));
    return json(req, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    if (e instanceof ErroWeb) return json(req, 422, { erro: e.message });
    const codigo = e instanceof ErroIA ? e.codigo : 'http';
    return json(req, codigo === 'teto' || codigo === 'parado' ? 429 : e instanceof ErroIA ? 502 : 400, { erro: (e as Error).message, codigo });
  }
});
