// Google Maps (Fase 6, parte M): acha indústrias por segmento e cidade, e o site de empresas que ainda não têm.
// Usa a Places API (New), Text Search. Cada consulta devolve até 20 lugares e conta como 1 no limite do dia.
//   { acao: 'status' }                         → consultas usadas hoje e o limite (config.maps_limite_dia)
//   { acao: 'buscar', termo, paginas? }        → busca "injeção de plástico em Caxias do Sul" e cadastra as empresas novas
//   { acao: 'achar_site', empresa_id }         → procura a empresa pelo nome e cidade e grava site e telefone
// Nada sai daqui para o mundo: as empresas entram como prospect e passam pela qualificação de sempre.
import { banco } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';

const q = encodeURIComponent;
const URL_BUSCA = 'https://places.googleapis.com/v1/places:searchText';
// Site e telefone entram no nível Enterprise (1.000 consultas grátis por mês); o resto vem junto sem custo extra.
const CAMPOS = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.websiteUri,places.nationalPhoneNumber,places.businessStatus,places.primaryTypeDisplayName,nextPageToken';

class ErroMaps extends Error {}

// Igual à coluna gerada empresas.nome_chave (sem acento, sem pontuação, minúsculo).
const nomeChave = (nome: string) => nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Instagram, Facebook, Linktree e afins não são site da empresa: o domínio é de todo mundo.
const REDE_SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linktr\.ee|wa\.me|whatsapp\.com|linkedin\.com|youtube\.com|tiktok\.com|google\.com|business\.site|negocio\.site)$/i;
const siteProprio = (uri?: string | null) => { try { return uri && !REDE_SOCIAL.test(new URL(uri).hostname) ? uri : null; } catch { return null; } };
const dominioDe = (site?: string | null) => { try { return site ? new URL(site).hostname.replace(/^www\./, '').toLowerCase() : null; } catch { return null; } };
const VAZIAS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'de', 'da', 'do', 'das', 'dos', 'e', 'industria', 'comercio', 'industrial', 'comercial', 'ind', 'com', 'importacao', 'exportacao', 'brasil']);
const palavras = (nome: string) => nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !VAZIAS.has(p));

// Consultas de hoje (horário de Brasília), contadas no registro de execuções.
async function usadasHoje() {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const inicio = new Date(`${hoje}T00:00:00-03:00`).toISOString();
  return (await banco(`/rest/v1/execucoes_agente?select=id&provedor=eq.google_maps&criado_em=gte.${q(inicio)}`)).length;
}
async function limiteDia() {
  const [c] = await banco('/rest/v1/config?select=valor&chave=eq.maps_limite_dia');
  return Number(c?.valor ?? 150);
}

// Uma consulta ao Google, só se ainda houver saldo no dia. Toda consulta fica registrada (custo 0: cota grátis ou crédito).
async function consultar(textQuery: string, pageToken?: string) {
  const chave = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!chave) throw new ErroMaps('Falta o segredo GOOGLE_MAPS_API_KEY no Supabase.');
  const [usadas, limite] = await Promise.all([usadasHoje(), limiteDia()]);
  if (usadas >= limite) throw new ErroMaps(`Limite do Google Maps de hoje atingido (${usadas} de ${limite} consultas).`);
  const inicio = Date.now();
  const r = await fetch(URL_BUSCA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': chave, 'X-Goog-FieldMask': CAMPOS },
    body: JSON.stringify({ textQuery, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  const corpo = await r.json().catch(() => ({}));
  await banco('/rest/v1/execucoes_agente', {
    metodo: 'POST',
    corpo: { provedor: 'google_maps', modelo: 'places_text_search', papel: 'maps_busca', custo_usd: 0, duracao_ms: Date.now() - inicio, sucesso: r.ok, erro: r.ok ? null : JSON.stringify(corpo).slice(0, 500) },
  });
  if (!r.ok) throw new ErroMaps(`Google Maps respondeu ${r.status}: ${corpo?.error?.message ?? ''}`);
  return corpo as { places?: Record<string, any>[]; nextPageToken?: string };
}

// Cidade e UF pelos componentes do endereço.
function local(p: Record<string, any>) {
  const comp = (tipo: string) => (p.addressComponents ?? []).find((c: { types: string[] }) => c.types?.includes(tipo));
  return { cidade: comp('administrative_area_level_2')?.longText ?? null, uf: comp('administrative_area_level_1')?.shortText ?? null };
}

// Já cadastrada (pelo id do Google, domínio, nome sem acento ou telefone) ou na lista de não contatar?
async function existente(p: Record<string, any>, dominio: string | null) {
  const nome = p.displayName?.text ?? '';
  const filtros = [`google_place_id.eq.${q(p.id)}`, `nome_chave.eq.${q(nomeChave(nome))}`];
  if (dominio) filtros.push(`dominio.eq.${q(dominio)}`);
  const [e] = await banco(`/rest/v1/empresas?select=id,site,dominio,telefone,google_place_id&or=(${filtros.join(',')})&limit=1`);
  if (e) return { empresa: e, suprimida: false };
  const sup = dominio ? await banco(`/rest/v1/lista_supressao?select=id&dominio=ilike.${q(dominio)}&limit=1`) : [];
  return { empresa: null, suprimida: sup.length > 0 };
}

async function buscar(termo: string, paginas = 1) {
  if (termo.trim().length < 5) throw new ErroMaps('Escreva o que buscar, com a cidade (ex.: "injeção de plástico em Caxias do Sul").');
  let token: string | undefined, consultas = 0, novas = 0, repetidas = 0, fechadas = 0;
  const nomes: string[] = [];
  for (let i = 0; i < Math.min(Math.max(paginas, 1), 3); i++) {
    const r = await consultar(termo, token);
    consultas++;
    for (const p of r.places ?? []) {
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') { fechadas++; continue; }
      const site = siteProprio(p.websiteUri);
      const dominio = dominioDe(site);
      const { empresa, suprimida } = await existente(p, dominio);
      if (empresa || suprimida) { repetidas++; continue; }
      const { cidade, uf } = local(p);
      await banco('/rest/v1/empresas', {
        metodo: 'POST',
        corpo: {
          nome: String(p.displayName?.text ?? '').slice(0, 200), site, dominio, telefone: p.nationalPhoneNumber ?? null,
          cidade, uf: /^[A-Z]{2}$/.test(uf ?? '') ? uf : null, setor: p.primaryTypeDisplayName?.text ?? null, google_place_id: p.id,
          origem: 'maps:' + termo.slice(0, 80), fonte_url: 'https://maps.google.com/?q=place_id:' + p.id, coletado_em: new Date().toISOString(),
          status: 'prospect', relacao: 'prospect',
        },
      });
      novas++; nomes.push(p.displayName?.text ?? '');
    }
    token = r.nextPageToken;
    if (!token) break;
  }
  return { consultas, novas, repetidas, fechadas, nomes };
}

// Site de uma empresa já cadastrada: busca pelo nome e cidade e só aceita se o nome e a cidade baterem.
async function acharSite(id: string) {
  const [e] = await banco('/rest/v1/empresas?select=id,nome,cidade,uf,site,telefone&id=eq.' + q(id));
  if (!e) throw new ErroMaps('Empresa não encontrada.');
  if (e.site) return { ja_tinha: true };
  const r = await consultar(`${e.nome} ${e.cidade ?? ''} ${e.uf ?? ''}`.trim());
  const chaves = palavras(e.nome);
  const cidade = nomeChave(e.cidade ?? '');
  const p = (r.places ?? []).find((x) => {
    const n = nomeChave(x.displayName?.text ?? '');
    return chaves.length && chaves.some((k) => n.includes(k)) && (!cidade || nomeChave(local(x).cidade ?? '') === cidade);
  });
  if (!p) return { achou: false, motivo: 'nenhum resultado com o mesmo nome e cidade' };
  const site = siteProprio(p.websiteUri);
  if (!site) {
    // Sem site próprio (ou só rede social): aproveita ao menos o telefone.
    if (!e.telefone && p.nationalPhoneNumber) await banco('/rest/v1/empresas?id=eq.' + q(id), { metodo: 'PATCH', corpo: { telefone: p.nationalPhoneNumber } });
    return { achou: false, motivo: p.websiteUri ? 'só rede social no Google' : 'achou a empresa, mas sem site no Google' };
  }
  const dominio = dominioDe(site);
  const livre = dominio && !(await banco(`/rest/v1/empresas?select=id&dominio=eq.${q(dominio)}&id=neq.${q(id)}&limit=1`)).length;
  const placeLivre = !(await banco(`/rest/v1/empresas?select=id&google_place_id=eq.${q(p.id)}&id=neq.${q(id)}&limit=1`)).length;
  await banco('/rest/v1/empresas?id=eq.' + q(id), {
    metodo: 'PATCH',
    corpo: { site, ...(livre ? { dominio } : {}), ...(placeLivre ? { google_place_id: p.id } : {}), telefone: e.telefone || p.nationalPhoneNumber || null, qualificado_em: null },
  });
  return { achou: true, site, duplicada: !livre };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador') return json(req, 403, { erro: 'Seu papel não pode usar a busca no Maps.' });
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }
  try {
    if (c.acao === 'status') return json(req, 200, { usadas_hoje: await usadasHoje(), limite_dia: await limiteDia() });
    if (c.acao === 'buscar') return json(req, 200, await buscar(String(c.termo ?? ''), Number(c.paginas ?? 1)));
    if (c.acao === 'achar_site') return json(req, 200, await acharSite(String(c.empresa_id ?? '')));
    return json(req, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    return json(req, e instanceof ErroMaps ? 422 : 400, { erro: (e as Error).message });
  }
});
