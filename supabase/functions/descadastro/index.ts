// Descadastro em um clique. Público: o link de cada e-mail leva o id do e-mail (aleatório, impossível de adivinhar).
// GET (clique no link) e POST (botão "cancelar inscrição" do Gmail/Outlook) gravam na lista de não contatar na hora.
import { banco } from '../_shared/ia.ts';

const q = encodeURIComponent;
const PAGINA = 'https://corquimica.com.br/descadastro/';

async function descadastrar(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return false;
  let [m] = await banco(`/rest/v1/emails?select=id,para,empresa_id,contato_id&id=eq.${q(token)}`);
  if (!m) { // link de uma resposta enviada pela caixa de respostas
    const [r] = await banco(`/rest/v1/respostas?select=de,empresa_id&id=eq.${q(token)}`);
    if (r) m = { para: r.de, empresa_id: r.empresa_id, contato_id: null };
  }
  if (!m) return false;
  const email = String(m.para).toLowerCase();
  if (!(await banco(`/rest/v1/lista_supressao?select=id&email=ilike.${q(email)}&limit=1`)).length) {
    await banco('/rest/v1/lista_supressao', { metodo: 'POST', corpo: { email, motivo: 'descadastro' } });
  }
  await banco(`/rest/v1/contatos?email=ilike.${q(email)}`, { metodo: 'PATCH', corpo: { pode_contatar: false } });
  await banco(`/rest/v1/emails?para=ilike.${q(email)}&status=in.(rascunho,aprovado)`, { metodo: 'PATCH', corpo: { status: 'descartado', erro: 'Pediu descadastro.' } });
  const cads = await banco(`/rest/v1/cadencias?select=id,contatos!inner(email)&contatos.email=ilike.${q(email)}&status=in.(ativa,pausada)`);
  for (const c of cads) await banco('/rest/v1/cadencias?id=eq.' + c.id, { metodo: 'PATCH', corpo: { status: 'suprimida' } });
  if (m.empresa_id) await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: m.empresa_id, contato_id: m.contato_id, tipo: 'email', direcao: 'entrada', assunto: 'Descadastro', conteudo: `${email} pediu para não receber mais e-mails.`, agente_id: 'descadastro' } });
  return true;
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  let ok = false;
  try { ok = await descadastrar(token); } catch (e) { console.error(e); }
  if (req.method === 'POST') return new Response(ok ? 'ok' : 'link inválido', { status: ok ? 200 : 400 });
  return Response.redirect(PAGINA + (ok ? '?ok=1' : '?ok=0'), 303);
});
