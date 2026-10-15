// Teste da camada de IA, chamado pela tela de Operação. Só o dono pode usar.
// Faz uma chamada curta ao provedor e nível escolhidos (padrão: barato) e devolve modelo, tokens e custo.
import { banco, chamarIA, ErroIA, type Nivel, type Provedor } from '../_shared/ia.ts';

const ORIGENS = ['https://corquimica.com.br', 'http://localhost:4173'];

Deno.serve(async (req) => {
  const origem = req.headers.get('Origin') ?? '';
  const cors = {
    'Access-Control-Allow-Origin': ORIGENS.includes(origem) ? origem : ORIGENS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const responder = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST.' });

  // Quem está chamando: confere o token no Auth e o papel no banco.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const u = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: 'Bearer ' + token },
  });
  if (!u.ok) return responder(401, { erro: 'Faça login de novo.' });
  const { id } = await u.json();
  const perfil = await banco('/rest/v1/perfis?select=papel&id=eq.' + encodeURIComponent(id));
  if (perfil?.[0]?.papel !== 'dono') return responder(403, { erro: 'Só o dono pode testar a IA.' });

  let provedor: Provedor, nivel: Nivel;
  try { const c = await req.json(); provedor = c.provedor; nivel = ['barato', 'rotina', 'dificil'].includes(c.nivel) ? c.nivel : 'barato'; }
  catch { return responder(400, { erro: 'Corpo inválido.' }); }
  if (provedor !== 'anthropic' && provedor !== 'openai') return responder(400, { erro: 'Provedor deve ser anthropic ou openai.' });

  try {
    const r = await chamarIA({
      provedor, papel: 'teste', nivel, manual: true, maxTokens: 1500,
      instrucoes: 'Você é um teste de conexão. Responda em português, em uma frase curta.',
      contexto: 'Confirme que está funcionando e diga qual modelo você é.',
    });
    return responder(200, r);
  } catch (e) {
    const codigo = e instanceof ErroIA ? e.codigo : 'http';
    return responder(codigo === 'teto' || codigo === 'parado' ? 429 : 502, { erro: (e as Error).message, codigo });
  }
});
