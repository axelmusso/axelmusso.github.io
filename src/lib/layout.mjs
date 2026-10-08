// Estrutura comum das páginas: cabeçalho, rodapé, banner de rascunho, seletor de idioma e botões.
import { esc, state } from './util.mjs';
import { head } from './seo.mjs';
import { META, langSwitch } from './i18n.mjs';

export const AR = '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
// Logo oficial (ƆQ com barra), redesenhado em vetor a partir do arquivo da marca.
export const LOGO = '<svg viewBox="121 32 683 408" aria-hidden="true"><path fill="#3570AF" d="M131.3 134A157 157 0 1 1 131.3 246H198.8A97 97 0 1 0 198.8 134Z"/><circle cx="647" cy="189" r="127" fill="none" stroke="#E92D2B" stroke-width="60"/><path fill="#E92D2B" d="M697 227L796 301L766 341L667 267Z"/><rect x="121" y="378" width="683" height="62" fill="#3570AF"/></svg>';

export const waUrl = (site, msg) =>
  `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(msg || 'Olá! Vim pelo site da Corquímica e gostaria de falar com o comercial.')}`;

export const pb = (label, href, cls = '', external = false) =>
  `<a class="pb ${cls}" href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${label} <i>${AR}</i></a>`;
export const waBtn = (ctx, label, msg, cls = '') => pb(label, waUrl(ctx.site, msg), `wa ${cls}`, true);

export function layout(ctx, page) {
  const { site, families, segments, hasArticles, t, r, lang } = ctx;
  const showArticles = hasArticles && lang === 'pt';
  const cur = (p) => (page.path === p ? ' aria-current="page"' : '');
  const noindex = state.mode === 'staging' || page.noindex;
  const prodLinks = families.map((f) => `<a href="${r.fam(f)}"${cur(r.fam(f))}>${esc(f.n)}</a>`).join('');
  const segLinks = segments.map((s) => `<a href="${r.seg(s)}"${cur(r.seg(s))}>${esc(s.n)}</a>`).join('');
  const sb = ctx.supabase;
  const country = t.country ? `, ${esc(t.country)}` : '';
  return `<!doctype html>
<html lang="${META[lang].html}">
<head>
${head(ctx, { ...page, noindex })}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/main.css?v=${ctx.cssHash}">
${page.withForm ? `<meta name="cq-wa" content="${site.whatsapp}">${sb.url ? `<meta name="cq-supabase-url" content="${esc(sb.url)}"><meta name="cq-supabase-key" content="${esc(sb.key)}">` : ''}
<script src="/assets/lead.js?v=${ctx.jsHash}" defer></script>` : ''}
</head>
<body class="${page.bodyClass || ''}">
<a class="skip" href="#conteudo">${esc(t.skip)}</a>
${state.mode === 'staging' ? `<div class="stagingbar">${esc(state.awaitingDomain ? t.stagingDomain : t.stagingPending)}</div>` : ''}
<header class="site"><div class="wrap">
  <a class="logo" href="${r.home}" aria-label="${esc(t.logoAria)}">${LOGO}<span>Corquímica</span></a>
  <input type="checkbox" id="mt" class="mt" aria-label="${esc(t.menuAria)}">
  <label for="mt" class="burger" aria-hidden="true"><span></span></label>
  <nav class="main" aria-label="${esc(t.navAria)}">
    <a class="l" href="${r.about}"${cur(r.about)}>${esc(t.navAbout)}</a>
    <div class="dd"><a class="l" href="${r.products}"${cur(r.products)}>${esc(t.navProducts)}</a><div class="panel">${prodLinks}</div></div>
    <div class="dd"><a class="l" href="${r.industries}"${cur(r.industries)}>${esc(t.navIndustries)}</a><div class="panel">${segLinks}</div></div>
    ${showArticles ? `<a class="l" href="${r.articles}"${cur(r.articles)}>${esc(t.navArticles)}</a>` : ''}
    <a class="l" href="${r.contact}"${cur(r.contact)}>${esc(t.navContact)}</a>
  </nav>
  ${langSwitch(lang, page.alt || {})}
</div></header>
<main id="conteudo">
${page.body}
</main>
<footer class="site"><div class="wrap"><div class="fg">
  <div><a class="logo" href="${r.home}" style="font-size:24px">${LOGO}<span>Corquímica</span></a>
    <p class="fsmall">${esc(site.description)}</p>
    <address class="fsmall">${esc(site.address.street)}, ${esc(site.address.district)}<br>${esc(site.address.city)}, ${esc(site.address.region)}${country}</address></div>
  <div class="col"><b>${esc(t.fContact)}</b>
    <a href="${esc(waUrl(site, t.waDefault))}" target="_blank" rel="noopener">WhatsApp: ${esc(site.whatsappDisplay)}</a>
    <a href="tel:${site.phone}">${esc(t.fPhone)}: ${esc(site.phoneDisplay)}</a>
    <a href="mailto:${site.email}">${esc(site.email)}</a>
    <a href="${r.contact}">${esc(t.fAllContacts)}</a></div>
  <div class="col"><b>${esc(t.fProducts)}</b>${prodLinks}</div>
  <div class="col"><b>${esc(t.fIndustries)}</b>${segLinks}<b style="margin-top:14px">${esc(t.fCompany)}</b><a href="${r.about}">${esc(t.fAbout)}</a>${showArticles ? `<a href="${r.articles}">${esc(t.navArticles)}</a>` : ''}<a href="${r.privacy}">${esc(t.fPrivacy)}</a></div>
</div><p class="copy">© ${new Date().getFullYear()} ${esc(site.legalName)}</p></div></footer>
<a class="pb wa sm wa-float" href="${esc(waUrl(site, t.waDefault))}" target="_blank" rel="noopener" aria-label="${esc(t.waFloat)}">${esc(t.waFloat)} <i>${AR}</i></a>
</body>
</html>
`;
}
