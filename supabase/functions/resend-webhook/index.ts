// Webhook do Resend. Público (sem login), mas só aceita chamadas assinadas com o segredo RESEND_WEBHOOK_SECRET.
// Entrega, abertura e falha viram eventos do e-mail; bounce definitivo e reclamação de spam vão para a lista de não contatar;
// resposta recebida para a cadência, vira registro na caixa de respostas, é classificada e uma cópia vai para a caixa do dono.
import { banco, ErroIA } from '../_shared/ia.ts';
import { classificarResposta } from '../_shared/redacao.ts';
import { config, enderecoDe, enviarResend, lerRecebido } from '../_shared/envio.ts';

const q = encodeURIComponent;

// Assinatura no padrão Svix: HMAC-SHA256 de "id.timestamp.corpo" com o segredo (base64 depois de "whsec_").
async function assinaturaValida(req: Request, corpo: string) {
  const segredo = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
  const id = req.headers.get('svix-id'), ts = req.headers.get('svix-timestamp'), assin = req.headers.get('svix-signature');
  if (!segredo || !id || !ts || !assin) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // mais de 5 minutos: recusa (evita reenvio de evento velho)
  const chave = Uint8Array.from(atob(segredo.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${corpo}`)));
  const esperado = btoa(String.fromCharCode(...sig));
  return assin.split(' ').some((p) => p.split(',')[1] === esperado);
}

async function suprimir(email: string, motivo: 'bounce' | 'spam' | 'descadastro') {
  const ja = await banco(`/rest/v1/lista_supressao?select=id&email=ilike.${q(email)}&limit=1`);
  if (!ja.length) await banco('/rest/v1/lista_supressao', { metodo: 'POST', corpo: { email: email.toLowerCase(), motivo } });
  await banco(`/rest/v1/contatos?email=ilike.${q(email)}`, { metodo: 'PATCH', corpo: { pode_contatar: false } });
  const cads = await banco(`/rest/v1/cadencias?select=id,contatos!inner(email)&contatos.email=ilike.${q(email)}&status=in.(ativa,pausada)`);
  for (const c of cads) await banco('/rest/v1/cadencias?id=eq.' + c.id, { metodo: 'PATCH', corpo: { status: 'suprimida' } });
  await banco(`/rest/v1/emails?para=ilike.${q(email)}&status=in.(rascunho,aprovado)`, { metodo: 'PATCH', corpo: { status: 'descartado', erro: 'Endereço entrou na lista de não contatar (' + motivo + ').' } });
}

async function eventoDeEnvio(tipo: string, d: Record<string, any>) {
  const [m] = await banco(`/rest/v1/emails?select=id,empresa_id,contato_id,para,eventos,status&resend_id=eq.${q(d.email_id)}`);
  if (!m) return;
  const ev = { tipo: tipo.replace('email.', ''), em: new Date().toISOString(), ...(d.bounce ? { bounce: d.bounce.type, detalhe: d.bounce.message } : {}) };
  await banco('/rest/v1/emails?id=eq.' + m.id, { metodo: 'PATCH', corpo: { eventos: [...(m.eventos ?? []), ev], ...(tipo === 'email.failed' ? { status: 'falhou' } : {}) } });
  if ((tipo === 'email.bounced' && d.bounce?.type === 'Permanent') || tipo === 'email.complained' || tipo === 'email.suppressed') {
    await suprimir(m.para, tipo === 'email.complained' ? 'spam' : 'bounce');
    await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: m.empresa_id, contato_id: m.contato_id, tipo: 'email', direcao: 'interna', assunto: tipo === 'email.complained' ? 'Marcado como spam' : 'Bounce definitivo', conteudo: `${m.para} entrou na lista de não contatar.`, agente_id: 'webhook' } });
  }
}

async function respostaRecebida(d: Record<string, any>) {
  if ((await banco(`/rest/v1/respostas?select=id&resend_id=eq.${q(d.email_id)}`)).length) return; // já processada
  const cheio = await lerRecebido(d.email_id);
  const de = enderecoDe(cheio.from ?? d.from);
  const texto = (cheio.text || (cheio.html ?? '').replace(/<[^>]+>/g, ' ')).trim().slice(0, 20000) || '(sem texto)';
  // De qual e-mail nosso é a resposta: o último enviado para este endereço (ou para o mesmo domínio).
  let [orig] = await banco(`/rest/v1/emails?select=id,empresa_id,contato_id,cadencia_id,assunto&status=eq.enviado&para=ilike.${q(de)}&order=enviado_em.desc&limit=1`);
  if (!orig) [orig] = await banco(`/rest/v1/emails?select=id,empresa_id,contato_id,cadencia_id,assunto&status=eq.enviado&para=ilike.${q('%@' + de.split('@')[1])}&order=enviado_em.desc&limit=1`);
  const [resp] = await banco('/rest/v1/respostas', {
    metodo: 'POST',
    corpo: { email_id: orig?.id ?? null, empresa_id: orig?.empresa_id ?? null, de, assunto: cheio.subject ?? d.subject ?? '', texto, resend_id: d.email_id, message_id: cheio.message_id ?? d.message_id ?? null },
  });
  // Classifica e rascunha (respeita o botão de parada e o teto; se não puder, fica para o botão "Classificar" na tela).
  let classe: string | null = null, rascunho = '';
  try {
    const enviados = orig ? await banco(`/rest/v1/emails?select=assunto,corpo&empresa_id=eq.${orig.empresa_id}&status=eq.enviado&order=enviado_em`) : [];
    const empresa = orig ? (await banco('/rest/v1/empresas?select=*&id=eq.' + orig.empresa_id))[0] : null;
    const v = await classificarResposta({ texto, assunto: resp.assunto, empresa, enviados, manual: false });
    classe = v.classificacao; rascunho = v.rascunho;
    await banco('/rest/v1/respostas?id=eq.' + resp.id, { metodo: 'PATCH', corpo: { classificacao: classe, rascunho: rascunho || null } });
  } catch (e) { if (!(e instanceof ErroIA)) console.error('classificação', e); }
  // Ações que não dependem da IA: para a cadência (exceto resposta automática), registra, e "não"/descadastro suprime.
  if (classe === 'nao' || classe === 'descadastro') await suprimir(de, 'descadastro');
  if (orig && classe !== 'automatica') {
    if (orig.cadencia_id) await banco(`/rest/v1/cadencias?id=eq.${orig.cadencia_id}&status=in.(ativa,pausada)`, { metodo: 'PATCH', corpo: { status: 'respondeu' } });
    await banco(`/rest/v1/emails?empresa_id=eq.${orig.empresa_id}&status=in.(rascunho,aprovado)`, { metodo: 'PATCH', corpo: { status: 'descartado', erro: 'A empresa respondeu: cadência parada.' } });
    const [n] = await banco(`/rest/v1/negocios?select=id,etapa&empresa_id=eq.${orig.empresa_id}&etapa=in.(novo,qualificado,contatado)&limit=1`);
    if (n) await banco('/rest/v1/negocios?id=eq.' + n.id, { metodo: 'PATCH', corpo: { etapa: classe === 'nao' || classe === 'descadastro' ? 'perdido' : 'respondeu', ...(classe === 'nao' || classe === 'descadastro' ? { motivo_perda: 'Respondeu que não tem interesse' } : {}) } });
  }
  if (orig) await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: orig.empresa_id, contato_id: orig.contato_id, tipo: 'email', direcao: 'entrada', assunto: resp.assunto, conteudo: texto.slice(0, 4000), agente_id: null } });
  // Cópia para a caixa do dono, com a classificação e o rascunho para aprovar.
  const c = await config(['email_remetente', 'email_copia_respostas']);
  if (c.email_copia_respostas) {
    const aviso = `Resposta recebida de ${de}${orig ? '' : ' (não ligada a nenhum envio)'}.\nClassificação: ${classe ?? 'pendente (sistema parado ou teto atingido)'}\n\n--- Mensagem ---\n${texto.slice(0, 8000)}\n\n--- Rascunho sugerido (aprove em https://corquimica.com.br/app/#prospeccao) ---\n${rascunho || '(sem rascunho)'}`;
    await enviarResend({ from: c.email_remetente, to: c.email_copia_respostas, subject: `[Resposta] ${resp.assunto || de}`, text: aviso, html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${aviso.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`, chave: 'copia-' + resp.id }).catch((e) => console.error('cópia', e));
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const corpo = await req.text();
  if (!(await assinaturaValida(req, corpo))) return new Response('assinatura inválida', { status: 401 });
  let ev: { type: string; data: Record<string, any> };
  try { ev = JSON.parse(corpo); } catch { return new Response('json inválido', { status: 400 }); }
  try {
    if (ev.type === 'email.received') await respostaRecebida(ev.data);
    else if (ev.type?.startsWith('email.')) await eventoDeEnvio(ev.type, ev.data);
    return new Response('ok');
  } catch (e) {
    console.error(ev.type, e);
    return new Response('erro', { status: 500 }); // o Resend tenta de novo
  }
});
