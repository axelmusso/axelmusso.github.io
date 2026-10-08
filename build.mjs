// Gerador do site estático da Corquímica. Sem dependências: só Node 20+.
// Uso: node build.mjs   (variáveis opcionais: SUPABASE_URL, SUPABASE_ANON_KEY, FORCE_PRODUCTION=1, INCLUDE_DRAFTS=1, CUSTOM_DOMAIN=corquimica.com.br)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { state, scanPhotos, setPhotoMeta, photoFiles, plain, esc } from './src/lib/util.mjs';
import { layout } from './src/lib/layout.mjs';
import { abs } from './src/lib/seo.mjs';
import * as P from './src/lib/pages.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const R = (...p) => path.join(ROOT, ...p);
const J = (f) => JSON.parse(fs.readFileSync(R('src/data', f), 'utf8'));
const hash = (f) => crypto.createHash('md5').update(fs.readFileSync(R(f))).digest('hex').slice(0, 8);

const site = J('site.json');
const families = J('families.json');
const segments = J('segments.json');
const faqGeral = J('faq-geral.json');
const redirects = J('redirects.json');
const photosMeta = J('photos.json');
setPhotoMeta(photosMeta);
scanPhotos(R('src/assets/photos'));

const pub = fs.existsSync(R('src/data/supabase.public.json')) ? JSON.parse(fs.readFileSync(R('src/data/supabase.public.json'), 'utf8')) : {};
const SB_URL = (process.env.SUPABASE_URL || pub.url || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_ANON_KEY || pub.anonKey || '';

async function loadArticles() {
  if (SB_URL && SB_KEY) {
    try {
      const now = new Date().toISOString();
      const q = `${SB_URL}/rest/v1/articles?select=*&published=eq.true&published_at=lte.${encodeURIComponent(now)}&order=published_at.desc`;
      const res = await fetch(q, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      console.log(`Supabase: ${rows.length} artigo(s) publicado(s).`);
      return rows;
    } catch (e) {
      console.warn('AVISO: não consegui ler os artigos do Supabase (' + e.message + '). Usando o arquivo local.');
    }
  }
  const seed = JSON.parse(fs.readFileSync(R('src/data/articles.seed.json'), 'utf8'));
  return seed.filter((a) => a.published || process.env.INCLUDE_DRAFTS === '1');
}

const articles = await loadArticles();
const ctx = {
  site, families, segments, faqGeral, articles, hasArticles: articles.length > 0,
  supabase: { url: SB_URL, key: SB_KEY },
  cssHash: hash('src/styles/main.css'), jsHash: hash('src/scripts/lead.js'),
};

function buildPages() {
  const list = [];
  const add = (fn) => { state.page = '?'; const p = fn(); list.push(p); return p; };
  const mk = (p, fn) => { state.page = p; return fn(); };
  list.push(mk('/', () => P.home(ctx)));
  list.push(mk('/sobre/', () => P.sobre(ctx)));
  list.push(mk('/produtos/', () => P.produtosHub(ctx)));
  for (const f of families) list.push(mk(`/produtos/${f.id}/`, () => P.familia(ctx, f)));
  list.push(mk('/segmentos/', () => P.segmentosHub(ctx)));
  for (const s of segments) list.push(mk(`/segmentos/${s.id}/`, () => P.segmento(ctx, s)));
  if (ctx.hasArticles) {
    list.push(mk('/conteudo-tecnico/', () => P.artigosHub(ctx)));
    for (const a of articles) list.push(mk(`/conteudo-tecnico/${a.slug}/`, () => P.artigo(ctx, a)));
  }
  list.push(mk('/contato/', () => P.contato(ctx)));
  list.push(mk('/politica-de-privacidade/', () => P.privacidade(ctx)));
  list.push(mk('/404.html', () => P.notFound(ctx)));
  for (const p of list) { state.page = p.path; p.html = layout(ctx, p); }
  return list;
}
function resetPending() { state.pendingText = []; state.pendingPhotos = new Set(); }

// Passo 1: rascunho, só para descobrir o que ainda está pendente.
state.mode = 'staging'; resetPending();
buildPages();
const pendText = state.pendingText.slice();
const pendPhotos = [...state.pendingPhotos];
// Só indexa no domínio oficial: sem CUSTOM_DOMAIN igual ao domínio de site.json, o site segue em rascunho.
const domainReady = (process.env.CUSTOM_DOMAIN || '').trim() === new URL(site.url).host;
state.awaitingDomain = pendText.length === 0 && pendPhotos.length === 0 && !domainReady;
const goLive = process.env.FORCE_PRODUCTION === '1' || (pendText.length === 0 && pendPhotos.length === 0 && domainReady);
state.mode = goLive ? 'production' : 'staging';
resetPending();
const pages = buildPages();
const mode = state.mode;

// ---------- saída ----------
const OUT = R('dist');
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const outPath = (p) => (p.endsWith('.html') ? p.slice(1) : p.slice(1) + 'index.html');

for (const p of pages) write(outPath(p.path), p.html);
write('assets/main.css', fs.readFileSync(R('src/styles/main.css')));
write('assets/lead.js', fs.readFileSync(R('src/scripts/lead.js')));
if (fs.existsSync(R('public'))) for (const f of fs.readdirSync(R('public'))) fs.copyFileSync(R('public', f), path.join(OUT, f));
for (const [, file] of photoFiles) write('img/' + file, fs.readFileSync(R('src/assets/photos', file)));
write('.nojekyll', '');
if (process.env.CUSTOM_DOMAIN) write('CNAME', process.env.CUSTOM_DOMAIN + '\n');

// sitemap (apenas páginas indexáveis)
const indexable = pages.filter((p) => !p.noindex && p.path !== '/404.html');
const lastmod = (p) => (p.graph?.find((g) => g.dateModified && g['@type'] === 'Article')?.dateModified) || site.contentUpdated;
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((p) => `  <url><loc>${abs(site, p.path)}</loc><lastmod>${lastmod(p)}</lastmod></url>`).join('\n')}\n</urlset>\n`);

// robots
const AI = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'Googlebot'];
write('robots.txt', mode === 'staging'
  ? '# RASCUNHO: não indexar\nUser-agent: *\nDisallow: /\n'
  : `User-agent: *\nAllow: /\n\n${AI.map((b) => `User-agent: ${b}\nAllow: /\n`).join('\n')}\nSitemap: ${abs(site, '/sitemap.xml')}\n`);

// llms.txt / llms-full.txt
const text = (html) => html.replace(/<form[\s\S]*?<\/form>/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<\/(p|h\d|li|tr|div|summary|details)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const line = (p) => `- [${plain(p.title)}](${abs(site, p.path)}): ${plain(p.description)}`;
const sect = (title, arr) => `## ${title}\n${arr.map(line).join('\n')}\n`;
const by = (re) => indexable.filter((p) => re.test(p.path));
write('llms.txt', `# ${site.name}\n\n> ${site.description}\n\nEmpresa: ${site.legalName}, desde ${site.foundingYear}. Contato comercial: WhatsApp ${site.whatsappDisplay}, telefone ${site.phoneDisplay}, ${site.email}. Endereço: ${site.address.street}, ${site.address.city}, ${site.address.region}.\n\n${sect('Empresa', indexable.filter((p) => ['/', '/sobre/', '/contato/'].includes(p.path)))}\n${sect('Famílias de produto', by(/^\/produtos\/[^/]+\/$/))}\n${sect('Segmentos', by(/^\/segmentos\/[^/]+\/$/))}\n${ctx.hasArticles ? sect('Conteúdo técnico', by(/^\/conteudo-tecnico\//)) : ''}`);
write('llms-full.txt', `# ${site.name}: conteúdo completo\n\n` + indexable.map((p) => `\n---\n# ${plain(p.title)}\nURL: ${abs(site, p.path)}\n\n${text(p.body)}`).join('\n') + '\n');

// redirecionamentos do site antigo
const real = new Set(pages.map((p) => p.path));
let nRed = 0; const rlines = [];
for (const [from, to] of Object.entries(redirects)) {
  if (real.has(from)) continue;
  const f = from.endsWith('/') ? from + 'index.html' : from.replace(/^\//, '') ? from + '/index.html' : null;
  if (!f) continue;
  const target = abs(site, to);
  write(f.slice(1), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Página movida | Corquímica</title><link rel="canonical" href="${esc(target)}"><meta http-equiv="refresh" content="0; url=${esc(target)}">${mode === 'staging' ? '<meta name="robots" content="noindex">' : ''}</head><body><p>Esta página mudou. <a href="${esc(to)}">Clique aqui</a>.</p></body></html>`);
  rlines.push(`${from} ${to} 301`); nRed++;
}
write('_redirects', rlines.join('\n') + '\n');

// documentos de apoio
fs.mkdirSync(R('docs'), { recursive: true });
const photoDoc = Object.entries(photosMeta).map(([slot, m]) => `- [${photoFiles.has(slot) ? 'x' : ' '}] \`${slot}\` (${m.ratio}): ${m.shot}\n  - arquivo: \`src/assets/photos/${slot}.webp\` (ou .jpg) · alt: ${m.alt}`).join('\n');
fs.writeFileSync(R('docs/FOTOS.md'), `# Lista de fotos\n\nSalve cada foto com o nome do "slot" em \`src/assets/photos/\`. Use fotos reais da fábrica, de peças e de aplicação. Até 200 KB cada, largura mínima de 1600 px.\n\n${photoDoc}\n`);
fs.writeFileSync(R('docs/PALAVRAS-CHAVE.md'), `# Mapa de palavras-chave por página\n\nBase: títulos e buscas dos concorrentes e pesquisa no Google. O Google Trends não pôde ser consultado nesta sessão. Confirme volumes no Google Search Console e no Planejador de Palavras-chave.\n\n| Página | Title | Palavras-chave principais |\n|---|---|---|\n${[...families.map((f) => [`/produtos/${f.id}/`, f.title, f.kw]), ...segments.map((s) => [`/segmentos/${s.id}/`, s.title, s.kw])].map(([u, t, k]) => `| ${u} | ${plain(t)} | ${k.join(', ')} |`).join('\n')}\n`);
fs.writeFileSync(R('docs/PENDENCIAS.md'), `# Pendências para publicar com indexação\n\nModo atual do build: **${mode}**.\n\n## Textos a validar (${pendText.length})\n${pendText.map((x) => `- \`${x.page}\`: ${x.text}`).join('\n') || '- nenhum'}\n\n## Fotos que faltam (${pendPhotos.length})\n${pendPhotos.map((s) => `- \`${s}\``).join('\n') || '- nenhuma'}\n\n## Domínio\n${domainReady ? '- configurado' : `- falta configurar \`${new URL(site.url).host}\` (variável \`CUSTOM_DOMAIN\` no GitHub e DNS no Registro.br)`}\n`);

console.log(`\nBuild: ${pages.length} páginas, ${nRed} redirecionamentos, modo ${mode.toUpperCase()}`);
if (mode === 'staging') console.log(state.awaitingDomain ? `Rascunho (noindex): conteúdo completo, aguardando o domínio ${new URL(site.url).host} (variável CUSTOM_DOMAIN).` : `Rascunho (noindex): ${pendText.length} texto(s) a validar, ${pendPhotos.length} foto(s) pendente(s). Veja docs/PENDENCIAS.md`);
