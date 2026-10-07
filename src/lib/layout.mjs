// Estrutura comum das páginas: cabeçalho, rodapé, banner de rascunho e botões.
import { esc, state } from './util.mjs';
import { head, abs } from './seo.mjs';

export const AR = '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
// Logo oficial (ƆQ com barra), redesenhado em vetor a partir do arquivo da marca.
export const LOGO = '<svg viewBox="121 32 683 408" aria-hidden="true"><path fill="#3570AF" d="M131.3 134A157 157 0 1 1 131.3 246H198.8A97 97 0 1 0 198.8 134Z"/><circle cx="647" cy="189" r="127" fill="none" stroke="#E92D2B" stroke-width="60"/><path fill="#E92D2B" d="M697 227L796 301L766 341L667 267Z"/><rect x="121" y="378" width="683" height="62" fill="#3570AF"/></svg>';

export const waUrl = (site, msg) =>
  `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(msg || 'Olá! Vim pelo site da Corquímica e gostaria de falar com o comercial.')}`;

export const pb = (label, href, cls = '', external = false) =>
  `<a class="pb ${cls}" href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${label} <i>${AR}</i></a>`;
export const waBtn = (ctx, label, msg, cls = '') => pb(label, waUrl(ctx.site, msg), `wa ${cls}`, true);

export function layout(ctx, page) {
  const { site, families, segments, hasArticles } = ctx;
  const cur = (p) => (page.path === p ? ' aria-current="page"' : '');
  const noindex = state.mode === 'staging' || page.noindex;
  const prodLinks = families.map((f) => `<a href="/produtos/${f.id}/"${cur(`/produtos/${f.id}/`)}>${esc(f.n)}</a>`).join('');
  const segLinks = segments.map((s) => `<a href="/segmentos/${s.id}/"${cur(`/segmentos/${s.id}/`)}>${esc(s.n)}</a>`).join('');
  const sb = ctx.supabase;
  return `<!doctype html>
<html lang="pt-BR">
<head>
${head(site, { ...page, noindex })}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/main.css?v=${ctx.cssHash}">
${page.withForm ? `<meta name="cq-wa" content="${site.whatsapp}">${sb.url ? `<meta name="cq-supabase-url" content="${esc(sb.url)}"><meta name="cq-supabase-key" content="${esc(sb.key)}">` : ''}
<script src="/assets/lead.js?v=${ctx.jsHash}" defer></script>` : ''}
</head>
<body class="${page.bodyClass || ''}">
<a class="skip" href="#conteudo">Ir para o conteúdo</a>
${state.mode === 'staging' ? '<div class="stagingbar">RASCUNHO: esta versão não é indexada pelo Google e mostra marcações de itens a validar e fotos pendentes.</div>' : ''}
<header class="site"><div class="wrap">
  <a class="logo" href="/" aria-label="Corquímica, página inicial">${LOGO}<span>Corquímica</span></a>
  <input type="checkbox" id="mt" class="mt" aria-label="Abrir menu">
  <label for="mt" class="burger" aria-hidden="true"><span></span></label>
  <nav class="main" aria-label="Principal">
    <a class="l" href="/sobre/"${cur('/sobre/')}>Sobre</a>
    <div class="dd"><a class="l" href="/produtos/"${cur('/produtos/')}>Produtos</a><div class="panel">${prodLinks}</div></div>
    <div class="dd"><a class="l" href="/segmentos/"${cur('/segmentos/')}>Segmentos</a><div class="panel">${segLinks}</div></div>
    ${hasArticles ? `<a class="l" href="/conteudo-tecnico/"${cur('/conteudo-tecnico/')}>Conteúdo técnico</a>` : ''}
    <a class="l" href="/contato/"${cur('/contato/')}>Contato</a>
    <a class="pb out sm" href="${esc(waUrl(site))}" target="_blank" rel="noopener">WhatsApp <i>${AR}</i></a>
  </nav>
</div></header>
<main id="conteudo">
${page.body}
</main>
<footer class="site"><div class="wrap"><div class="fg">
  <div><a class="logo" href="/" style="font-size:24px">${LOGO}<span>Corquímica</span></a>
    <p class="fsmall">${esc(site.description)}</p>
    <address class="fsmall">${esc(site.address.street)}, ${esc(site.address.district)}<br>${esc(site.address.city)}, ${esc(site.address.region)}</address></div>
  <div class="col"><b>Contato</b>
    <a href="${esc(waUrl(site))}" target="_blank" rel="noopener">WhatsApp: ${esc(site.whatsappDisplay)}</a>
    <a href="tel:${site.phone}">Telefone: ${esc(site.phoneDisplay)}</a>
    <a href="mailto:${site.email}">${esc(site.email)}</a>
    <a href="/contato/">Todos os contatos</a></div>
  <div class="col"><b>Produtos</b>${prodLinks}</div>
  <div class="col"><b>Segmentos</b>${segLinks}<b style="margin-top:14px">Empresa</b><a href="/sobre/">Sobre a Corquímica</a>${hasArticles ? '<a href="/conteudo-tecnico/">Conteúdo técnico</a>' : ''}<a href="/politica-de-privacidade/">Política de privacidade</a></div>
</div><p class="copy">© ${new Date().getFullYear()} ${esc(site.legalName)}</p></div></footer>
<a class="pb wa sm wa-float" href="${esc(waUrl(site))}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">Falar no WhatsApp <i>${AR}</i></a>
</body>
</html>
`;
}
