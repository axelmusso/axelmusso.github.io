// Comum às Edge Functions chamadas pela área interna: CORS, resposta JSON e quem está chamando.
import { banco } from './ia.ts';

const ORIGENS = ['https://corquimica.com.br', 'http://localhost:4173'];

export function cors(req: Request) {
  const origem = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGENS.includes(origem) ? origem : ORIGENS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export const json = (req: Request, status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// Confere o login no Auth e devolve { id, papel } do perfil, ou null.
export async function usuario(req: Request): Promise<{ id: string; papel: string | null } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const u = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: 'Bearer ' + token },
  });
  if (!u.ok) return null;
  const { id } = await u.json();
  const p = await banco('/rest/v1/perfis?select=papel&id=eq.' + encodeURIComponent(id));
  return { id, papel: p?.[0]?.papel ?? null };
}
