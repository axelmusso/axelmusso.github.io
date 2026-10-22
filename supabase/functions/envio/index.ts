// Envio e cadência (Fase 6, parte B). Só sai e-mail APROVADO por uma pessoa.
//   { acao: 'status' }                      → limite de hoje (aquecimento), enviados e se está no horário
//   { acao: 'enviar_aprovados' }            → manda as respostas e os follow-ups aprovados (seg a sex) e os 1º e-mails aprovados (ter a qui), no horário comercial e no limite
//   { acao: 'enviar_respostas' }            → só as respostas aprovadas (o worker chama a cada 5 minutos no horário comercial)
//   { acao: 'enviar_aprovados', teste: true } → só o dono: o mesmo, fora do horário (para testar), sem iniciar o aquecimento
//   { acao: 'preparar' }                    → escreve (como rascunho) o próximo e-mail das cadências vencidas
//   { acao: 'classificar', resposta_id }    → classifica uma resposta recebida e rascunha a continuação
//   { acao: 'responder', resposta_id, texto } → envia a resposta aprovada, na mesma conversa (fora do horário, fica aprovada e sai às 8h do próximo dia útil)
// Respostas vêm sempre antes: saem primeiro, não contam no limite do aquecimento e não esperam o dia de prospecção.
// Ordem do dono (22/10/2026): 1) respostas; 2) follow-ups da cadência; 3) 1º contato com empresas novas, da maior nota ICP
// para a menor; 4) 1º contato com ex-clientes, no máximo 15% do limite do dia.
// Follow-ups saem de segunda a sexta, como as respostas; só o 1º e-mail espera de terça a quinta.
import { banco, ErroIA } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';
import { classificarResposta, redigirEmail, tipoEmail } from '../_shared/redacao.ts';
import { aplicarClassificacao } from '../_shared/respostas.ts';
import { proximoContato } from '../_shared/contatos.ts';
import { agoraBrasilia, config, diaDeIniciais, enviarResend, ErroEnvio, horarioComercial, limiteDeHoje, montar, proximoEm, suprimido } from '../_shared/envio.ts';

const q = encodeURIComponent;
const POR_CHAMADA = 10; // limite por clique, para caber no tempo da função
const PARTE_EX_CLIENTES = 0.15; // 1º contato com ex-cliente: no máximo 15% dos e-mails do dia

async function registrar(empresa_id: string, contato_id: string | null, assunto: string, conteudo: string, direcao: 'saida' | 'entrada' | 'interna', agente = 'envio') {
  await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id, contato_id, tipo: 'email', direcao, assunto, conteudo: conteudo.slice(0, 4000), agente_id: agente } });
}

// Negócio da empresa no funil: "contatado" no 1º e-mail; "follow_up" quando sai um e-mail seguinte da cadência
// sem resposta. Só avança (nunca volta): quem já respondeu ou está com o Áxel fica onde está.
async function marcarEtapa(empresa: Record<string, any>, passo: number) {
  const etapa = passo > 1 ? 'follow_up' : 'contatado';
  const antes = passo > 1 ? ['novo', 'qualificado', 'contatado'] : ['novo', 'qualificado'];
  const [n] = await banco(`/rest/v1/negocios?select=id,etapa&empresa_id=eq.${empresa.id}&etapa=not.in.(ganho,perdido)&limit=1`);
  if (!n) await banco('/rest/v1/negocios', { metodo: 'POST', corpo: { empresa_id: empresa.id, titulo: (empresa.relacao === 'ex_cliente' ? 'Retomada: ' : 'Prospecção: ') + empresa.nome, etapa } });
  else if (antes.includes(n.etapa)) await banco('/rest/v1/negocios?id=eq.' + n.id, { metodo: 'PATCH', corpo: { etapa } });
}

// teste = botão do dono para conferir o envio fora do horário: ignora o horário e não inicia o aquecimento.
async function enviarAprovados(teste = false) {
  if (!teste && !horarioComercial()) return { enviados: 0, aviso: 'Fora do horário comercial (segunda a sexta, 8h às 18h de Brasília). Os aprovados saem no próximo horário.' };
  // Primeiro as respostas aprovadas (valem de segunda a sexta).
  const { respostas, problemas: problemasResp } = await enviarRespostas();
  const soFollowups = !teste && !diaDeIniciais(); // segunda e sexta: só follow-ups
  const lim = await limiteDeHoje();
  if (lim.restante <= 0) return { enviados: 0, respostas, problemas: problemasResp, aviso: `Limite de hoje atingido (${lim.enviados} de ${lim.limite}, aquecimento dia ${lim.dias_de_aquecimento + 1}).` };
  const c = await config(['email_remetente', 'email_assinatura', 'email_aquecimento', 'apresentacao_url']);
  // Ordem: follow-ups, 1º contato com empresa nova (maior nota primeiro) e, por último, 1º contato com ex-cliente, até 15% do dia.
  const inicioDia = new Date(`${agoraBrasilia().dia}T00:00:00-03:00`).toISOString();
  const exHoje = (await banco(`/rest/v1/emails?select=id,empresas!inner(relacao)&status=eq.enviado&passo=eq.1&enviado_em=gte.${q(inicioDia)}&empresas.relacao=eq.ex_cliente`)).length;
  let exVagas = Math.max(1, Math.floor(PARTE_EX_CLIENTES * lim.limite)) - exHoje;
  const ordem = (m: Record<string, any>) => (m.passo > 1 ? 0 : m.empresas.relacao === 'ex_cliente' ? 2 : 1);
  const aprovados = (await banco('/rest/v1/emails?select=*,empresas(*)&status=eq.aprovado&order=aprovado_em&limit=300'))
    .sort((a: Record<string, any>, b: Record<string, any>) => ordem(a) - ordem(b) || (ordem(a) === 1 ? (b.empresas.icp_score ?? 0) - (a.empresas.icp_score ?? 0) : 0));
  const fila: Record<string, any>[] = [];
  for (const m of aprovados) {
    if (fila.length >= Math.min(lim.restante, POR_CHAMADA)) break;
    if (soFollowups && ordem(m) !== 0) continue;
    if (ordem(m) === 2) { if (exVagas <= 0) continue; exVagas--; }
    fila.push(m);
  }
  let enviados = 0; const problemas: string[] = [];
  for (const m of fila) {
    const e = m.empresas;
    if (e.relacao === 'cliente_ativo' || (await suprimido(m.para))) {
      await banco('/rest/v1/emails?id=eq.' + m.id, { metodo: 'PATCH', corpo: { status: 'descartado', erro: 'Na lista de não contatar ou cliente ativo: não enviado.' } });
      problemas.push(`${e.nome}: na lista de não contatar`); continue;
    }
    // 1º e-mail para empresa nova leva o link da apresentação em PDF (ex-cliente já conhece a Corquímica).
    const pdf = m.passo === 1 && e.relacao === 'prospect' ? c.apresentacao_url : undefined;
    const { text, html, link } = montar(m.corpo, c.email_assinatura, m.id, pdf);
    try {
      const resendId = await enviarResend({
        from: c.email_remetente, to: m.para, subject: m.assunto, text, html, chave: m.id,
        headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      const agora = new Date();
      // Cadência: nasce no 1º envio; nos seguintes, avança o passo e marca o próximo vencimento.
      let cad = m.cadencia_id ? (await banco('/rest/v1/cadencias?select=*&id=eq.' + m.cadencia_id))[0] : null;
      if (!cad) {
        [cad] = await banco('/rest/v1/cadencias', { metodo: 'POST', corpo: { empresa_id: e.id, contato_id: m.contato_id, tipo: e.relacao === 'ex_cliente' ? 'retomada' : 'prospeccao', passo: 0, iniciada_em: agora.toISOString() } });
      }
      const fim = m.passo >= 7; // 3ª retomada de 60 dias: encerra
      await banco('/rest/v1/cadencias?id=eq.' + cad.id, { metodo: 'PATCH', corpo: { passo: m.passo, retomadas: Math.max(0, m.passo - 4), proximo_em: fim ? null : proximoEm(m.passo, new Date(cad.iniciada_em)).toISOString(), status: fim ? 'encerrada' : 'ativa' } });
      await banco('/rest/v1/emails?id=eq.' + m.id, { metodo: 'PATCH', corpo: { status: 'enviado', enviado_em: agora.toISOString(), resend_id: resendId, cadencia_id: cad.id, erro: null } });
      await registrar(e.id, m.contato_id, m.assunto, m.corpo, 'saida');
      await marcarEtapa(e, m.passo);
      enviados++;
    } catch (err) {
      await banco('/rest/v1/emails?id=eq.' + m.id, { metodo: 'PATCH', corpo: { erro: (err as Error).message.slice(0, 500) } });
      problemas.push(`${e.nome}: ${(err as Error).message}`);
      if (err instanceof ErroEnvio && /401|403|RESEND_API_KEY/.test(err.message)) break; // chave errada: não insiste
    }
  }
  if (enviados && !teste && !c.email_aquecimento?.primeiro_envio) {
    await banco('/rest/v1/config?chave=eq.email_aquecimento', { metodo: 'PATCH', corpo: { valor: { ...c.email_aquecimento, primeiro_envio: agoraBrasilia().dia } } });
  }
  const exAdiados = aprovados.filter((m: Record<string, any>) => ordem(m) === 2).length - fila.filter((m) => ordem(m) === 2).length;
  const aviso = soFollowups
    ? (aprovados.some((m: Record<string, any>) => ordem(m) !== 0) ? '1º e-mails (empresas novas e ex-clientes) só saem de terça a quinta; os aprovados esperam o próximo dia permitido.' : null)
    : exAdiados > 0 ? `${exAdiados} e-mail(s) de ex-cliente aprovado(s) esperam: no máximo 15% dos e-mails do dia vão para ex-clientes.` : null;
  return { enviados, respostas, problemas: [...problemasResp, ...problemas], na_fila: fila.length, ...(aviso ? { aviso } : {}) };
}

// Respostas aprovadas que ainda não saíram (aprovadas fora do horário ou que falharam), da mais antiga para a mais nova.
async function enviarRespostas() {
  let respostas = 0; const problemas: string[] = [];
  for (const r of await banco('/rest/v1/respostas?select=*,emails(contato_id)&status=eq.aprovada&order=recebido_em&limit=' + POR_CHAMADA)) {
    try { await enviarResposta(r, r.rascunho ?? ''); respostas++; } catch (err) { problemas.push(`resposta para ${r.de}: ${(err as Error).message}`); }
  }
  return { respostas, problemas };
}

async function preparar(manual: boolean) {
  const vencidas = await banco(`/rest/v1/cadencias?select=*,empresas(*),contatos(*)&status=eq.ativa&proximo_em=lte.${q(new Date().toISOString())}&order=proximo_em&limit=3`);
  let criados = 0; const avisos: string[] = [], trocas: string[] = [];
  for (let cad of vencidas) {
    const e = cad.empresas;
    let contato = cad.contatos;
    const pend = await banco(`/rest/v1/emails?select=id&empresa_id=eq.${e.id}&status=in.(rascunho,aprovado)&limit=1`);
    if (pend.length) continue;
    if (e.relacao === 'cliente_ativo') {
      await banco('/rest/v1/cadencias?id=eq.' + cad.id, { metodo: 'PATCH', corpo: { status: 'suprimida', motivo_fim: 'cliente ativo' } });
      continue;
    }
    const bloqueado = !contato?.email || !contato.pode_contatar || tipoEmail(contato.email) === 'bloqueado' || (await suprimido(contato.email));
    // Fim dos 14 dias sem resposta, ou contato que não serve mais: a empresa não está perdida, passa para o próximo e-mail dela.
    if (bloqueado || (cad.passo === 4 && !cad.fim_sequencia_em)) {
      const motivo = bloqueado ? 'contato bloqueado ou removido' : 'sem resposta em 14 dias';
      const novo = await proximoContato(e, cad.tipo, motivo, cad.id);
      if (novo) {
        trocas.push(`${e.nome}: ${motivo}, segue com ${novo.contato.email}`);
        cad = novo.cadencia; contato = novo.contato;
      } else if (bloqueado) {
        await banco('/rest/v1/cadencias?id=eq.' + cad.id, { metodo: 'PATCH', corpo: { status: 'suprimida', motivo_fim: 'sem outro e-mail' } });
        avisos.push(`${e.nome}: contato bloqueado e nenhum outro e-mail (site e CNPJ consultados)`); continue;
      } else {
        // Acabaram os e-mails: segue para as retomadas, 60 dias depois do último e-mail.
        await banco('/rest/v1/cadencias?id=eq.' + cad.id, { metodo: 'PATCH', corpo: { fim_sequencia_em: new Date().toISOString(), proximo_em: new Date(Date.now() + 53 * 864e5).toISOString() } });
        avisos.push(`${e.nome}: sem outro e-mail; retomada em cerca de 60 dias`); continue;
      }
    }
    const passo = cad.passo + 1;
    if (passo > 7) { await banco('/rest/v1/cadencias?id=eq.' + cad.id, { metodo: 'PATCH', corpo: { status: 'encerrada' } }); continue; }
    const r = await redigirEmail({ empresa: e, contato, passo, tipo: cad.tipo, manual });
    if (r.sem_gancho) { avisos.push(`${e.nome}: sem motivo honesto para o passo ${passo}`); continue; }
    await banco('/rest/v1/emails', { metodo: 'POST', corpo: { cadencia_id: cad.id, empresa_id: e.id, contato_id: contato.id, para: contato.email, passo, angulo: r.angulo, assunto: r.assunto, corpo: r.corpo, status: 'rascunho', memorias: r.memorias, erro: r.revisar.length ? 'Revisar: ' + r.revisar.join('; ') : null } });
    criados++;
  }
  return { criados, avisos, trocas, vencidas: vencidas.length };
}

async function classificar(id: string, manual: boolean) {
  const [r] = await banco('/rest/v1/respostas?select=*,empresas(*)&id=eq.' + q(id));
  if (!r) throw new Error('Resposta não encontrada.');
  const enviados = r.empresa_id ? await banco(`/rest/v1/emails?select=assunto,corpo&empresa_id=eq.${r.empresa_id}&status=eq.enviado&order=enviado_em`) : [];
  const v = await classificarResposta({ texto: r.texto, assunto: r.assunto ?? '', de: r.de, empresa: r.empresas, enviados, manual });
  await banco('/rest/v1/respostas?id=eq.' + r.id, { metodo: 'PATCH', corpo: { classificacao: v.classificacao, rascunho: v.rascunho || null } });
  const resultado = await aplicarClassificacao(r, r.empresas, v, manual);
  return { ...v, resultado };
}

async function responder(id: string, texto: string) {
  const [r] = await banco('/rest/v1/respostas?select=*,emails(contato_id)&id=eq.' + q(id));
  if (!r) throw new Error('Resposta não encontrada.');
  if (!['nova', 'aprovada'].includes(r.status)) throw new Error('Esta resposta já foi tratada.');
  if (!texto.trim()) throw new Error('Escreva a resposta.');
  if (!horarioComercial()) {
    await banco('/rest/v1/respostas?id=eq.' + r.id, { metodo: 'PATCH', corpo: { status: 'aprovada', rascunho: texto } });
    return { ok: true, agendada: true, aviso: 'Aprovada. Fora do horário comercial: sai sozinha às 8h do próximo dia útil (segunda a sexta), antes de qualquer outro e-mail.' };
  }
  await enviarResposta(r, texto);
  return { ok: true };
}

// Envia uma resposta aprovada, na mesma conversa do e-mail do cliente.
async function enviarResposta(r: Record<string, any>, texto: string) {
  if (!texto.trim()) throw new Error('Resposta sem texto.');
  if (await suprimido(r.de)) throw new Error('Este endereço está na lista de não contatar.');
  const c = await config(['email_remetente', 'email_assinatura']);
  const { text, html, link } = montar(texto, c.email_assinatura, r.email_id ?? r.id);
  const assunto = /^re:/i.test(r.assunto ?? '') ? r.assunto : 'Re: ' + (r.assunto ?? '');
  const cab: Record<string, string> = { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  if (r.message_id) { cab['In-Reply-To'] = r.message_id; cab['References'] = r.message_id; }
  await enviarResend({ from: c.email_remetente, to: r.de, subject: assunto, text, html, headers: cab, chave: 'resposta-' + r.id });
  await banco('/rest/v1/respostas?id=eq.' + r.id, { metodo: 'PATCH', corpo: { status: 'enviada', rascunho: texto } });
  if (r.empresa_id) await registrar(r.empresa_id, r.emails?.contato_id ?? null, assunto, texto, 'saida', 'fernando');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador' && quem.papel !== 'sistema') return json(req, 403, { erro: 'Seu papel não pode enviar e-mails.' });
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }
  try {
    if (c.acao === 'status') return json(req, 200, { ...(await limiteDeHoje()), horario_comercial: horarioComercial(), dia_de_iniciais: diaDeIniciais() });
    if (c.acao === 'enviar_aprovados') {
      if (c.teste && quem.papel !== 'dono') return json(req, 403, { erro: 'Só o dono pode enviar fora do horário.' });
      return json(req, 200, await enviarAprovados(c.teste === true));
    }
    if (c.acao === 'enviar_respostas') {
      if (!horarioComercial()) return json(req, 200, { respostas: 0, aviso: 'Fora do horário comercial.' });
      return json(req, 200, await enviarRespostas());
    }
    if (c.acao === 'preparar') return json(req, 200, await preparar(quem.papel !== 'sistema'));
    if (c.acao === 'classificar') return json(req, 200, await classificar(String(c.resposta_id ?? ''), quem.papel !== 'sistema'));
    if (c.acao === 'responder') return json(req, 200, await responder(String(c.resposta_id ?? ''), String(c.texto ?? '')));
    return json(req, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    const codigo = e instanceof ErroIA ? e.codigo : 'http';
    return json(req, codigo === 'teto' || codigo === 'parado' ? 429 : e instanceof ErroEnvio ? 502 : 400, { erro: (e as Error).message, codigo });
  }
});
