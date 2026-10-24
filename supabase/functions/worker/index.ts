// Worker (Fase 9): roda os jobs da fila. Chamado pelo pg_cron a cada 5 minutos, com o segredo do Vault.
// A cada job: confere o botão de parada e o teto de gasto, pega o próximo job vencido (travado no banco),
// executa com limite de tempo e marca feito, ou devolve à fila com espera crescente (até 3 tentativas).
// As rotinas fixas só põem outros jobs na fila; o trabalho de verdade é feito pelas funções de sempre,
// chamadas aqui como "sistema" (envio, prospecção, Maps, memória, concorrência).
// Nada sai sem aprovação humana: o envio só manda e-mails que alguém aprovou.
// Ciclo autônomo: toda segunda, depois da coleta dos concorrentes, a revisão semanal aprende com os descartes do dono
// e com os números, compara os indicadores com as 4 semanas anteriores e, havendo sinal, abre o Conselho sozinha.
// As ações que o Conselho propõe esperam o dono; as aprovadas são medidas depois e o resultado vira memória.
// Respostas de clientes vêm antes de tudo: a cada 5 minutos o worker põe na frente da fila a classificação das que chegaram
// e o envio das que o dono aprovou (no horário comercial, de segunda a sexta). Enquanto houver resposta na fila para
// ganhar rascunho, nenhum rascunho novo é escrito, e os rascunhos novos param em 85% do teto do dia para sobrar IA para as respostas.
import { banco, chamarIA } from '../_shared/ia.ts';
import { config, enderecoDe, enviarResend, horarioComercial } from '../_shared/envio.ts';
import { gravarAprendizado } from '../_shared/memoria.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const q = encodeURIComponent;
const ORCAMENTO_MS = 100_000;          // depois disso não pega job novo (a função tem 150 s)
const QUALIFICAR_POR_NOITE = 120;
const ACHAR_SITE_POR_DIA = 100;
const BUSCAS_SEGMENTO_POR_DIA = 30;   // o que sobra do Maps depois do achar site, até este número
const REPETIR_BUSCA_DIAS = 90;        // a mesma busca (segmento e cidade) só volta depois disso
const PRIORIDADE_RESPOSTA = 10;        // acima de todas as rotinas
const RESERVA_RESPOSTAS = 0.85;        // rascunhos novos só até 85% do teto do dia
// Jobs que escrevem rascunhos novos: esperam enquanto houver resposta de cliente sem rascunho.
const ESCREVEM_RASCUNHO = ['reabastecer_rascunhos', 'primeiro_email', 'envio_preparar', 'refazer_email'];
const PARTE_EX_CLIENTES = 0.15;        // 1º contato com ex-cliente: no máximo 15% da fila de rascunhos

type Job = { id: string; tipo: string; payload: Record<string, any>; tentativas: number };

// O Supabase limita as chamadas de uma função para outra dentro da mesma execução ("Rate limit exceeded for trace").
// Por isso: uma pausa curta entre chamadas e, se o limite for atingido, o job volta para a fila sem gastar tentativa.
const PAUSA_ENTRE_CHAMADAS_MS = 400;
class LimiteDeChamadas extends Error {}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chama uma das nossas Edge Functions como "sistema".
async function chamar(funcao: string, corpo: Record<string, unknown>) {
  let r: Response;
  try {
    r = await fetch(`${SB_URL}/functions/v1/${funcao}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + CHAVE, apikey: CHAVE, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(140_000),
    });
  } catch (e) {
    if (/rate limit/i.test((e as Error).message)) throw new LimiteDeChamadas((e as Error).message);
    throw e;
  } finally { await esperar(PAUSA_ENTRE_CHAMADAS_MS); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 429 && /rate limit/i.test(JSON.stringify(j))) throw new LimiteDeChamadas(`${funcao}: limite de chamadas entre funções`);
  if (!r.ok) throw new Error(`${funcao}/${corpo.acao}: ${j.erro ?? j.msg ?? 'HTTP ' + r.status}`);
  return j;
}

const enfileirar = (tipo: string, payload: Record<string, unknown> = {}, prioridade = 5, chave: string | null = null, rodarEm: Date | null = null) =>
  banco('/rest/v1/rpc/enfileirar', { metodo: 'POST', corpo: { p_tipo: tipo, p_payload: payload, p_prioridade: prioridade, p_chave: chave, p_rodar_em: (rodarEm ?? new Date()).toISOString(), p_origem: 'worker' } });

async function ligado() {
  const [c] = await banco('/rest/v1/config?select=valor&chave=eq.sistema_ativo');
  return c?.valor === true;
}
async function gasto() {
  const [g] = await banco('/rest/v1/rpc/gasto_ia', { metodo: 'POST', corpo: {} });
  return g;
}
async function dentroDoTeto() {
  const g = await gasto();
  return Number(g.hoje_usd) < Number(g.teto_diario_usd) && Number(g.mes_usd) < Number(g.teto_mensal_usd);
}

// Põe as respostas na frente da fila: classificar (e rascunhar) as que chegaram e enviar as aprovadas.
async function respostasPrimeiro() {
  const semRascunho = await banco('/rest/v1/respostas?select=id&status=eq.nova&classificacao=is.null&order=recebido_em&limit=20');
  if (semRascunho.length) {
    // A que já falhou 3 vezes fica para o botão "Classificar e rascunhar" na tela (não tenta de novo a cada 5 minutos).
    const chaves = semRascunho.map((r: { id: string }) => 'classificar:' + r.id);
    const falharam = new Set((await banco(`/rest/v1/jobs?select=chave&status=eq.erro&chave=in.(${chaves.map((c: string) => `"${c}"`).join(',')})`)).map((x: { chave: string }) => x.chave));
    for (const c of chaves) if (!falharam.has(c)) await enfileirar('classificar_resposta', { resposta_id: c.slice(12) }, PRIORIDADE_RESPOSTA, c);
  }
  if (horarioComercial() && (await banco('/rest/v1/respostas?select=id&status=eq.aprovada&limit=1')).length) {
    await enfileirar('envio_respostas', {}, PRIORIDADE_RESPOSTA, 'envio_respostas');
  }
}

// Motivo para um job de rascunho novo esperar, ou null se pode rodar.
async function rascunhoEspera(): Promise<string | null> {
  if ((await banco('/rest/v1/jobs?select=id&tipo=eq.classificar_resposta&status=in.(pendente,rodando)&limit=1')).length) return 'Esperando: há resposta de cliente sem rascunho (respostas vêm primeiro).';
  const g = await gasto();
  if (Number(g.hoje_usd) >= RESERVA_RESPOSTAS * Number(g.teto_diario_usd)) return 'Esperando: o resto do teto de IA de hoje fica para as respostas de clientes.';
  return null;
}

// ---------- o que cada tipo de job faz ----------
const TRABALHOS: Record<string, (j: Job) => Promise<unknown>> = {
  // Rotina de hora em hora: escrever o próximo e-mail das cadências, enviar os aprovados, classificar respostas.
  async cadencia() {
    await enfileirar('envio_preparar', {}, 7, 'envio_preparar');
    await enfileirar('envio_enviar', {}, 8, 'envio_enviar');
    await enfileirar('reabastecer_rascunhos', {}, 6, 'reabastecer_rascunhos');
    const novas = await banco('/rest/v1/respostas?select=id&classificacao=is.null&order=recebido_em&limit=20');
    for (const r of novas) await enfileirar('classificar_resposta', { resposta_id: r.id }, PRIORIDADE_RESPOSTA, 'classificar:' + r.id);
    return { respostas_para_classificar: novas.length };
  },
  // Cada chamada escreve até 3 rascunhos (ficam esperando aprovação); se fez 3, deve haver mais.
  async envio_preparar() {
    const r = await chamar('envio', { acao: 'preparar' });
    if (r.vencidas >= 3) await enfileirar('envio_preparar', {}, 7, 'envio_preparar', new Date(Date.now() + 60_000));
    return r;
  },
  // Só manda o que foi aprovado, no horário e no limite do aquecimento (as regras ficam na função envio).
  async envio_enviar() {
    const r = await chamar('envio', { acao: 'enviar_aprovados' });
    if (r.enviados >= 10) await enfileirar('envio_enviar', {}, 8, 'envio_enviar', new Date(Date.now() + 60_000));
    return r;
  },
  classificar_resposta: (j) => chamar('envio', { acao: 'classificar', resposta_id: j.payload.resposta_id }),
  // Só as respostas aprovadas: saem na hora, sem esperar a rotina de hora em hora.
  envio_respostas: () => chamar('envio', { acao: 'enviar_respostas' }),

  // Mantém sempre config.rascunhos_alvo (30) e-mails esperando aprovação: escreve só a diferença,
  // com o 1º e-mail das melhores empresas ainda não contatadas (maior nota primeiro). Nada sai sem aprovação.
  // Empresa nova vem antes de ex-cliente; 1º contato com ex-cliente fica em no máximo 15% da fila (regra do dono, 22/10/2026).
  async reabastecer_rascunhos() {
    // Rascunhos que o dono mandou refazer (texto ou endereço) e que ainda não ganharam a versão nova (a tela tenta na hora; aqui é a garantia).
    const reprovados = await banco(`/rest/v1/emails?select=id&descarte_tipo=in.(refazer,contato)&erro=is.null&descartado_em=gte.${q(new Date(Date.now() - 7 * 864e5).toISOString())}&limit=20`);
    for (const r of reprovados) {
      if (!(await banco(`/rest/v1/emails?select=id&refeito_de=eq.${r.id}&limit=1`)).length) await enfileirar('refazer_email', { email_id: r.id }, 7, 'refazer:' + r.id);
    }
    const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.rascunhos_alvo');
    const alvo = Number(cfg?.valor ?? 30);
    const esperando = (await banco('/rest/v1/emails?select=id&status=eq.rascunho')).length;
    const naFila = (await banco('/rest/v1/jobs?select=id&tipo=eq.primeiro_email&status=in.(pendente,rodando)')).length;
    const falta = alvo - esperando - naFila;
    if (falta <= 0) return { esperando, na_fila: naFila, aviso: 'Já há rascunhos suficientes.' };
    const ids: string[] = await banco('/rest/v1/rpc/candidatas_primeiro_email', { metodo: 'POST', corpo: { p_limite: falta + 100 } });
    const empresas: { id: string; relacao: string; icp_score: number | null }[] = ids.length ? await banco(`/rest/v1/empresas?select=id,relacao,icp_score&id=in.(${ids.join(',')})`) : [];
    const novas = empresas.filter((e) => e.relacao !== 'ex_cliente').sort((a, b) => (b.icp_score ?? 0) - (a.icp_score ?? 0)).slice(0, falta);
    // Ex-clientes: só o que cabe nos 15% da fila, contando os que já esperam aprovação ou envio (e os já na fila de escrita).
    const exEsperando = (await banco('/rest/v1/emails?select=id,empresas!inner(relacao)&passo=eq.1&status=in.(rascunho,aprovado)&empresas.relacao=eq.ex_cliente')).length;
    const exNaFila = (await banco('/rest/v1/jobs?select=id&tipo=eq.primeiro_email&prioridade=eq.5&status=in.(pendente,rodando)')).length; // ex-cliente entra com prioridade 5
    const exVagas = Math.max(0, Math.ceil(PARTE_EX_CLIENTES * alvo) - exEsperando - exNaFila);
    const ex = empresas.filter((e) => e.relacao === 'ex_cliente').slice(0, Math.min(exVagas, falta - novas.length));
    for (const e of novas) await enfileirar('primeiro_email', { empresa_id: e.id }, 6, 'primeiro_email:' + e.id);
    for (const e of ex) await enfileirar('primeiro_email', { empresa_id: e.id }, 5, 'primeiro_email:' + e.id);
    return { esperando, na_fila: naFila, falta, novas: novas.length, ex_clientes: ex.length, ex_esperando: exEsperando };
  },
  // Escreve o 1º e-mail (prospecção ou retomada) como rascunho. Empresa que não deu certo (sem e-mail liberado,
  // sem gancho) sai da lista por 30 dias, sem gastar as outras tentativas.
  async primeiro_email(j) {
    await banco('/rest/v1/empresas?id=eq.' + q(j.payload.empresa_id), { metodo: 'PATCH', corpo: { primeiro_email_tentado_em: new Date().toISOString() } });
    try { return await chamar('prospeccao', { acao: 'redigir', empresa_id: j.payload.empresa_id }); }
    catch (e) {
      const msg = (e as Error).message;
      if (e instanceof LimiteDeChamadas || /teto|parado/i.test(msg)) throw e;
      return { pulou: msg };
    }
  },

  // Rotina da manhã: procurar no Maps o site das empresas da Receita que ainda não têm, dentro do limite do dia.
  // O que sobra vai para buscas por segmento e cidade (config.maps_segmentos x config.maps_cidades), que trazem empresas novas.
  async descoberta() {
    const st = await chamar('maps', { acao: 'status' });
    const livre = Math.max(0, Number(st.limite_dia) - Number(st.usadas_hoje) - 10);
    const n = Math.min(livre, ACHAR_SITE_POR_DIA);
    if (!livre) return { aviso: 'Sem consultas do Maps sobrando hoje.' };
    const lista = n ? await banco(`/rest/v1/empresas?select=id&origem=eq.receita:cnae&site=is.null&google_place_id=is.null&status=neq.descartada&order=icp_score.desc.nullslast,criado_em&limit=${n}`) : [];
    for (const e of lista) await enfileirar('maps_achar_site', { empresa_id: e.id }, 4, 'achar_site:' + e.id);
    const buscas = await proximasBuscas(Math.min(livre - lista.length, BUSCAS_SEGMENTO_POR_DIA));
    for (const b of buscas) await enfileirar('maps_buscar_segmento', b, 4, `buscar:${b.segmento} em ${b.cidade}`);
    return { enfileiradas: lista.length, buscas_segmento: buscas.length };
  },
  // Reescreve o rascunho reprovado com o motivo do dono. Sem conserto possível, marca o erro e não tenta de novo.
  async refazer_email(j) {
    try { return await chamar('prospeccao', { acao: 'refazer', email_id: j.payload.email_id }); }
    catch (e) {
      const msg = (e as Error).message;
      if (e instanceof LimiteDeChamadas || /teto|parado/i.test(msg)) throw e;
      await banco('/rest/v1/emails?id=eq.' + q(j.payload.email_id), { metodo: 'PATCH', corpo: { erro: ('Não refeito: ' + msg).slice(0, 500) } });
      return { pulou: msg };
    }
  },

  // Rotina diária (6h): busca com IA nos segmentos prioritários do dono, algumas combinações de segmento e estado por dia
  // (config.busca_ia), pulando as que rodaram nos últimos repetir_dias. Estados na ordem da config: os que faltavam primeiro.
  async busca_ia() {
    const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.busca_ia');
    const conf = cfg?.valor ?? {};
    if (!conf.ativo) return { aviso: 'Busca com IA desligada (config.busca_ia.ativo).' };
    const desde = new Date(Date.now() - Number(conf.repetir_dias ?? 30) * 864e5).toISOString();
    const feitas = new Set((await banco(`/rest/v1/jobs?select=chave&tipo=eq.busca_ia_executar&status=in.(pendente,rodando,feito)&criado_em=gte.${q(desde)}`)).map((x: { chave: string }) => x.chave));
    const escolhidas: { segmento: string; uf: string }[] = [];
    for (const uf of (conf.ufs ?? []) as string[]) {
      for (const s of (conf.segmentos ?? []) as { id: string }[]) {
        if (escolhidas.length < Number(conf.por_dia ?? 3) && !feitas.has(`busca_ia:${s.id}:${uf}`)) escolhidas.push({ segmento: s.id, uf });
      }
    }
    // Uma por vez, com 3 minutos entre elas (cada busca leva até 2 minutos).
    for (const [i, b] of escolhidas.entries()) await enfileirar('busca_ia_executar', b, 4, `busca_ia:${b.segmento}:${b.uf}`, new Date(Date.now() + i * 180_000));
    return { buscas: escolhidas };
  },
  // A busca pode passar do tempo de espera do worker e ainda assim terminar e gravar: nesse caso não repete (custaria de novo).
  async busca_ia_executar(j) {
    try { return await chamar('prospeccao', { acao: 'buscar_ia', segmento: j.payload.segmento, uf: j.payload.uf }); }
    catch (e) {
      const msg = (e as Error).message;
      if (/timeout|aborted|abort/i.test(msg)) return { aviso: 'Passou do tempo de espera; o resultado pode ter sido gravado mesmo assim.' };
      throw e;
    }
  },

  maps_achar_site: (j) => chamar('maps', { acao: 'achar_site', empresa_id: j.payload.empresa_id }),
  maps_buscar_segmento: (j) => chamar('maps', { acao: 'buscar_segmento', segmento: j.payload.segmento, cidade: j.payload.cidade }),

  // Rotina da noite: qualificar (nota do ICP) as empresas com site que ainda não foram avaliadas.
  async enriquecimento() {
    const lista = await banco(`/rest/v1/empresas?select=id&site=not.is.null&qualificado_em=is.null&status=not.in.(descartada,cliente)&order=criado_em&limit=${QUALIFICAR_POR_NOITE}`);
    for (const e of lista) await enfileirar('qualificar', { empresa_id: e.id }, 3, 'qualificar:' + e.id);
    return { enfileiradas: lista.length };
  },
  qualificar: (j) => chamar('prospeccao', { acao: 'qualificar', empresa_id: j.payload.empresa_id }),

  // Rotina semanal: coletar os sites dos concorrentes; meia hora depois, ver se vale uma análise nova.
  async concorrencia_semanal() {
    const cons = await banco('/rest/v1/concorrentes?select=id&ativo=is.true');
    for (const c of cons) await enfileirar('concorrencia_coletar', { concorrente_id: c.id }, 2, 'coletar:' + c.id);
    await enfileirar('analise_verificar', {}, 2, 'analise_verificar', new Date(Date.now() + 30 * 60_000));
    // Três horas depois (coleta e análise já terminaram): a revisão semanal.
    await enfileirar('revisao_semanal', {}, 2, 'revisao_semanal', new Date(Date.now() + 3 * 3600_000));
    return { concorrentes: cons.length };
  },
  // Site que bloqueia robôs (WEG, Lechler): não é falha nossa nem melhora tentando de novo; fica como aviso.
  async concorrencia_coletar(j) {
    try { return await chamar('concorrencia', { acao: 'coletar', concorrente_id: j.payload.concorrente_id }); }
    catch (e) {
      const msg = (e as Error).message;
      if (/bloqueia rob|robots\.txt/i.test(msg)) return { aviso: msg };
      throw e;
    }
  },
  // Análise nova se alguma página mudou desde a última, ou se a última tem mais de 28 dias (mensal).
  async analise_verificar() {
    const [ult] = await banco('/rest/v1/analises_mercado?select=criado_em&status=eq.fechada&order=criado_em.desc&limit=1');
    const desde = ult?.criado_em ?? '1970-01-01';
    const mudou = await banco(`/rest/v1/coletas_concorrente?select=id&mudou=is.true&coletado_em=gt.${q(desde)}&limit=1`);
    const velha = Date.now() - new Date(desde).getTime() > 28 * 86400_000;
    if (!mudou.length && !velha) return { aviso: 'Nada mudou nos concorrentes e a última análise é recente.' };
    const r = await chamar('concorrencia', { acao: 'abrir_analise' });
    await enfileirar('analise_avancar', { analise_id: r.analise_id }, 2, 'analise:' + r.analise_id);
    return { analise_id: r.analise_id, motivo: mudou.length ? 'página mudou' : 'mais de 28 dias' };
  },
  async analise_avancar(j) {
    const r = await chamar('concorrencia', { acao: 'avancar', analise_id: j.payload.analise_id });
    if (r.status === 'em_andamento') await enfileirar('analise_avancar', j.payload, 2, 'analise:' + j.payload.analise_id, new Date(Date.now() + 60_000));
    return r;
  },

  memoria_consolidar: () => chamar('memoria', { acao: 'consolidar' }),
  revisao_semanal: () => revisaoSemanal(),
  // O Conselho fala um passo por vez (cada um é uma chamada de IA); a sessão continua no job seguinte.
  async conselho_avancar(j) {
    const r = await chamar('conselho', { acao: 'avancar', sessao_id: j.payload.sessao_id });
    if (r.status === 'em_andamento') await enfileirar('conselho_avancar', j.payload, 4, 'conselho:' + j.payload.sessao_id, new Date(Date.now() + 30_000));
    return r;
  },
  medir_acoes: () => medirAcoes(),
  // Junto com o relatório das 8h: medir as ações aprovadas que chegaram na data.
  relatorio: async () => { await enfileirar('medir_acoes', {}, 3, 'medir_acoes'); return relatorio(); },
  teste: async (j) => ({ ok: true, eco: j.payload }),
};

// Próximas buscas por segmento: cidade por cidade (na ordem da config), todos os segmentos de cada uma,
// pulando as que já rodaram (ou estão na fila) nos últimos REPETIR_BUSCA_DIAS dias.
async function proximasBuscas(n: number) {
  if (n <= 0) return [];
  const [seg] = await banco('/rest/v1/config?select=valor&chave=eq.maps_segmentos');
  const [cid] = await banco('/rest/v1/config?select=valor&chave=eq.maps_cidades');
  const desde = new Date(Date.now() - REPETIR_BUSCA_DIAS * 864e5).toISOString();
  const feitas = new Set((await banco(`/rest/v1/jobs?select=chave&tipo=eq.maps_buscar_segmento&status=in.(pendente,rodando,feito)&criado_em=gte.${q(desde)}`)).map((x: { chave: string }) => x.chave));
  const out: { segmento: string; cidade: string }[] = [];
  for (const cidade of (cid?.valor ?? []) as string[]) {
    for (const segmento of (seg?.valor ?? []) as string[]) {
      if (out.length >= n) return out;
      if (!feitas.has(`buscar:${segmento} em ${cidade}`)) out.push({ segmento, cidade });
    }
  }
  return out;
}

// ---------- relatório das 8h para o dono ----------
async function relatorio() {
  const agora = new Date();
  const ontem = new Date(agora.getTime() - 24 * 3600_000).toISOString();
  const conta = async (caminho: string) => (await banco(caminho)).length;
  const [g] = await banco('/rest/v1/rpc/gasto_ia', { metodo: 'POST', corpo: {} });
  const custoOntem = (await banco(`/rest/v1/execucoes_agente?select=custo_usd&criado_em=gte.${q(ontem)}`)).reduce((s: number, x: { custo_usd: number }) => s + Number(x.custo_usd), 0);
  const n = {
    enviados: await conta(`/rest/v1/emails?select=id&enviado_em=gte.${q(ontem)}`),
    respostas: await conta(`/rest/v1/respostas?select=id&recebido_em=gte.${q(ontem)}`),
    aprovar_emails: await conta('/rest/v1/emails?select=id&status=eq.rascunho'),
    aprovar_respostas: await conta('/rest/v1/respostas?select=id&status=eq.nova'),
    respostas_esperando: await banco('/rest/v1/respostas?select=de,recebido_em,empresas(nome)&status=in.(nova,aprovada)&order=recebido_em&limit=10'),
    telefones: await conta(`/rest/v1/interacoes?select=id&tipo=eq.mudanca_etapa&conteudo=ilike.*telefone*&ocorrido_em=gte.${q(ontem)}`),
    empresas_novas: await conta(`/rest/v1/empresas?select=id&criado_em=gte.${q(ontem)}`),
    qualificadas: await conta(`/rest/v1/empresas?select=id&qualificado_em=gte.${q(ontem)}`),
    jobs_feitos: await conta(`/rest/v1/jobs?select=id&status=eq.feito&terminado_em=gte.${q(ontem)}`),
    jobs_erro: await banco(`/rest/v1/jobs?select=tipo,erro&status=eq.erro&terminado_em=gte.${q(ontem)}&limit=5`),
    acoes: await conta('/rest/v1/acoes_propostas?select=id&status=eq.proposta'),
    revisao: (await banco(`/rest/v1/revisoes?select=sinais,pulou_motivo,sessao_id&criado_em=gte.${q(ontem)}&order=criado_em.desc&limit=1`))[0],
    medidas: await banco(`/rest/v1/acoes_propostas?select=titulo,resultado&status=eq.medida&medida_em=gte.${q(ontem)}`),
  };
  const visitas = await banco(`/rest/v1/visitas?select=canal&criado_em=gte.${q(ontem)}`);
  const ia = visitas.filter((v: { canal: string }) => v.canal === 'ia').length;
  const linhas = [
    // Respostas de clientes primeiro: são o que mais importa responder no mesmo dia.
    ...(n.respostas_esperando.length ? [
      `RESPOSTAS DE CLIENTES ESPERANDO VOCÊ (${n.respostas_esperando.length}) — aprove hoje para sair hoje:`,
      ...n.respostas_esperando.map((r: Record<string, any>) => `  - ${r.empresas?.nome ?? r.de} (${r.de}), recebida em ${new Date(r.recebido_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`),
      '  Aprovar: https://corquimica.com.br/app/#prospeccao',
      '',
    ] : []),
    `Resumo das últimas 24 horas (até ${agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}):`,
    '',
    `E-mails enviados: ${n.enviados}`,
    `Respostas recebidas: ${n.respostas}`,
    `Telefones de responsáveis obtidos: ${n.telefones}`,
    `Esperando sua aprovação: ${n.aprovar_respostas} resposta(s) e ${n.aprovar_emails} e-mail(s) novos`,
    `Empresas novas: ${n.empresas_novas} · qualificadas: ${n.qualificadas}`,
    `Visitas no site: ${visitas.length} (${ia} vindas de assistentes de IA)`,
    `Gasto de IA: US$ ${custoOntem.toFixed(2)} nas 24 h · mês US$ ${Number(g.mes_usd).toFixed(2)} de ${Number(g.teto_mensal_usd).toFixed(2)}`,
    `Ações propostas pelos robôs esperando você: ${n.acoes}${n.acoes ? ' (tela Conselho)' : ''}`,
    ...(n.revisao ? [`Revisão semanal: ${n.revisao.sinais.length} sinal(is). ${n.revisao.pulou_motivo ?? 'O Conselho discutiu sozinho e propôs ações.'}`] : []),
    ...n.medidas.map((m: { titulo: string; resultado: string }) => `Ação medida: "${m.titulo}" ${m.resultado}`),
    `Trabalhos automáticos: ${n.jobs_feitos} feitos, ${n.jobs_erro.length} com erro`,
    ...n.jobs_erro.map((e: { tipo: string; erro: string }) => `  - ${e.tipo}: ${String(e.erro).slice(0, 160)}`),
    '',
    'Aprovações e detalhes: https://corquimica.com.br/app/',
  ];
  const [dono] = await banco('/rest/v1/perfis?select=email&papel=eq.dono&limit=1');
  if (!dono?.email) throw new Error('Não achei o e-mail do dono em perfis.');
  const c = await config(['email_remetente']);
  const texto = linhas.join('\n');
  await enviarResend({
    from: `Plataforma Corquímica <${enderecoDe(c.email_remetente)}>`, to: dono.email,
    subject: (n.aprovar_respostas ? `Corquímica: ${n.aprovar_respostas} resposta(s) de cliente para aprovar · ` : 'Corquímica: ') + `${n.enviados} enviados, ${n.respostas} respostas, ${n.aprovar_emails} e-mails para aprovar`,
    text: texto, html: `<pre style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${texto.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
    chave: 'relatorio-' + agora.toISOString().slice(0, 10),
  });
  return n;
}

// ---------- ciclo autônomo: revisão semanal, aprendizado e medição ----------
type Ind = { valor: number | null; amostra: number; melhor: 'maior' | 'menor'; descricao: string };
const TAXAS = ['resposta', 'interesse', 'bounce', 'descarte_rascunhos', 'descarte_por_empresa', 'entrada_qualificada'];
const fmt = (k: string, v: number | null) => v == null ? '—' : TAXAS.includes(k) ? (100 * v).toFixed(1).replace('.', ',') + '%' : String(v);
// Amostra mínima para um indicador virar sinal, e limites que já são sinal sozinhos.
const MINIMO: Record<string, number> = { resposta: 30, interesse: 30, bounce: 30, telefones: 30, descarte_rascunhos: 10, descarte_por_empresa: 10, entrada_qualificada: 20, empresas_descartadas: 20, visitas: 20, visitas_ia: 20, visitas_busca: 20, leads_site: 20 };
const LIMITE: Record<string, [number, 'acima' | 'abaixo']> = { descarte_rascunhos: [0.25, 'acima'], entrada_qualificada: [0.35, 'abaixo'], bounce: [0.03, 'acima'], resposta: [0.02, 'abaixo'] };

// A reflexão só roda com folga: o dia abaixo da metade do teto e o mês dentro do teto próprio da reflexão.
async function podeRefletir(): Promise<string | null> {
  const [g] = await banco('/rest/v1/rpc/gasto_ia', { metodo: 'POST', corpo: {} });
  const [c] = await banco('/rest/v1/config?select=valor&chave=eq.teto_reflexao_mensal_usd');
  const teto = Number(c?.valor ?? 6);
  const usado = Number(await banco('/rest/v1/rpc/gasto_reflexao_mes', { metodo: 'POST', corpo: {} }));
  if (Number(g.hoje_usd) >= 0.5 * Number(g.teto_diario_usd)) return 'o gasto de hoje já passou da metade do teto diário (a rotina vem primeiro)';
  if (usado >= teto) return `a reflexão já usou US$ ${usado.toFixed(2)} de US$ ${teto.toFixed(2)} no mês`;
  return null;
}

function sinais(atual: Record<string, Ind>, anterior: Record<string, Ind>) {
  const out: string[] = [];
  for (const [k, a] of Object.entries(atual)) {
    if (!a || typeof a !== 'object' || !MINIMO[k] || a.amostra < MINIMO[k] || a.valor == null) continue;
    const lim = LIMITE[k], p = anterior[k];
    if (lim && (lim[1] === 'acima' ? a.valor > lim[0] : a.valor < lim[0])) {
      out.push(`${k} em ${fmt(k, a.valor)} (${a.descricao}; amostra ${a.amostra}), ${lim[1]} do limite de ${fmt(k, lim[0])}`);
    } else if (p && p.amostra >= MINIMO[k] && p.valor) {
      const v = (a.valor - p.valor) / p.valor;
      if (Math.abs(v) >= 0.25) out.push(`${k} ${(v > 0) === (a.melhor === 'maior') ? 'melhorou' : 'piorou'}: ${fmt(k, p.valor)} → ${fmt(k, a.valor)} (${a.descricao}; amostra ${p.amostra} → ${a.amostra})`);
    }
  }
  if (Number(atual.conteudo_parado?.valor) > 0) out.push(`${atual.conteudo_parado.valor} proposta(s) de conteúdo aberta(s) há mais de 14 dias`);
  if (Number(atual.concorrente_mudou?.valor) > 0) out.push(`${atual.concorrente_mudou.valor} página(s) de concorrentes mudaram nas últimas 4 semanas`);
  return out;
}

// Motivos que o dono escreveu ao descartar (desde a última revisão) viram padrões na memória.
// Opinião explícita do dono vale como evidência forte: entra com confiança 0,65, já usada pelos redatores.
async function aprenderDescartes(desde: string) {
  const emails = await banco(`/rest/v1/emails?select=descarte_tipo,descarte_motivo,passo,empresas(segmento_icp)&descarte_tipo=not.is.null&descartado_em=gte.${q(desde)}&limit=60`);
  const conteudo = (await banco(`/rest/v1/propostas_conteudo?select=status,descarte_motivo,ajustes&atualizado_em=gte.${q(desde)}`))
    .filter((p: Record<string, any>) => p.descarte_motivo || p.ajustes?.length);
  const motivos = [
    ...emails.map((m: Record<string, any>) => ({ area: m.descarte_tipo === 'empresa' ? 'empresas' : 'redacao', segmento: m.empresas?.segmento_icp, motivo: m.descarte_motivo })),
    ...conteudo.map((p: Record<string, any>) => ({ area: 'conteudo', motivo: p.descarte_motivo ?? p.ajustes?.at(-1)?.motivo })),
  ].filter((m) => m.motivo);
  if (motivos.length < 2) return [];
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'reflexao_descartes', nivel: 'barato', manual: false, maxTokens: 1500,
    instrucoes: 'Você agrupa os motivos que o dono da Corquímica escreveu ao reprovar rascunhos de e-mail, empresas e páginas. Responda só com JSON. Junte motivos que dizem a mesma coisa. Escreva cada padrão como regra geral, em uma frase, sem nome de empresa nem de pessoa.',
    contexto: `MOTIVOS:\n${JSON.stringify(motivos)}\n\nDevolva {"padroes":[{"area":"redacao|empresas|conteudo","padrao":"","ocorrencias":0}]}, só com padrões que aparecem 2 ou mais vezes.`,
  });
  let v: { padroes?: { area: string; padrao: string; ocorrencias: number }[] } = {};
  try { v = JSON.parse(r.texto.slice(r.texto.indexOf('{'), r.texto.lastIndexOf('}') + 1)); } catch { return [{ erro: 'resposta sem JSON' }]; }
  const feitos: Record<string, unknown>[] = [];
  for (const p of (v.padroes ?? []).filter((x) => x.padrao && Number(x.ocorrencias) >= 2)) {
    try {
      const g = await gravarAprendizado({
        hipotese: `${p.padrao.trim().replace(/\.$/, '')} (o dono apontou isso em ${p.ocorrencias} de ${motivos.length} descartes recentes).`,
        evidencia: [{ metrica: 'descartes com este motivo', valor: Number(p.ocorrencias), amostra: motivos.length, fonte: 'motivos de descarte escritos pelo dono' }],
        status: 'hipotese', confianca: 0.65, tags: ['dono', p.area], origem: 'descartes',
      }, false);
      feitos.push({ padrao: p.padrao, ...g });
    } catch (e) { feitos.push({ padrao: p.padrao, erro: (e as Error).message }); }
  }
  return feitos;
}

// Uma vez a cada 4 semanas (janelas que não se sobrepõem): segmento ou passo com resposta muito acima ou abaixo da média vira memória.
async function padroesNumericos() {
  const [ult] = await banco('/rest/v1/revisoes?select=criado_em&padroes_gravados=is.true&order=criado_em.desc&limit=1');
  if (ult && Date.now() - new Date(ult.criado_em).getTime() < 27 * 864e5) return { itens: [], marcar: false };
  const linhas: { grupo: string; valor: string; enviados: number; respostas: number }[] = await banco('/rest/v1/rpc/resposta_por_grupo', { metodo: 'POST', corpo: { p_dias: 28 } });
  const seg = linhas.filter((l) => l.grupo === 'segmento');
  const env = seg.reduce((s, l) => s + Number(l.enviados), 0), resp = seg.reduce((s, l) => s + Number(l.respostas), 0);
  if (env < 60 || !resp) return { itens: [], marcar: false };
  const media = resp / env;
  const pct = (x: number) => (100 * x).toFixed(1).replace('.', ',') + '%';
  const itens: Record<string, unknown>[] = [];
  for (const l of linhas.filter((x) => Number(x.enviados) >= 30)) {
    const taxa = Number(l.respostas) / Number(l.enviados);
    if (Math.abs(taxa - media) / media < 0.5) continue;
    const quem = l.grupo === 'segmento' ? `para o segmento ${l.valor}` : `do passo ${l.valor} da cadência`;
    try {
      const g = await gravarAprendizado({
        hipotese: `Nas últimas 4 semanas, e-mails ${quem} tiveram ${pct(taxa)} de resposta, contra ${pct(media)} da média (${l.enviados} envios).`,
        evidencia: [{ metrica: 'taxa de resposta', valor: pct(taxa), amostra: Number(l.enviados), fonte: 'resposta_por_grupo(28)' }],
        status: 'testando', tags: ['resposta', l.grupo], origem: 'padroes',
      }, false);
      itens.push({ grupo: l.grupo, valor: l.valor, taxa: pct(taxa), ...g });
    } catch (e) { itens.push({ grupo: l.grupo, valor: l.valor, erro: (e as Error).message }); }
  }
  return { itens, marcar: true };
}

async function revisaoSemanal() {
  const semFolga = await podeRefletir();
  if (semFolga) {
    await banco('/rest/v1/revisoes', { metodo: 'POST', corpo: { pulou_motivo: 'Sem orçamento: ' + semFolga } });
    return { pulou: semFolga };
  }
  const [ult] = await banco('/rest/v1/revisoes?select=criado_em&order=criado_em.desc&limit=1');
  const desde = ult?.criado_em ?? new Date(Date.now() - 7 * 864e5).toISOString();
  const aprendizados: Record<string, unknown>[] = [];
  try { aprendizados.push(...(await aprenderDescartes(desde))); } catch (e) { aprendizados.push({ etapa: 'descartes', erro: (e as Error).message }); }
  let padroes = false;
  try { const p = await padroesNumericos(); aprendizados.push(...p.itens); padroes = p.marcar; } catch (e) { aprendizados.push({ etapa: 'padroes', erro: (e as Error).message }); }

  const atual = await banco('/rest/v1/rpc/indicadores', { metodo: 'POST', corpo: { p_dias: 28 } });
  const anterior = await banco('/rest/v1/rpc/indicadores', { metodo: 'POST', corpo: { p_dias: 28, p_ate: new Date(Date.now() - 28 * 864e5).toISOString() } });
  const lista = sinais(atual, anterior);
  const novosMotivos = (await banco(`/rest/v1/emails?select=id&descarte_tipo=not.is.null&descartado_em=gte.${q(desde)}`)).length;
  if (novosMotivos) lista.push(`${novosMotivos} rascunho(s) descartado(s) pelo dono com motivo desde a última revisão (veja descartes_do_dono)`);
  const medidas = await banco(`/rest/v1/acoes_propostas?select=titulo,metrica,valor_antes,valor_depois,resultado&status=eq.medida&medida_em=gte.${q(desde)}`);
  for (const m of medidas) lista.push(`ação medida: "${m.titulo}" ${m.resultado} (${m.metrica}: ${fmt(m.metrica, m.valor_antes)} → ${fmt(m.metrica, m.valor_depois)})`);

  const pendentes = (await banco('/rest/v1/acoes_propostas?select=id&status=eq.proposta')).length;
  let pulou: string | null = null, sessao: string | null = null;
  if (!lista.length) pulou = 'Nenhum sinal com amostra suficiente nesta semana.';
  else if (pendentes >= 3) pulou = `${pendentes} ações ainda esperam a decisão do dono: o Conselho não abre outra sessão antes disso.`;
  else {
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const tema = `Revisão semanal automática (${hoje}). Sinais desta semana (números no bloco indicadores do dossiê):\n- ${lista.join('\n- ')}\n\n` +
      'Perguntas: (1) o que explica cada sinal, com fonte no dossiê? (2) a qualidade das empresas que estão entrando (entrada_empresas, descartes_do_dono, segmentos e regras em regras_atuais) está boa, ou a rota de prospecção precisa mudar? (3) os e-mails, o site e o conteúdo estão bem posicionados contra a concorrência? ' +
      'Proponha no máximo 3 ações, cada uma com a métrica que deve mover. Não repita ações recusadas sem evidência nova.';
    const r = await chamar('conselho', { acao: 'abrir', gatilho: 'revisao_semanal', tema });
    sessao = r.sessao_id;
    await enfileirar('conselho_avancar', { sessao_id: sessao }, 4, 'conselho:' + sessao);
  }
  await banco('/rest/v1/revisoes', { metodo: 'POST', corpo: { sinais: lista, sessao_id: sessao, pulou_motivo: pulou, aprendizados, padroes_gravados: padroes } });
  return { sinais: lista.length, sessao_id: sessao, pulou, aprendizados: aprendizados.length };
}

// Ações aprovadas que chegaram na data de medir: o banco calcula o depois; aqui o resultado vira memória.
async function medirAcoes() {
  const medidas = await banco('/rest/v1/rpc/medir_acoes', { metodo: 'POST', corpo: {} });
  let gravadas = 0;
  for (const a of medidas) {
    if (!a.metrica || a.valor_depois == null || String(a.resultado).startsWith('inconclusivo')) continue;
    try {
      const g = await gravarAprendizado({
        hipotese: `Ação aprovada "${a.titulo}" (${a.tipo}): ${a.metrica} foi de ${fmt(a.metrica, a.valor_antes)} para ${fmt(a.metrica, a.valor_depois)} (${a.resultado}; amostra ${a.amostra_antes} → ${a.amostra_depois}).`,
        evidencia: [{ metrica: a.metrica, valor: Number(a.valor_depois), amostra: Number(a.amostra_depois), fonte: 'indicadores()' }],   // o registro é o fato medido (melhorou ou piorou), não uma hipótese contrariada
        status: 'testando', tags: ['acao', a.tipo], origem: 'acao', origem_id: a.id,
      }, false);
      await banco('/rest/v1/acoes_propostas?id=eq.' + a.id, { metodo: 'PATCH', corpo: { aprendizado_id: g.id } });
      gravadas++;
    } catch (e) { console.error('Medição sem memória:', (e as Error).message); }
  }
  return { medidas: medidas.length, gravadas };
}

// ---------- alertas para o dono (Fase 10) ----------
// Conferidos a cada execução do worker; cada alerta (tipo e alvo) sai no máximo uma vez por dia, num e-mail só.
async function alertas() {
  const ativos: { tipo: string; alvo: string; detalhe: string }[] = await banco('/rest/v1/rpc/condicoes_alerta', { metodo: 'POST', corpo: {} });
  const novos: { id: string; detalhe: string }[] = [];
  for (const a of ativos) {
    const id = await banco('/rest/v1/rpc/registrar_alerta', { metodo: 'POST', corpo: { p_tipo: a.tipo, p_alvo: a.alvo, p_detalhe: a.detalhe } });
    if (id) novos.push({ id, detalhe: a.detalhe });
  }
  if (!novos.length) return 0;
  const [dono] = await banco('/rest/v1/perfis?select=email&papel=eq.dono&limit=1');
  if (!dono?.email) throw new Error('Não achei o e-mail do dono em perfis.');
  const c = await config(['email_remetente']);
  const texto = ['Alerta da plataforma Corquímica:', '', ...novos.map((n) => '- ' + n.detalhe), '', 'Para parar tudo na hora: https://corquimica.com.br/app/#operacao (botão "Parar tudo agora").'].join('\n');
  await enviarResend({
    from: `Plataforma Corquímica <${enderecoDe(c.email_remetente)}>`, to: dono.email,
    subject: `Alerta Corquímica: ${novos.length === 1 ? novos[0].detalhe.slice(0, 80) : novos.length + ' alertas'}`,
    text: texto, html: `<pre style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${texto.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
    chave: 'alerta-' + novos.map((n) => n.id).join('-').slice(0, 200),
  });
  await banco(`/rest/v1/alertas?id=in.(${novos.map((n) => n.id).join(',')})`, { metodo: 'PATCH', corpo: { enviado_em: new Date().toISOString() } });
  return novos.length;
}

// ---------- laço principal ----------
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST.', { status: 405 });
  const segredo = req.headers.get('x-cq-segredo') ?? '';
  const ok = segredo && (await banco('/rest/v1/rpc/conferir_segredo_worker', { metodo: 'POST', corpo: { p: segredo } }));
  if (ok !== true) return new Response('Não autorizado.', { status: 401 });

  // Diagnóstico: confere, mesmo com os robôs parados, que o worker entra nas outras funções como "sistema".
  // Só consultas de leitura (status do Maps e do envio): sem IA, sem e-mail, sem gravar nada.
  const corpo = await req.json().catch(() => ({}));
  if (corpo?.diagnostico === true) {
    const teste = async (f: string) => { try { return { ok: true, resposta: await chamar(f, { acao: 'status' }) }; } catch (e) { return { ok: false, erro: (e as Error).message }; } };
    return Response.json({ ligado: await ligado(), maps: await teste('maps'), envio: await teste('envio') });
  }

  // Alertas primeiro: um problema na conferência não impede a fila de andar.
  try { await alertas(); } catch (e) { console.error('Falha nos alertas:', (e as Error).message); }
  if (await ligado()) {
    try { await respostasPrimeiro(); } catch (e) { console.error('Falha ao priorizar respostas:', (e as Error).message); }
  }

  const inicio = Date.now();
  const feitos: { tipo: string; ok: boolean; erro?: string }[] = [];
  while (Date.now() - inicio < ORCAMENTO_MS) {
    // O botão de parada vale na hora: conferido antes de cada job.
    if (!(await ligado())) return Response.json({ parado: true, feitos });
    if (!(await dentroDoTeto())) return Response.json({ teto: true, feitos });
    const [j]: Job[] = await banco('/rest/v1/rpc/pegar_job', { metodo: 'POST', corpo: {} });
    if (!j) break;
    const fazer = TRABALHOS[j.tipo];
    if (ESCREVEM_RASCUNHO.includes(j.tipo)) {
      const espera = await rascunhoEspera();
      if (espera) {
        // Adia este e os outros rascunhos novos da fila (10 minutos), sem gastar tentativa.
        const depois = new Date(Date.now() + 10 * 60_000).toISOString();
        await banco(`/rest/v1/jobs?status=eq.pendente&tipo=in.(${ESCREVEM_RASCUNHO.join(',')})&rodar_em=lt.${q(depois)}`, { metodo: 'PATCH', corpo: { rodar_em: depois } });
        await banco('/rest/v1/jobs?id=eq.' + j.id, { metodo: 'PATCH', corpo: { status: 'pendente', tentativas: Math.max(0, j.tentativas - 1), rodar_em: depois, iniciado_em: null, erro: espera } });
        feitos.push({ tipo: j.tipo, ok: false, erro: espera });
        continue;
      }
    }
    try {
      if (!fazer) throw new Error(`Tipo de job desconhecido: ${j.tipo}`);
      const resultado = await fazer(j);
      await banco('/rest/v1/rpc/terminar_job', { metodo: 'POST', corpo: { p_id: j.id, p_ok: true, p_resultado: resultado ?? null } });
      feitos.push({ tipo: j.tipo, ok: true });
    } catch (e) {
      const erro = (e as Error).message;
      if (e instanceof LimiteDeChamadas || /rate limit exceeded/i.test(erro)) {
        // Limite da plataforma, não do job: volta para a fila em 2 minutos, sem gastar tentativa, e esta rodada para aqui.
        await banco('/rest/v1/jobs?id=eq.' + j.id, { metodo: 'PATCH', corpo: { status: 'pendente', tentativas: Math.max(0, j.tentativas - 1), rodar_em: new Date(Date.now() + 120_000).toISOString(), iniciado_em: null, erro: 'Adiado: limite de chamadas entre funções.' } });
        feitos.push({ tipo: j.tipo, ok: false, erro: 'adiado (limite de chamadas)' });
        break;
      }
      await banco('/rest/v1/rpc/terminar_job', { metodo: 'POST', corpo: { p_id: j.id, p_ok: false, p_erro: erro } });
      feitos.push({ tipo: j.tipo, ok: false, erro });
      // Teto de gasto ou sistema parado no meio do job: para tudo, sem gastar as outras tentativas agora.
      if (/teto|parado/i.test(erro)) break;
    }
  }
  return Response.json({ feitos, ms: Date.now() - inicio });
});
