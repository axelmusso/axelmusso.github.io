// Modelos de página. Cada função devolve { key, path, title, description, body, graph, ... }.
// ctx traz o idioma: ctx.lang, ctx.t (textos de interface), ctx.r (caminhos) e o conteúdo já traduzido.
import { esc, txt, plain, md, photo, photoBg, photoSwap } from './util.mjs';
import { AR, pb, waBtn, waUrl } from './layout.mjs';
import { breadcrumbNode, faqNode, pageNode, abs } from './seo.mjs';
import { monthYear } from './i18n.mjs';

const faq = (list, open = false) => {
  const item = ([q, a], i) => `<details class="faq"${open && i === 0 ? ' open' : ''}><summary>${txt(q)}</summary><p>${txt(a)}</p></details>`;
  const half = Math.ceil(list.length / 2);
  // Duas colunas fixas (não reorganizam ao abrir uma pergunta).
  return `<div class="faq-cols"><div>${list.slice(0, half).map(item).join('\n')}</div><div>${list.slice(half).map((x, i) => item(x, i + half)).join('\n')}</div></div>`;
};
// Números (página Sobre).
const stats = (ctx) => { const s = ctx.t.stats; return `<div class="sc"><div class="sq"><b>+${ctx.site.clients}</b><span>${s.clients}</span></div><div class="sq"><b>+${ctx.site.tonsPerYear}&nbsp;t</b><span>${s.tons}</span></div><div class="sq"><b>${ctx.families.length}</b><span>${s.families}</span></div><div class="sq"><b>2</b><span>${s.continents}</span></div><div class="sq"><b>${ctx.site.foundingYear}</b><span>${s.founded}</span></div></div>`; };
// Lista de itens em grade (características, aplicações).
const prGrid = (items) => `<div class="prgrid${items.length === 4 ? ' n4' : ''}">${items.map((x) => `<div class="pr"><i>${AR}</i><div>${txt(x)}</div></div>`).join('')}</div>`;
const crumbs = (ctx, items) =>
  `<nav class="crumbs" aria-label="${esc(ctx.t.crumbsAria)}">${items.map((it, i) => (i === items.length - 1 ? `<b>${esc(it.name)}</b>` : `<a href="${it.path}">${esc(it.name)}</a><span>/</span>`)).join('')}</nav>`;
const updated = (ctx) => `<p class="upd">${ctx.t.updated(monthYear(ctx.lang, ctx.site.contentUpdated))}</p>`;
const lead = (ctx, { product = null, pageUrl = '' } = {}) => {
  const { t } = ctx;
  // O valor gravado no Supabase fica sempre em português; o texto exibido segue o idioma.
  const mats = ['ABS', 'PS', 'PP', 'PVC', 'Zamac', 'TPU'].map((m) => `<option value="${m}">${m === 'Zamac' && ctx.lang !== 'pt' ? 'Zamak' : m}</option>`).join('') + `<option value="Outro">${esc(t.formOther)}</option>`;
  const segs = ctx.segments.map((s) => `<option value="${esc(s.nPt)}">${esc(s.n)}</option>`).join('');
  return `
<form class="sample" data-lead data-product="${esc(product ? product.id : '')}"${product ? ` data-product-name="${esc(product.n)}"` : ''} data-page="${esc(pageUrl)}" action="https://wa.me/${ctx.site.whatsapp}" method="get">
  <h3>${esc(t.formTitle)}</h3>
  <label>${esc(t.formName)}<input name="contact" type="text" autocomplete="organization" placeholder="${esc(t.formNamePh)}" required></label>
  <div class="row2">
    <label>${esc(t.formMaterial)}<select name="material">${mats}</select></label>
    <label>${esc(t.formIndustry)}<select name="segment">${segs}</select></label>
  </div>
  <label>${esc(t.formGoal)}<textarea name="message" rows="2" maxlength="600" placeholder="${esc(t.formGoalPh)}"></textarea></label>
  <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
  <label class="chk"><input type="checkbox" name="consent" required> <span>${t.formConsent(ctx.r.privacy)}</span></label>
  <button class="pb wa" type="submit">${esc(t.btnProject)} <i>${AR}</i></button>
  <p class="fine">${esc(t.formFine)}</p>
</form>`;
};
const cta = (ctx, title, sub, msg) => `<section class="sec"><div class="wrap"><div class="cta2"><span class="label">${esc(ctx.t.ctaLabel)}</span><h2>${esc(title)}</h2><p>${esc(sub)}</p>${waBtn(ctx, ctx.t.btnProject, msg)}<p class="alt">${esc(ctx.t.ctaOrCall)} <a href="tel:${ctx.site.phone}">${esc(ctx.site.phoneDisplay)}</a> · <a href="mailto:${ctx.site.email}">${esc(ctx.site.email)}</a></p></div></div></section>`;
const ICON = {
  moda: '<svg viewBox="0 0 32 32"><path d="M6 24c0-5 3-9 7-11l2-6 3 1-1 5c4 1 8 4 8 11H6z"/><path d="M4 28h24"/></svg>',
  moveleiro: '<svg viewBox="0 0 32 32"><rect x="5" y="10" width="22" height="10" rx="2"/><path d="M8 20v6M24 20v6M8 10V6h16v4"/></svg>',
  automotivo: '<svg viewBox="0 0 32 32"><path d="M4 20l3-8a3 3 0 0 1 3-2h12a3 3 0 0 1 3 2l3 8v5H4z"/><circle cx="10" cy="24" r="2"/><circle cx="22" cy="24" r="2"/></svg>',
  cosmeticos: '<svg viewBox="0 0 32 32"><rect x="11" y="4" width="10" height="5" rx="1"/><path d="M14 9v3M18 9v3"/><rect x="7" y="12" width="18" height="15" rx="3"/><path d="M12 19h8"/></svg>',
  plasticos: '<svg viewBox="0 0 32 32"><path d="M16 4l11 6v12l-11 6-11-6V10z"/><path d="M16 16l11-6M16 16L5 10M16 16v12"/></svg>',
};
const home1 = (ctx) => [{ name: ctx.t.crumbHome, path: ctx.r.home }];

/* ---------------- HOME ---------------- */
export function home(ctx) {
  const { site, families, segments, t, r } = ctx;
  const hero = photoBg('home-hero', 'linear-gradient(90deg,#0a0a3cb3 0%,#0a0a3c80 40%,#0a0a3c1f 100%)');
  const card = (slot, big, small, extra = '') => { const b = photoBg(slot); return `<div class="mc"${b.style}>${b.tag}<div><b>${big}</b>${small ? `<span>${small}</span>` : ''}</div>${extra}</div>`; };
  const famRows = families.map((f) => `<a class="fr" href="${r.fam(f)}"><span class="dash"></span><b>${esc(f.n)}</b><span>${txt(f.short)}</span></a>`).join('');
  const segRows = segments.map((s) => `<a class="row" data-seg="${s.id}" href="${r.seg(s)}"><span class="ic">${ICON[s.id]}</span><span><b>${esc(s.n)}</b><span>${txt(s.short)}</span></span></a>`).join('');
  const steps = t.steps.map(([h, p], i) => [`0${i + 1}`, h, p]);
  const latest = ctx.lang === 'pt' ? ctx.articles.slice(0, 3) : [];
  const body = `
<section class="hero"${hero.style}>${hero.tag ? '<div class="tube t2"></div><div class="tube"></div><div class="tube t3"></div>' : ''}${hero.tag}
  <div class="wrap" style="width:100%"><div class="inner">
    <h1>${esc(t.heroH1)}</h1>
    <p class="lead">${esc(t.heroLead)}</p>
    <div class="btnrow">${waBtn(ctx, t.btnProject, t.msgProject)}<a class="pb out" href="${r.products}" style="color:#fff">${esc(t.viewProducts)} <i>${AR}</i></a></div>
  </div></div>
</section>

<section class="sec" id="sobre"><div class="wrap"><div class="core essence"><div class="essence-side"><span class="label">${esc(t.essenceLabel)}</span>${photo('home-sobre')}</div><div>
  <p class="big">${t.essenceBig(site.foundingYear, site.clients)}</p>
  <hr class="rule">
  <p class="lead" style="margin-top:22px">${esc(t.essenceLead)}</p>
  <div style="margin-top:26px">${pb(esc(t.meetUs), r.about, 'sand')}</div></div></div></div></section>

<section class="sec" id="produtos"><div class="wrap"><div class="sol"><div class="glass"><span class="label">${esc(t.famLabel)}</span><h2>${esc(t.famH2)}</h2><div class="frgrid">${famRows}</div></div></div></div></section>
<section class="sec" id="segmentos"><div class="wrap"><h2 class="label">${esc(t.segLabel)}</h2><div class="float2"><div>${photoSwap('home-segmentos', segments.map((s) => ['segmento-' + s.id, s.id]))}</div><div class="rows">${segRows}</div></div></div></section>

<section class="sec"><div class="wrap"><span class="label">${esc(t.diffLabel)}</span><h2 class="sub">${esc(t.diffH2)}</h2>
<div class="mos">
  <div class="mc sand"><div><b>+${site.clients}</b><span>${esc(t.mosClients)}</span></div><span>${esc(t.mosClientsText)}</span></div>
  ${card('home-apoio-tecnico', esc(t.mosSupport), esc(t.mosSupportText))}
  <div class="mc sand"><div><b>${esc(t.mosCustom)}</b><span>${esc(t.mosCustomSub)}</span></div><span>${esc(t.mosCustomText)}</span></div>
  ${card('home-feira-internacional', esc(t.mosFairs), esc(t.mosFairsText))}
  ${card('home-laboratorio', esc(t.mosLab), esc(t.mosLabText))}
</div></div></section>



<section class="sec dark on-dark" id="processo"><div class="wrap"><span class="label">${esc(t.stepsLabel)}</span><h2 style="margin-top:18px;max-width:680px">${esc(t.stepsH2)}</h2>
<ol class="flow">${steps.map((s) => `<li><span class="n">${s[0]}</span><h3>${esc(s[1])}</h3><p>${esc(s[2])}</p></li>`).join('')}</ol>
<div class="alignbar"><span>${esc(t.stepsBar)}</span>${waBtn(ctx, t.btnProject, t.msgProject, 'sand')}</div></div></section>

<section class="sec"><div class="wrap"><div class="plans"><div class="lft"><span class="label">${esc(t.howLabel)}</span><h2>${esc(t.howH2)}</h2></div>
<div class="plan hi"><h3>${esc(t.plan1)}</h3><p>${esc(t.plan1Text)}</p><ul>${t.plan1Li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
<div class="plan"><h3>${esc(t.plan2)}</h3><p>${esc(t.plan2Text)}</p><ul>${t.plan2Li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div></div></section>

${latest.length ? `<section class="sec tint"><div class="wrap"><span class="label">${esc(t.articlesLabel)}</span><h2 style="margin:18px 0 32px">${esc(t.articlesH2)}</h2><div class="cards3">${latest.map((a) => `<a class="step light" href="${r.articles}${a.slug}/"><div><b>${esc(a.category_label || t.articleDefault)}</b><h3>${esc(a.title)}</h3></div><p>${esc(a.description)}</p></a>`).join('')}</div></div></section>` : ''}

<section class="sec" id="faq-geral"><div class="wrap faq-wrap"><div><span class="label">${esc(t.faqLabel)}</span><h2>${esc(t.faqHomeH2)}</h2><p class="lead">${esc(t.faqHomeLead)}</p></div><div>${faq(ctx.faqGeral)}</div></div></section>
${cta(ctx, t.homeCtaTitle, t.homeCtaSub, t.msgProject)}`;
  const title = t.homeTitle;
  const description = t.homeDesc;
  return { key: 'home', path: r.home, title, description, body, bodyClass: 'home',
    graph: [pageNode(ctx, { name: title, description, path: r.home }), faqNode(ctx.faqGeral)] };
}

/* ---------------- SOBRE ---------------- */
export function sobre(ctx) {
  const { site, t, r } = ctx;
  const path = r.about;
  const title = t.aboutTitle;
  const description = t.aboutDesc(site.foundingYear, site.clients);
  const bc = [...home1(ctx), { name: t.aboutCrumb, path }];
  const g = ctx.faqGeral;
  const body = `<div class="wrap">${crumbs(ctx, bc)}
<div class="ph2"><div><span class="label">${esc(t.aboutLabel)}</span><h1>${esc(t.aboutH1)}</h1>
<p class="def">${esc(t.aboutDef1(site.foundingYear, site.clients))}</p>
<p class="def" style="margin-top:14px">${esc(t.aboutDef2)}</p>
<div style="margin-top:28px">${waBtn(ctx, t.btnProject, t.aboutMsg)}</div>${updated(ctx)}</div>${photo('sobre-fabrica')}</div></div>
<section class="sec dark on-dark"><div class="wrap"><div class="stats2"><div><span class="label">${esc(t.numbersLabel)}</span><h2>${esc(t.numbersH2)}</h2></div>${stats(ctx)}</div></div></section>
<section class="sec"><div class="wrap"><div class="two"><div><span class="label">${esc(t.movesLabel)}</span><h2>${esc(t.movesH2)}</h2></div><div>
${t.moves.map(([b, x]) => `<div class="pr"><i>${AR}</i><div><b>${esc(b)}</b> ${esc(x)}</div></div>`).join('\n')}</div></div></div></section>
<section class="sec" style="padding-top:0"><div class="wrap faq-wrap"><div><span class="label">${esc(t.faqLabel)}</span><h2>${esc(t.aboutFaqH2)}</h2></div><div>${faq(g)}</div></div></section>
${cta(ctx, t.aboutCtaTitle, t.aboutCtaSub, t.aboutCtaMsg)}`;
  return { key: 'about', path, title, description, body, graph: [pageNode(ctx, { type: 'AboutPage', name: title, description, path }), breadcrumbNode(site, bc), faqNode(g)] };
}

/* ---------------- CONTATO ---------------- */
export function contato(ctx) {
  const { site, t, r } = ctx;
  const path = r.contact;
  const title = t.contactTitle;
  const description = t.contactDesc(site);
  const bc = [...home1(ctx), { name: t.contactCrumb, path }];
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${site.address.street}, ${site.address.city}, ${site.address.region}`)}`;
  const country = t.country ? `, ${esc(t.country)}` : '';
  const body = `<div class="wrap">${crumbs(ctx, bc)}
<div class="ph2"><div><span class="label">${esc(t.contactCrumb)}</span><h1>${esc(t.contactH1)}</h1>
<p class="def">${esc(t.contactDef)}</p>
<div style="margin:26px 0">${waBtn(ctx, t.waFloat, t.waDefault)}</div>
<address class="contact-list"><p><b>WhatsApp</b><a href="${esc(waUrl(site, t.waDefault))}" target="_blank" rel="noopener">${esc(site.whatsappDisplay)}</a></p><p><b>${esc(t.landline)}</b><a href="tel:${site.phone}">${esc(site.phoneDisplay)}</a></p><p><b>${esc(t.email)}</b><a href="mailto:${site.email}">${esc(site.email)}</a></p><p><b>${esc(t.address)}</b>${esc(site.address.street)}, ${esc(site.address.district)}<br>${esc(site.address.city)}, ${esc(site.address.region)}${country} · <a href="${esc(map)}" target="_blank" rel="noopener">${esc(t.viewMap)}</a></p></address></div>
<div>${lead(ctx, { pageUrl: path })}</div></div></div>`;
  return { key: 'contact', path, title, description, body, withForm: true, graph: [pageNode(ctx, { type: 'ContactPage', name: title, description, path }), breadcrumbNode(site, bc)] };
}

/* ---------------- HUBS ---------------- */
export function produtosHub(ctx) {
  const { site, families, t, r } = ctx;
  const path = r.products;
  const title = t.productsTitle;
  const description = t.productsDesc;
  const bc = [...home1(ctx), { name: t.productsCrumb, path }];
  const cards = families.map((f) => `<a class="card" href="${r.fam(f)}"><h3>${esc(f.n)}</h3><p>${txt(f.short)}</p><span class="more">${esc(t.viewDetails)} ${AR}</span></a>`).join('');
  const body = `<div class="wrap">${crumbs(ctx, bc)}
<div class="head"><span class="label">${esc(t.productsCrumb)}</span><h1>${esc(t.productsH1)}</h1>
<p class="def">${esc(t.productsDef(families.length))}</p>${updated(ctx)}</div>
<div class="cards">${cards}</div></div>
${cta(ctx, t.productsCtaTitle, t.productsCtaSub, t.productsCtaMsg)}`;
  return { key: 'products', path, title, description, body, graph: [pageNode(ctx, { type: 'CollectionPage', name: title, description, path }), breadcrumbNode(site, bc),
    { '@type': 'ItemList', itemListElement: families.map((f, i) => ({ '@type': 'ListItem', position: i + 1, name: f.n, url: abs(site, r.fam(f)) })) }] };
}
export function segmentosHub(ctx) {
  const { site, segments, t, r } = ctx;
  const path = r.industries;
  const title = t.industriesTitle;
  const description = t.industriesDesc;
  const bc = [...home1(ctx), { name: t.industriesCrumb, path }];
  const cards = segments.map((s) => `<a class="card" href="${r.seg(s)}"><h3>${esc(s.n)}</h3><p>${txt(s.short)}</p><span class="more">${esc(t.viewApplications)} ${AR}</span></a>`).join('');
  const body = `<div class="wrap">${crumbs(ctx, bc)}
<div class="head"><span class="label">${esc(t.industriesCrumb)}</span><h1>${esc(t.industriesH1)}</h1>
<p class="def">${esc(t.industriesDef)}</p>${updated(ctx)}</div>
<div class="cards">${cards}</div></div>
${cta(ctx, t.industriesCtaTitle, t.industriesCtaSub, t.industriesCtaMsg)}`;
  return { key: 'industries', path, title, description, body, graph: [pageNode(ctx, { type: 'CollectionPage', name: title, description, path }), breadcrumbNode(site, bc)] };
}

/* ---------------- FAMÍLIA ---------------- */
export function familia(ctx, f) {
  const { site, families, segments, t, r } = ctx;
  const path = r.fam(f);
  const bc = [...home1(ctx), { name: t.productsCrumb, path: r.products }, { name: f.n, path }];
  const rows = f.table.map((x) => `<tr><td><b>${txt(x[0])}</b></td><td>${txt(x[1])}</td><td>${txt(x[2])}</td></tr>`).join('');
  const related = families.filter((x) => x.id !== f.id).slice(0, 3);
  const segs = f.seg.map((id) => segments.find((s) => s.id === id)).filter(Boolean);
  const solvFam = families.find((x) => x.id === 'solventes');
  const solv = f.solvente ? `<div class="how"><b>${esc(t.solvTitle)}</b>${esc(t.solvText)} <a href="${r.fam(solvFam)}">${esc(t.solvLink)}</a>.</div>` : '';
  const body = `<div class="wrap">${crumbs(ctx, bc)}
<div class="ph2"><div><span class="label">${esc(f.n)}</span><h1>${txt(f.h1)}</h1><p class="def">${txt(f.def)}</p>
<div class="how"><b>${esc(t.inPractice)}</b>${txt(f.prac)}</div>${solv}
${waBtn(ctx, t.btnProject, t.famMsg(f.n))}${updated(ctx)}</div>${photo('familia-' + f.id)}</div></div>
<section class="sec" style="padding-top:0"><div class="wrap"><span class="label">${esc(t.featLabel)}</span><h2 class="sub">${esc(t.featH2(f.n))}</h2>${prGrid(f.feat)}</div></section>
<section class="sec dark on-dark"><div class="wrap"><span class="label">${esc(t.benLabel)}</span><h2 style="margin-top:18px">${esc(t.benH2)}</h2><div class="cards3">${f.ben.map((x, i) => `<div class="step"><div><b>0${i + 1}.</b></div><h3>${txt(x)}</h3></div>`).join('')}</div></div></section>
<section class="sec"><div class="wrap"><span class="label">${esc(t.versionsLabel)}</span><h2 style="margin-top:18px">${esc(t.versionsH2(f.n))}</h2><div class="tbl"><table><thead><tr><th scope="col">${esc(t.thProduct)}</th><th scope="col">${esc(t.thSubstrate)}</th><th scope="col">${esc(t.thFor)}</th></tr></thead><tbody>${rows}</tbody></table></div>
<div style="margin-top:44px"><span class="label">${esc(t.usedIn)}</span><div class="tags">${segs.map((s) => `<a href="${r.seg(s)}">${esc(s.n)}</a>`).join('')}</div></div></div></section>
<section class="sec" style="padding-top:0"><div class="wrap faq-wrap"><div><span class="label">${esc(t.faqLabel)}</span><h2>${esc(t.faqH2(f.n))}</h2><div class="chips">${f.kw.slice(0, 3).map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div></div><div>${faq(f.faq)}</div></div></section>
<section class="sec dark on-dark"><div class="wrap two"><div><span class="label">${esc(t.talkSales)}</span><h2>${esc(t.famTalkH2(f.n))}</h2>
<p class="lead" style="color:var(--on-dark-mut);margin-top:18px">WhatsApp: <a href="${esc(waUrl(site, t.waDefault))}" target="_blank" rel="noopener">${esc(site.whatsappDisplay)}</a><br>${esc(t.phoneLbl)}: <a href="tel:${site.phone}">${esc(site.phoneDisplay)}</a><br>${esc(t.emailLbl)}: <a href="mailto:${site.email}">${esc(site.email)}</a></p></div><div style="color:var(--ink)">${lead(ctx, { product: f, pageUrl: path })}</div></div></section>
<section class="sec"><div class="wrap"><span class="label">${esc(t.seeAlso)}</span><div class="cards" style="margin-top:22px">${related.map((x) => `<a class="card" href="${r.fam(x)}"><h3>${esc(x.n)}</h3><p>${txt(x.short)}</p><span class="more">${esc(t.viewDetails)} ${AR}</span></a>`).join('')}</div></div></section>`;
  const description = plain(f.meta);
  return { key: 'fam:' + f.id, path, title: f.title, description, body, withForm: true, image: '/og-default.png',
    graph: [pageNode(ctx, { type: 'WebPage', name: f.title, description, path, about: { '@type': 'Product', name: f.n, description: plain(f.def), category: t.productCategory, brand: { '@type': 'Brand', name: site.name }, manufacturer: { '@id': abs(site, '/#organizacao') } } }),
      breadcrumbNode(site, bc), faqNode(f.faq)] };
}

/* ---------------- SEGMENTO ---------------- */
export function segmento(ctx, s) {
  const { site, families, t, r } = ctx;
  const path = r.seg(s);
  const bc = [...home1(ctx), { name: t.industriesCrumb, path: r.industries }, { name: s.n, path }];
  const prods = s.prods.map((id) => families.find((f) => f.id === id)).filter(Boolean);
  const chars = s.chars ? `<section class="sec dark on-dark"><div class="wrap"><span class="label">${esc(t.charsLabel)}</span><h2 style="margin-top:18px">${esc(t.charsH2(s.n))}</h2><div class="cards3">${s.chars.map((x, i) => `<div class="step"><div><b>0${i + 1}.</b></div><h3 style="font-size:18px">${txt(x)}</h3></div>`).join('')}</div></div></section>` : '';
  const body = `<div class="wrap">${crumbs(ctx, bc)}
<div class="ph2"><div><span class="label">${esc(t.segCrumbLabel(s.n))}</span><h1>${txt(s.h1)}</h1><p class="def">${txt(s.intro)}</p>
<div class="how"><b>${esc(t.howItWorks)}</b>${txt(s.how)}</div>${waBtn(ctx, t.btnProject, t.segMsg(s.n))}${updated(ctx)}</div>${photo('segmento-' + s.id)}</div></div>
<section class="sec" style="padding-top:0"><div class="wrap"><span class="label">${esc(t.appsLabel)}</span><h2 class="sub">${esc(t.appsH2(s.n))}</h2>${prGrid(s.apps)}</div></section>
${chars}
<section class="sec dark on-dark"><div class="wrap"><span class="label">${esc(t.prodsLabel)}</span><h2 style="margin-top:18px">${esc(t.prodsH2(s.n))}</h2><div class="tags">${prods.map((p) => `<a href="${r.fam(p)}">${esc(p.n)}</a>`).join('')}</div></div></section>
<section class="sec"><div class="wrap faq-wrap"><div><span class="label">${esc(t.faqLabel)}</span><h2>${esc(t.faqH2(s.n))}</h2></div><div>${faq(s.faq)}</div></div></section>
<section class="sec tint"><div class="wrap two"><div><span class="label">${esc(t.talkSales)}</span><h2>${esc(t.testH2)}</h2><p class="lead" style="margin-top:18px">${esc(t.testLead)}</p></div><div>${lead(ctx, { pageUrl: path })}</div></div></section>`;
  const description = plain(s.meta);
  return { key: 'seg:' + s.id, path, title: s.title, description, body, withForm: true,
    graph: [pageNode(ctx, { type: 'WebPage', name: s.title, description, path }), breadcrumbNode(site, bc), faqNode(s.faq)] };
}

/* ---------------- CONTEÚDO TÉCNICO (só em português) ---------------- */
export function artigosHub(ctx) {
  const { site, articles, r } = ctx;
  const path = r.articles;
  const title = 'Conteúdo técnico sobre verniz UV e metalização | Corquímica';
  const description = 'Artigos da Corquímica sobre verniz UV, metalização a vácuo, lacas, tintas para plástico e acabamento industrial. Conteúdo para quem produz.';
  const bc = [...home1(ctx), { name: 'Conteúdo técnico', path }];
  const body = `<div class="wrap">${crumbs(ctx, bc)}<div class="head"><span class="label">Conteúdo técnico</span><h1>Conteúdo técnico para quem produz</h1><p class="def">Guias práticos sobre verniz UV, metalização a vácuo, lacas e tintas para plástico, escritos pela equipe da Corquímica.</p></div>
<div class="cards">${articles.map((a) => `<a class="card" href="${path}${a.slug}/"><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p><span class="more">Ler artigo ${AR}</span></a>`).join('')}</div></div>
${cta(ctx, 'Ficou com dúvida?', 'Fale com a equipe técnica pelo WhatsApp.', 'Olá! Li um conteúdo do site e tenho uma dúvida técnica.')}`;
  return { key: 'articles', path, title, description, body, graph: [pageNode(ctx, { type: 'CollectionPage', name: title, description, path }), breadcrumbNode(site, bc)] };
}
export function artigo(ctx, a) {
  const { site, r } = ctx;
  const path = `${r.articles}${a.slug}/`;
  const bc = [...home1(ctx), { name: 'Conteúdo técnico', path: r.articles }, { name: a.title, path }];
  const faqList = Array.isArray(a.faq) ? a.faq.filter((x) => x && x.q && x.a).map((x) => [x.q, x.a]) : [];
  const fam = ctx.families.find((f) => f.id === a.category);
  const published = (a.published_at || site.contentUpdated).slice(0, 10);
  const modified = (a.updated_at || a.published_at || site.contentUpdated).slice(0, 10);
  const body = `<div class="wrap">${crumbs(ctx, bc)}<article class="prose"><span class="label">Conteúdo técnico</span><h1>${esc(a.title)}</h1>
<p class="def">${esc(a.description)}</p><p class="upd">Publicado em ${new Date(published + 'T12:00:00').toLocaleDateString('pt-BR')} · Atualizado em ${new Date(modified + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
${md(a.body_md)}
${fam ? `<p class="how"><b>Produto relacionado</b><a href="${r.fam(fam)}">${esc(fam.n)}</a></p>` : ''}
${faqList.length ? `<h2>Perguntas frequentes</h2>${faq(faqList, false)}` : ''}</article></div>
${cta(ctx, 'Quer aplicar isso na sua peça?', 'Fale com a equipe técnica pelo WhatsApp.', `Olá! Li o artigo "${a.title}" e quero falar sobre o meu projeto.`)}`;
  return { key: 'article:' + a.slug, path, title: `${a.title} | Corquímica`.length > 62 ? `${a.title}`.slice(0, 58) + ' | Corquímica' : `${a.title} | Corquímica`, description: a.description, body, ogType: 'article',
    graph: [pageNode(ctx, { type: 'Article', name: a.title, description: a.description, path, dateModified: modified }), { '@type': 'Article', '@id': abs(site, path) + '#artigo', headline: a.title, description: a.description, datePublished: published, dateModified: modified, inLanguage: 'pt-BR', author: { '@id': abs(site, '/#organizacao') }, publisher: { '@id': abs(site, '/#organizacao') }, mainEntityOfPage: abs(site, path) }, breadcrumbNode(site, bc), ...(faqList.length ? [faqNode(faqList)] : [])] };
}

/* ---------------- PRIVACIDADE e 404 ---------------- */
export function privacidade(ctx) {
  const { site, t, r } = ctx;
  const path = r.privacy;
  const title = t.privTitle;
  const description = t.privDesc;
  const bc = [...home1(ctx), { name: t.privCrumb, path }];
  const body = `<div class="wrap">${crumbs(ctx, bc)}<article class="prose"><h1>${esc(t.privH1)}</h1>
${t.privBody(esc(site.legalName), `<a href="mailto:${site.email}">${esc(site.email)}</a>`)}</article></div>`;
  return { key: 'privacy', path, title, description, body, noindex: true, graph: [pageNode(ctx, { name: title, description, path }), breadcrumbNode(site, bc)] };
}
export function notFound(ctx) {
  const { r } = ctx;
  const body = `<div class="wrap"><div class="head" style="padding-block:80px"><span class="label">Erro 404</span><h1>Página não encontrada</h1><p class="def">O endereço pode ter mudado. Veja os produtos ou fale com a gente pelo WhatsApp.</p><div class="btnrow" style="margin-top:24px">${pb('Ver produtos', r.products)}${waBtn(ctx, 'Falar no WhatsApp', 'Olá! Não encontrei o que procurava no site.')}</div>
<p class="def" style="margin-top:28px" lang="es">Página no encontrada. <a href="/es/">Ir al inicio en español</a>.</p><p class="def" lang="en">Page not found. <a href="/en/">Go to the English home page</a>.</p></div></div>`;
  return { key: '404', path: '/404.html', title: 'Página não encontrada | Corquímica', description: 'A página que você procurava não foi encontrada. Veja os produtos da Corquímica ou fale pelo WhatsApp.', body, noindex: true, graph: [] };
}
