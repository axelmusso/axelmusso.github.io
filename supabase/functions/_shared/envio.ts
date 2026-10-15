// Envio pelo Resend: monta o e-mail (assinatura + descadastro), confere supressão, aquecimento e horário comercial.
import { banco } from './ia.ts';

const q = encodeURIComponent;
const SB_URL = Deno.env.get('SUPABASE_URL')!;
export const LINK_DESCADASTRO = (token: string) => `${SB_URL}/functions/v1/descadastro?t=${token}`;

export class ErroEnvio extends Error {}

export async function config(chaves: string[]) {
  const linhas = await banco(`/rest/v1/config?select=chave,valor&chave=in.(${chaves.join(',')})`);
  return Object.fromEntries(linhas.map((l: { chave: string; valor: unknown }) => [l.chave, l.valor])) as Record<string, any>;
}

export async function suprimido(email: string) {
  const dom = email.split('@')[1]?.toLowerCase() ?? '';
  const r = await banco(`/rest/v1/lista_supressao?select=id&or=(email.ilike.${q(email)},and(email.is.null,dominio.ilike.${q(dom)}))&limit=1`);
  return r.length > 0;
}

// Hora em Brasília. Envio só em dia útil, das 8h às 18h (os destinatários são do Brasil; o fuso da maioria é o de Brasília).
export function agoraBrasilia() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, semana: p.weekday as string };
}
export function horarioComercial() {
  const a = agoraBrasilia();
  return !['Sat', 'Sun'].includes(a.semana) && a.hora >= 8 && a.hora < 18;
}

// Soma dias úteis (sábado e domingo não contam).
export function somarDiasUteis(de: Date, n: number) {
  const d = new Date(de);
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); const s = d.getUTCDay(); if (s !== 0 && s !== 6) n--; }
  return d;
}

// Quantos e-mails de prospecção podem sair hoje: aquecimento de 10/dia, +20% ao dia, até o teto.
export async function limiteDeHoje() {
  const c = await config(['email_teto_dia', 'email_aquecimento']);
  const teto = Number(c.email_teto_dia ?? 50);
  const aq = c.email_aquecimento ?? { inicio: 10, crescimento: 0.2, primeiro_envio: null };
  const hoje = agoraBrasilia().dia;
  const dias = aq.primeiro_envio ? Math.max(0, Math.round((Date.parse(hoje) - Date.parse(aq.primeiro_envio)) / 864e5)) : 0;
  const limite = Math.min(teto, Math.floor(Number(aq.inicio ?? 10) * Math.pow(1 + Number(aq.crescimento ?? 0.2), dias)));
  const inicioDia = new Date(`${hoje}T00:00:00-03:00`).toISOString();
  const enviados = (await banco(`/rest/v1/emails?select=id&status=eq.enviado&enviado_em=gte.${q(inicioDia)}`)).length;
  return { limite, enviados, restante: Math.max(0, limite - enviados), teto, dias_de_aquecimento: dias, primeiro_envio: aq.primeiro_envio };
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Texto final: corpo + assinatura + descadastro (em texto e em HTML simples, sem rastreio).
export function montar(corpo: string, assinatura: string, token: string) {
  const link = LINK_DESCADASTRO(token);
  const text = `${corpo.trim()}\n\n${assinatura}\n\nNão quer mais receber estes e-mails? Clique aqui: ${link}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">` +
    corpo.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('') +
    `<p style="margin:16px 0 12px;color:#444">${escHtml(assinatura).replace(/\n/g, '<br>')}</p>` +
    `<p style="margin:0;font-size:12px;color:#777">Não quer mais receber estes e-mails? <a href="${link}" style="color:#777">Clique aqui</a>.</p></div>`;
  return { text, html, link };
}

// Chamada à API do Resend. A chave idempotente evita envio duplo se a chamada for repetida.
export async function enviarResend(p: { from: string; to: string; subject: string; text: string; html: string; headers?: Record<string, string>; chave: string }) {
  const chave = Deno.env.get('RESEND_API_KEY');
  if (!chave) throw new ErroEnvio('Falta o segredo RESEND_API_KEY no Supabase.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json', 'Idempotency-Key': p.chave },
    body: JSON.stringify({ from: p.from, to: [p.to], subject: p.subject, text: p.text, html: p.html, headers: p.headers ?? {} }),
    signal: AbortSignal.timeout(30_000),
  });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroEnvio(`Resend ${res.status}: ${r?.message ?? r?.name ?? 'erro'}`);
  return r.id as string;
}

// Lê no Resend o conteúdo completo de um e-mail recebido (o webhook só traz os metadados).
export async function lerRecebido(id: string) {
  const res = await fetch('https://api.resend.com/emails/receiving/' + q(id), { headers: { Authorization: 'Bearer ' + Deno.env.get('RESEND_API_KEY') }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new ErroEnvio(`Resend ${res.status} ao ler e-mail recebido.`);
  return await res.json();
}

export const enderecoDe = (s: string) => (String(s).match(/<([^>]+)>/)?.[1] ?? String(s)).trim().toLowerCase();

// Próximo passo da cadência depois de enviar o passo "passo". 1→+3 dias úteis; 2→dia 7; 3→dia 14; 4 e retomadas→+60 dias.
export function proximoEm(passo: number, iniciada: Date) {
  const agora = new Date();
  const no = (dias: number) => { const d = new Date(iniciada.getTime() + dias * 864e5); return d > agora ? d : somarDiasUteis(agora, 1); };
  if (passo === 1) return somarDiasUteis(agora, 3);
  if (passo === 2) return no(7);
  if (passo === 3) return no(14);
  return new Date(agora.getTime() + 60 * 864e5);
}
