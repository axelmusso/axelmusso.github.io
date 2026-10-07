// Verificações automáticas de SEO e integridade. Uso: node tests/check.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const site = JSON.parse(fs.readFileSync(path.join(DIST, '..', 'src/data/site.json'), 'utf8'));
const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
const staging = /Disallow: \/\s*$/m.test(robots);
const errs = [], warns = [];
const err = (m) => errs.push(m), warn = (m) => warns.push(m);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(DIST);
const exists = (u) => { const p = u.split('#')[0].split('?')[0]; if (!p) return true; const f = path.join(DIST, p); return (fs.existsSync(f) && fs.statSync(f).isFile()) || fs.existsSync(path.join(f, 'index.html')); };
const urlOf = (f) => '/' + path.relative(DIST, f).replace(/index\.html$/, '').replace(/\\/g, '/');
const pages = files.filter((f) => f.endsWith('.html')).map((f) => ({ f, url: urlOf(f), html: fs.readFileSync(f, 'utf8') }));
const isStub = (p) => /http-equiv="refresh"/.test(p.html);
const real = pages.filter((p) => !isStub(p));
const titles = new Map(), descs = new Map();
for (const p of real) {
  const h = p.html, u = p.url, noindex = /name="robots" content="noindex/.test(h);
  const m = (re) => (h.match(re) || [])[1];
  const title = m(/<title>([^<]*)<\/title>/), desc = m(/<meta name="description" content="([^"]*)"/), canon = m(/<link rel="canonical" href="([^"]*)"/);
  if (!/<html lang="pt-BR">/.test(h)) err(`${u}: falta lang pt-BR`);
  if (!title) err(`${u}: sem title`); else { if (title.length > 65) warn(`${u}: title com ${title.length} caracteres`); if (titles.has(title)) err(`${u}: title duplicado com ${titles.get(title)}`); titles.set(title, u); }
  if (!desc) err(`${u}: sem description`); else { if (desc.length < 70 || desc.length > 175) warn(`${u}: description com ${desc.length} caracteres`); if (descs.has(desc)) err(`${u}: description duplicada com ${descs.get(desc)}`); descs.set(desc, u); }
  const expected = site.url + (u.endsWith('.html') ? u : u);
  if (u !== '/404.html' && canon !== expected) err(`${u}: canonical ${canon} (esperado ${expected})`);
  const h1 = (h.match(/<h1[ >]/g) || []).length; if (h1 !== 1) err(`${u}: ${h1} tags h1`);
  if (!staging && !noindex && /noindex/.test(h)) err(`${u}: noindex em produção`);
  if (staging && !/noindex/.test(h)) err(`${u}: rascunho sem noindex`);
  if (!staging && /\[VALIDAR|class="pend"|FOTO REAL/.test(h)) err(`${u}: marca de pendência em produção`);
  for (const [, j] of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { const o = JSON.parse(j); if (!o['@graph']) err(`${u}: JSON-LD sem @graph`); } catch (e) { err(`${u}: JSON-LD inválido`); } }
  if (!/"@type":"Organization"/.test(h)) err(`${u}: sem Organization`);
  if (u !== '/' && u !== '/404.html' && !/"@type":"BreadcrumbList"/.test(h)) err(`${u}: sem BreadcrumbList`);
  if (/\/produtos\/[^/]+\/$|\/segmentos\/[^/]+\/$/.test(u) && !/"@type":"FAQPage"/.test(h)) err(`${u}: sem FAQPage`);
  if (/\/(produtos|segmentos)\/[^/]+\/$/.test(u) && (h.match(/<details/g) || []).length < 4) warn(`${u}: menos de 4 perguntas no FAQ`);
  for (const [, href] of h.matchAll(/(?:href|src)="(\/[^"]*)"/g)) { const hh = href.replace(/\?v=\w+$/, ''); if (!exists(hh)) err(`${u}: link quebrado ${href}`); }
  if (/latão|latao/i.test(text(h))) err(`${u}: menciona latão`);
  if (/ficha técnica/i.test(text(h))) warn(`${u}: menciona ficha técnica`);
  if (!/wa\.me\/5551992405746/.test(h) && u !== '/404.html') err(`${u}: sem link do WhatsApp`);
}
function text(h) { return h.replace(/<script[\s\S]*?<\/script>/g, ''); }
// sitemap
const sm = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
for (const l of locs) { if (!l.startsWith(site.url)) err(`sitemap: URL fora do domínio ${l}`); if (!exists(l.slice(site.url.length))) err(`sitemap: ${l} não existe`); }
for (const p of real) { if (/noindex/.test(p.html) || p.url === '/404.html') continue; if (!locs.includes(site.url + p.url)) err(`${p.url}: fora do sitemap`); }
for (const p of ['llms.txt', 'llms-full.txt', 'robots.txt', 'favicon.svg', 'og-default.png']) if (!fs.existsSync(path.join(DIST, p))) err(`falta ${p}`);
if (!staging && !/Sitemap:/.test(robots)) err('robots.txt sem Sitemap');
// páginas obrigatórias
for (const u of ['/', '/sobre/', '/contato/', '/produtos/', '/segmentos/', ...['verniz-uv-base', 'verniz-uv-top-coat', 'lacas', 'tintas-abs-ps', 'tintas-piso', 'corantes-uv', 'solventes'].map((x) => `/produtos/${x}/`), ...['moda', 'moveleiro', 'automotivo', 'cosmeticos', 'plasticos'].map((x) => `/segmentos/${x}/`)]) if (!real.some((p) => p.url === u)) err(`falta a página ${u}`);
console.log(`Modo: ${staging ? 'RASCUNHO' : 'PRODUÇÃO'} · ${real.length} páginas · ${locs.length} URLs no sitemap`);
warns.forEach((w) => console.log('aviso:', w));
if (errs.length) { errs.forEach((e) => console.log('ERRO:', e)); console.log(`\n${errs.length} erro(s)`); process.exit(1); }
console.log('Todas as verificações passaram.');
