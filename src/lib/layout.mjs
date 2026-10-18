// Estrutura comum das páginas: cabeçalho, rodapé, banner de rascunho, seletor de idioma e botões.
import { esc, state } from './util.mjs';
import { head } from './seo.mjs';
import { META, langSwitch } from './i18n.mjs';

export const AR = '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
// Logo oficial (ƆQ com barra), redesenhado em vetor a partir do arquivo da marca.
export const LOGO = '<svg viewBox="121 32 683 408" aria-hidden="true"><path fill="#3570AF" d="M131.3 134A157 157 0 1 1 131.3 246H198.8A97 97 0 1 0 198.8 134Z"/><circle cx="647" cy="189" r="127" fill="none" stroke="#E92D2B" stroke-width="60"/><path fill="#E92D2B" d="M697 227L796 301L766 341L667 267Z"/><rect x="121" y="378" width="683" height="62" fill="#3570AF"/></svg>';

export const igUrl = (site) => `https://www.instagram.com/${site.instagram}/`;

// Ícones de contato do rodapé (contorno, na cor do texto).
const ic = (d) => `<svg class="cic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  wa: ic('<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 8.6c.3-.6.6-.6.9-.6h.6c.2 0 .4.1.5.4l.7 1.7c.1.2 0 .4-.1.6l-.5.6c-.1.2-.1.4 0 .5.6 1 1.5 1.9 2.5 2.4.2.1.4.1.5-.1l.6-.7c.1-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5 0 .6-.3 1.3-.9 1.6-.6.3-1.5.4-2.6 0-1.6-.6-3.3-2.1-4.2-3.8-.6-1.1-.8-2.2-.5-2.8z" fill="currentColor" stroke="none"/>'),
  tel: ic('<path d="M5 4h3.2l1.6 4-2 1.3a11 11 0 0 0 4.9 4.9l1.3-2 4 1.6V17a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
  mail: ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6l8.5 7 8.5-7"/>'),
  ig: ic('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/>'),
};

export const waUrl = (site, msg) =>
  `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(msg || 'Olá! Vim pelo site da Corquímica e gostaria de falar com o comercial.')}`;

export const pb = (label, href, cls = '', external = false) =>
  `<a class="pb ${cls}" href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${label} <i>${AR}</i></a>`;
export const waBtn = (ctx, label, msg, cls = '') => pb(label, waUrl(ctx.site, msg), `wa ${cls}`, true);

// Alterna o fundo das seções entre dois tons (branco e azul bem claro) para marcar a troca de assunto.
// O banner e os blocos azul-marinho ficam como estão e não entram na alternância.
// A primeira seção (depois do banner da home ou do topo branco das páginas internas) começa no tom azul-claro.
function toneSections(body, startAlt = true) {
  let alt = startAlt;
  return body.replace(/<section class="sec([^"]*)"([^>]*)>(\s*<div class="(wrap two|wrap"><div class="cta2)")?/g, (m, cls, rest, inner) => {
    if (/\bhero\b/.test(cls)) return m;
    if (inner && inner.includes('wrap two')) return m; // bloco azul-marinho do formulário
    if (inner && inner.includes('cta2')) return m.replace('class="sec' + cls + '"', 'class="sec' + cls + ' tone-end"'); // "Vamos conversar"
    const tone = alt ? ' tone-alt' : ' tone-base';
    alt = !alt;
    return m.replace('class="sec' + cls + '"', 'class="sec' + cls + tone + '"');
  });
}

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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap">
<link rel="stylesheet" href="/assets/main.css?v=${ctx.cssHash}">
<script src="/assets/theme.js?v=${ctx.themeHash}"></script>
${sb.url ? `<meta name="cq-supabase-url" content="${esc(sb.url)}"><meta name="cq-supabase-key" content="${esc(sb.key)}">
<script src="/assets/visita.js?v=${ctx.visitaHash}" defer></script>` : ''}
${page.withForm ? `<meta name="cq-wa" content="${site.whatsapp}">
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
  <button type="button" class="theme-toggle" data-to-dark="${esc(t.themeToDark)}" data-to-light="${esc(t.themeToLight)}" aria-label="${esc(t.themeToDark)}" hidden><svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg><svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg></button>
  ${langSwitch(lang, page.alt || {})}
</div></header>
<main id="conteudo">
${toneSections(page.body, true)}
</main>
<footer class="site"><div class="wrap"><div class="fg">
  <div><a class="logo" href="${r.home}" style="font-size:24px">${LOGO}<span>Corquímica</span></a>
    <p class="fsmall">${esc(site.description)}</p>
    <address class="fsmall">${esc(site.address.street)}, ${esc(site.address.district)}<br>${esc(site.address.city)}, ${esc(site.address.region)}${country}</address></div>
  <div class="col"><b>${esc(t.fContact)}</b>
    <a class="ci" href="${esc(waUrl(site, t.waDefault))}" target="_blank" rel="noopener" aria-label="WhatsApp: ${esc(site.whatsappDisplay)}">${ICON.wa}${esc(site.whatsappDisplay)}</a>
    <a class="ci" href="tel:${site.phone}" aria-label="${esc(t.fPhone)}: ${esc(site.phoneDisplay)}">${ICON.tel}${esc(site.phoneDisplay)}</a>
    <a class="ci" href="mailto:${site.email}" aria-label="${esc(t.emailLbl)}: ${esc(site.email)}">${ICON.mail}${esc(site.email)}</a>
    <a class="ci" href="${igUrl(site)}" target="_blank" rel="noopener" aria-label="${esc(t.igFollow)}: @${esc(site.instagram)}">${ICON.ig}@${esc(site.instagram)}</a>
    <a href="${r.contact}">${esc(t.fAllContacts)}</a></div>
  <div class="col"><b>${esc(t.fProducts)}</b>${prodLinks}</div>
  <div class="col"><b>${esc(t.fIndustries)}</b>${segLinks}<b style="margin-top:14px">${esc(t.fCompany)}</b><a href="${r.about}">${esc(t.fAbout)}</a>${showArticles ? `<a href="${r.articles}">${esc(t.navArticles)}</a>` : ''}<a href="${r.privacy}">${esc(t.fPrivacy)}</a></div>
</div><p class="copy">© ${new Date().getFullYear()} ${esc(site.legalName)}</p></div></footer>
<a class="pb wa sm wa-float" href="${esc(waUrl(site, t.waDefault))}" target="_blank" rel="noopener" aria-label="${esc(t.waFloat)}">${esc(t.waFloat)} <i>${AR}</i></a>
</body>
</html>
`;
}
