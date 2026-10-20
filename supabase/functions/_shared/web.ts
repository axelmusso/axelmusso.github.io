// Leitura de páginas públicas, com educação: respeita robots.txt, identifica o robô, limita tamanho e tempo.
// Nunca entra em área com login.

export const ROBO = 'CorquimicaBot/1.0 (+https://corquimica.com.br)';

export class ErroWeb extends Error {}

// robots.txt: vale o grupo do nosso robô; se não houver, o grupo "*". Allow mais específico vence Disallow.
export async function permitido(url: URL): Promise<boolean> {
  let txt = '';
  try {
    const r = await fetch(url.origin + '/robots.txt', { headers: { 'User-Agent': ROBO }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (r.status >= 500) return false; // servidor com problema: não arrisca
    if (!r.ok) return true;              // sem robots.txt: liberado
    txt = (await r.text()).slice(0, 200_000);
  } catch { return true; }
  const grupos: { agentes: string[]; regras: [boolean, string][] }[] = [];
  let atual: { agentes: string[]; regras: [boolean, string][] } | null = null;
  for (const linha of txt.split(/\r?\n/)) {
    const l = linha.replace(/#.*/, '').trim();
    const m = l.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const campo = m[1].toLowerCase(), valor = m[2].trim();
    if (campo === 'user-agent') {
      if (!atual || atual.regras.length) { atual = { agentes: [], regras: [] }; grupos.push(atual); }
      atual.agentes.push(valor.toLowerCase());
    } else if (atual) atual.regras.push([campo === 'allow', valor]);
  }
  const nosso = grupos.find((g) => g.agentes.includes('corquimicabot')) ?? grupos.find((g) => g.agentes.includes('*'));
  if (!nosso) return true;
  const caminho = url.pathname + url.search;
  let melhor: [boolean, string] | null = null;
  for (const [permite, regra] of nosso.regras) {
    if (!regra) continue; // "Disallow:" vazio = tudo liberado
    const re = new RegExp('^' + regra.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(caminho) && (!melhor || regra.length > melhor[1].length || (regra.length === melhor[1].length && permite))) melhor = [permite, regra];
  }
  return melhor ? melhor[0] : true;
}

export type Pagina = { url: string; titulo: string; texto: string; links: string[]; emails: string[] };

// Sites atrás do Cloudflare escondem o e-mail no HTML (data-cfemail="..." ou /cdn-cgi/l/email-protection#...):
// o 1º byte em hexadecimal é a chave, e cada byte seguinte é um caractere com XOR dessa chave.
function emailsCloudflare(html: string) {
  return [...html.matchAll(/(?:data-cfemail=["']|email-protection#)([0-9a-f]{6,})/gi)].map((m) => {
    const k = parseInt(m[1].slice(0, 2), 16);
    let s = '';
    for (let i = 2; i < m[1].length; i += 2) s += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16) ^ k);
    return s;
  }).filter((e) => /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(e));
}

// Baixa uma página HTML pública e devolve o texto limpo, os links e os e-mails visíveis.
export async function lerPagina(endereco: string, limiteTexto = 30_000): Promise<Pagina> {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(endereco) ? endereco : 'https://' + endereco); } catch { throw new ErroWeb('Endereço inválido.'); }
  if (!/^https?:$/.test(url.protocol)) throw new ErroWeb('Só endereços http ou https.');
  if (!(await permitido(url))) throw new ErroWeb(`O robots.txt de ${url.host} não permite ler esta página.`);
  let r: Response;
  try { r = await fetch(url, { headers: { 'User-Agent': ROBO, Accept: 'text/html' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' }); }
  catch { throw new ErroWeb(`Não consegui abrir ${url.host} (fora do ar ou lento demais).`); }
  if (r.status === 401 || r.status === 403) throw new ErroWeb('Página com acesso restrito: não lemos área com login.');
  if (!r.ok) throw new ErroWeb(`A página respondeu ${r.status}.`);
  if (!/html/i.test(r.headers.get('content-type') ?? '')) throw new ErroWeb('Não é uma página HTML.');
  const html = (await r.text()).slice(0, 800_000);
  const final = new URL(r.url || url.href);
  const titulo = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const links = [...new Set([...html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(m[1], final).href; } catch { return ''; } }).filter((h) => /^https?:/.test(h)))].slice(0, 400);
  const texto = html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|br|section|article|td)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const emails = [...new Set([...[...(html.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g))].map((m) => m[0]), ...emailsCloudflare(html)].map((m) => m.toLowerCase().replace(/^(u00[0-9a-f]{2})+/, '')).filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/sentry|wixpress|example\.|exemplo\./.test(e)))].slice(0, 20);
  return { url: final.href, titulo, texto: texto.slice(0, limiteTexto), links, emails };
}

export const dominioDe = (site: string | null | undefined) => {
  if (!site) return null;
  try { return new URL(/^https?:\/\//i.test(site) ? site : 'https://' + site).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};

// Primeiro objeto JSON dentro de um texto de modelo (às vezes vem cercado de explicação ou ```).
export function jsonDe<T>(texto: string): T {
  const ini = texto.indexOf('{'), fim = texto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('O modelo não devolveu JSON.');
  return JSON.parse(texto.slice(ini, fim + 1)) as T;
}
