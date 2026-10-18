// Worker (Fase 9): roda os jobs da fila. Chamado pelo pg_cron a cada 5 minutos, com o segredo do Vault.
// A cada job: confere o botão de parada e o teto de gasto, pega o próximo job vencido (travado no banco),
// executa com limite de tempo e marca feito, ou devolve à fila com espera crescente (até 3 tentativas).
// As rotinas fixas só põem outros jobs na fila; o trabalho de verdade é feito pelas funções de sempre,
// chamadas aqui como "sistema" (envio, prospecção, Maps, memória, concorrência).
// Nada sai sem aprovação humana: o envio só manda e-mails que alguém aprovou.
import { banco } from '../_shared/ia.ts';
import { config, enderecoDe, enviarResend } from '../_shared/envio.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const q = encodeURIComponent;
const ORCAMENTO_MS = 100_000;          // depois disso não pega job novo (a função tem 150 s)
const QUALIFICAR_POR_NOITE = 40;
const ACHAR_SITE_POR_DIA = 100;

type Job = { id: string; tipo: string; payload: Record<string, any>; tentativas: number };

// Chama uma das nossas Edge Functions como "sistema".
async function chamar(funcao: string, corpo: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/functions/v1/${funcao}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + CHAVE, apikey: CHAVE, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(140_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${funcao}/${corpo.acao}: ${j.erro ?? 'HTTP ' + r.status}`);
  return j;
}

const enfileirar = (tipo: string, payload: Record<string, unknown> = {}, prioridade = 5, chave: string | null = null, rodarEm: Date | null = null) =>
  banco('/rest/v1/rpc/enfileirar', { metodo: 'POST', corpo: { p_tipo: tipo, p_payload: payload, p_prioridade: prioridade, p_chave: chave, p_rodar_em: (rodarEm ?? new Date()).toISOString(), p_origem: 'worker' } });

async function ligado() {
  const [c] = await banco('/rest/v1/config?select=valor&chave=eq.sistema_ativo');
  return c?.valor === true;
}
async function dentroDoTeto() {
  const [g] = await banco('/rest/v1/rpc/gasto_ia', { metodo: 'POST', corpo: {} });
  return Number(g.hoje_usd) < Number(g.teto_diario_usd) && Number(g.mes_usd) < Number(g.teto_mensal_usd);
}

// ---------- o que cada tipo de job faz ----------
const TRABALHOS: Record<string, (j: Job) => Promise<unknown>> = {
  // Rotina de hora em hora: escrever o próximo e-mail das cadências, enviar os aprovados, classificar respostas.
  async cadencia() {
    await enfileirar('envio_preparar', {}, 7, 'envio_preparar');
    await enfileirar('envio_enviar', {}, 8, 'envio_enviar');
    await enfileirar('reabastecer_rascunhos', {}, 6, 'reabastecer_rascunhos');
    const novas = await banco('/rest/v1/respostas?select=id&classificacao=is.null&order=recebido_em&limit=20');
    for (const r of novas) await enfileirar('classificar_resposta', { resposta_id: r.id }, 8, 'classificar:' + r.id);
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

  // Mantém sempre config.rascunhos_alvo (30) e-mails esperando aprovação: escreve só a diferença,
  // com o 1º e-mail das melhores empresas ainda não contatadas (maior nota primeiro). Nada sai sem aprovação.
  async reabastecer_rascunhos() {
    const [cfg] = await banco('/rest/v1/config?select=valor&chave=eq.rascunhos_alvo');
    const alvo = Number(cfg?.valor ?? 30);
    const esperando = (await banco('/rest/v1/emails?select=id&status=eq.rascunho')).length;
    const naFila = (await banco('/rest/v1/jobs?select=id&tipo=eq.primeiro_email&status=in.(pendente,rodando)')).length;
    const falta = alvo - esperando - naFila;
    if (falta <= 0) return { esperando, na_fila: naFila, aviso: 'Já há rascunhos suficientes.' };
    const ids: string[] = await banco('/rest/v1/rpc/candidatas_primeiro_email', { metodo: 'POST', corpo: { p_limite: falta } });
    for (const id of ids) await enfileirar('primeiro_email', { empresa_id: id }, 6, 'primeiro_email:' + id);
    return { esperando, na_fila: naFila, falta, enfileiradas: ids.length };
  },
  // Escreve o 1º e-mail (prospecção ou retomada) como rascunho. Empresa que não deu certo (sem e-mail liberado,
  // sem gancho) sai da lista por 30 dias, sem gastar as outras tentativas.
  async primeiro_email(j) {
    await banco('/rest/v1/empresas?id=eq.' + q(j.payload.empresa_id), { metodo: 'PATCH', corpo: { primeiro_email_tentado_em: new Date().toISOString() } });
    try { return await chamar('prospeccao', { acao: 'redigir', empresa_id: j.payload.empresa_id }); }
    catch (e) {
      const msg = (e as Error).message;
      if (/teto|parado/i.test(msg)) throw e;
      return { pulou: msg };
    }
  },

  // Rotina da manhã: procurar no Maps o site das empresas da Receita que ainda não têm, dentro do limite do dia.
  async descoberta() {
    const st = await chamar('maps', { acao: 'status' });
    const livre = Math.max(0, Number(st.limite_dia) - Number(st.usadas_hoje) - 10);
    const n = Math.min(livre, ACHAR_SITE_POR_DIA);
    if (!n) return { aviso: 'Sem consultas do Maps sobrando hoje.' };
    const lista = await banco(`/rest/v1/empresas?select=id&origem=eq.receita:cnae&site=is.null&google_place_id=is.null&status=neq.descartada&order=icp_score.desc.nullslast,criado_em&limit=${n}`);
    for (const e of lista) await enfileirar('maps_achar_site', { empresa_id: e.id }, 4, 'achar_site:' + e.id);
    return { enfileiradas: lista.length };
  },
  maps_achar_site: (j) => chamar('maps', { acao: 'achar_site', empresa_id: j.payload.empresa_id }),

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
    return { concorrentes: cons.length };
  },
  concorrencia_coletar: (j) => chamar('concorrencia', { acao: 'coletar', concorrente_id: j.payload.concorrente_id }),
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
  relatorio: () => relatorio(),
  teste: async (j) => ({ ok: true, eco: j.payload }),
};

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
    aprovar_respostas: await conta('/rest/v1/respostas?select=id&status=eq.rascunho'),
    telefones: await conta(`/rest/v1/interacoes?select=id&tipo=eq.mudanca_etapa&conteudo=ilike.*telefone*&ocorrido_em=gte.${q(ontem)}`),
    empresas_novas: await conta(`/rest/v1/empresas?select=id&criado_em=gte.${q(ontem)}`),
    qualificadas: await conta(`/rest/v1/empresas?select=id&qualificado_em=gte.${q(ontem)}`),
    jobs_feitos: await conta(`/rest/v1/jobs?select=id&status=eq.feito&terminado_em=gte.${q(ontem)}`),
    jobs_erro: await banco(`/rest/v1/jobs?select=tipo,erro&status=eq.erro&terminado_em=gte.${q(ontem)}&limit=5`),
  };
  const visitas = await banco(`/rest/v1/visitas?select=canal&criado_em=gte.${q(ontem)}`);
  const ia = visitas.filter((v: { canal: string }) => v.canal === 'ia').length;
  const linhas = [
    `Resumo das últimas 24 horas (até ${agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}):`,
    '',
    `E-mails enviados: ${n.enviados}`,
    `Respostas recebidas: ${n.respostas}`,
    `Telefones de responsáveis obtidos: ${n.telefones}`,
    `Esperando sua aprovação: ${n.aprovar_emails} e-mail(s) e ${n.aprovar_respostas} resposta(s)`,
    `Empresas novas: ${n.empresas_novas} · qualificadas: ${n.qualificadas}`,
    `Visitas no site: ${visitas.length} (${ia} vindas de assistentes de IA)`,
    `Gasto de IA: US$ ${custoOntem.toFixed(2)} nas 24 h · mês US$ ${Number(g.mes_usd).toFixed(2)} de ${Number(g.teto_mensal_usd).toFixed(2)}`,
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
    subject: `Corquímica: ${n.enviados} enviados, ${n.respostas} respostas, ${n.aprovar_emails + n.aprovar_respostas} para aprovar`,
    text: texto, html: `<pre style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${texto.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
    chave: 'relatorio-' + agora.toISOString().slice(0, 10),
  });
  return n;
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

  const inicio = Date.now();
  const feitos: { tipo: string; ok: boolean; erro?: string }[] = [];
  while (Date.now() - inicio < ORCAMENTO_MS) {
    // O botão de parada vale na hora: conferido antes de cada job.
    if (!(await ligado())) return Response.json({ parado: true, feitos });
    if (!(await dentroDoTeto())) return Response.json({ teto: true, feitos });
    const [j]: Job[] = await banco('/rest/v1/rpc/pegar_job', { metodo: 'POST', corpo: {} });
    if (!j) break;
    const fazer = TRABALHOS[j.tipo];
    try {
      if (!fazer) throw new Error(`Tipo de job desconhecido: ${j.tipo}`);
      const resultado = await fazer(j);
      await banco('/rest/v1/rpc/terminar_job', { metodo: 'POST', corpo: { p_id: j.id, p_ok: true, p_resultado: resultado ?? null } });
      feitos.push({ tipo: j.tipo, ok: true });
    } catch (e) {
      const erro = (e as Error).message;
      await banco('/rest/v1/rpc/terminar_job', { metodo: 'POST', corpo: { p_id: j.id, p_ok: false, p_erro: erro } });
      feitos.push({ tipo: j.tipo, ok: false, erro });
      // Teto de gasto ou sistema parado no meio do job: para tudo, sem gastar as outras tentativas agora.
      if (/teto|parado/i.test(erro)) break;
    }
  }
  return Response.json({ feitos, ms: Date.now() - inicio });
});
