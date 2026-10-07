// Modelos de página. Cada função devolve { path, title, description, body, graph, ... }.
import { esc, txt, plain, md, photo, photoBg, photoSwap } from './util.mjs';
import { AR, pb, waBtn, waUrl } from './layout.mjs';
import { breadcrumbNode, faqNode, pageNode, abs } from './seo.mjs';

const faq = (list, open = false) => {
  const item = ([q, a], i) => `<details class="faq"${open && i === 0 ? ' open' : ''}><summary>${txt(q)}</summary><p>${txt(a)}</p></details>`;
  const half = Math.ceil(list.length / 2);
  // Duas colunas fixas (não reorganizam ao abrir uma pergunta).
  return `<div class="faq-cols"><div>${list.slice(0, half).map(item).join('\n')}</div><div>${list.slice(half).map((x, i) => item(x, i + half)).join('\n')}</div></div>`;
};
// 5) Números (home e /sobre/).
const stats = (ctx) => `<div class="sc"><div class="sq"><b>+${ctx.site.clients}</b><span>clientes<br>no Brasil</span></div><div class="sq"><b>+${ctx.site.tonsPerYear}&nbsp;t</b><span>de produtos<br>vendidas por ano</span></div><div class="sq"><b>${ctx.families.length}</b><span>famílias<br>de produto</span></div><div class="sq"><b>2</b><span>continentes<br>de parceiros</span></div><div class="sq"><b>${ctx.site.foundingYear}</b><span>início das<br>atividades</span></div></div>`;
// 6) Lista de itens em grade (características, aplicações).
const prGrid = (items) => `<div class="prgrid${items.length === 4 ? ' n4' : ''}">${items.map((x) => `<div class="pr"><i>${AR}</i><div>${txt(x)}</div></div>`).join('')}</div>`;
const crumbs = (items) =>
  `<nav class="crumbs" aria-label="Você está em">${items.map((it, i) => (i === items.length - 1 ? `<b>${esc(it.name)}</b>` : `<a href="${it.path}">${esc(it.name)}</a><span>/</span>`)).join('')}</nav>`;
const updated = (site) => {
  const d = new Date(site.contentUpdated + 'T12:00:00');
  return `<p class="upd">Atualizado em ${d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p>`;
};
const lead = (ctx, { product = '', pageUrl = '', title = 'Fale sobre o seu projeto pelo WhatsApp' } = {}) => `
<form class="sample" data-lead data-product="${esc(product)}" data-page="${esc(pageUrl)}" action="https://wa.me/${ctx.site.whatsapp}" method="get">
  <h3>${esc(title)}</h3>
  <label>Nome e empresa<input name="contact" type="text" autocomplete="organization" placeholder="Ex.: Maria Souza, Metalizadora Exemplo" required></label>
  <div class="row2">
    <label>Material da peça<select name="material"><option>ABS</option><option>PS</option><option>PP</option><option>PVC</option><option>Zamac</option><option>TPU</option><option>Outro</option></select></label>
    <label>Segmento<select name="segment"><option>Moda</option><option>Moveleiro</option><option>Automotivo</option><option>Cosméticos</option><option>Plástico em geral</option></select></label>
  </div>
  <label>O que você quer obter?<textarea name="message" rows="2" maxlength="600" placeholder="Ex.: acabamento espelhado com resistência a riscos"></textarea></label>
  <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
  <label class="chk"><input type="checkbox" name="consent" required> <span>Concordo com o uso destes dados para contato comercial, conforme a <a href="/politica-de-privacidade/">política de privacidade</a>.</span></label>
  <button class="pb wa" type="submit">Falar sobre o meu projeto <i>${AR}</i></button>
  <p class="fine">Ao enviar, o WhatsApp abre com a sua mensagem pronta.</p>
</form>`;
const cta = (ctx, title, sub, msg) => `<section class="sec"><div class="wrap"><div class="cta2"><span class="label">Vamos conversar</span><h2>${esc(title)}</h2><p>${esc(sub)}</p>${waBtn(ctx, 'Falar sobre o meu projeto', msg)}<p class="alt">Ou ligue <a href="tel:${ctx.site.phone}">${esc(ctx.site.phoneDisplay)}</a> · <a href="mailto:${ctx.site.email}">${esc(ctx.site.email)}</a></p></div></div></section>`;
const ICON = {
  moda: '<svg viewBox="0 0 32 32"><path d="M6 24c0-5 3-9 7-11l2-6 3 1-1 5c4 1 8 4 8 11H6z"/><path d="M4 28h24"/></svg>',
  moveleiro: '<svg viewBox="0 0 32 32"><rect x="5" y="10" width="22" height="10" rx="2"/><path d="M8 20v6M24 20v6M8 10V6h16v4"/></svg>',
  automotivo: '<svg viewBox="0 0 32 32"><path d="M4 20l3-8a3 3 0 0 1 3-2h12a3 3 0 0 1 3 2l3 8v5H4z"/><circle cx="10" cy="24" r="2"/><circle cx="22" cy="24" r="2"/></svg>',
  cosmeticos: '<svg viewBox="0 0 32 32"><rect x="11" y="4" width="10" height="5" rx="1"/><path d="M14 9v3M18 9v3"/><rect x="7" y="12" width="18" height="15" rx="3"/><path d="M12 19h8"/></svg>',
  plasticos: '<svg viewBox="0 0 32 32"><path d="M16 4l11 6v12l-11 6-11-6V10z"/><path d="M16 16l11-6M16 16L5 10M16 16v12"/></svg>',
};

/* ---------------- HOME ---------------- */
export function home(ctx) {
  const { site, families, segments } = ctx;
  const hero = photoBg('home-hero', 'linear-gradient(90deg,#0a0a3cb3 0%,#0a0a3c80 40%,#0a0a3c1f 100%)');
  const card = (slot, big, small, extra = '') => { const b = photoBg(slot); return `<div class="mc"${b.style}>${b.tag}<div><b>${big}</b>${small ? `<span>${small}</span>` : ''}</div>${extra}</div>`; };
  const famRows = families.map((f) => `<a class="fr" href="/produtos/${f.id}/"><span class="dash"></span><b>${esc(f.n)}</b><span>${txt(f.short)}</span></a>`).join('');
  const segRows = segments.map((s) => `<a class="row" data-seg="${s.id}" href="/segmentos/${s.id}/"><span class="ic">${ICON[s.id]}</span><span><b>${esc(s.n)}</b><span>${txt(s.short)}</span></span></a>`).join('');
  const steps = [['01', 'Primer ou tinta', 'A tinta dá a cor. O primer entra apenas em alguns substratos, não em todos. O teste na peça define.'], ['02', 'Verniz UV Base', 'Ancora e nivela a superfície antes da metalização.'], ['03', 'Metalização', 'Feita a vácuo, na sua fábrica ou em terceiro.'], ['04', 'Verniz UV Top Coat', 'Protege a metalização e fecha o acabamento, em brilho ou fosco.']];
  const latest = ctx.articles.slice(0, 3);
  const body = `
<section class="hero"${hero.style}>${hero.tag ? '<div class="tube t2"></div><div class="tube"></div><div class="tube t3"></div>' : ''}${hero.tag}
  <div class="wrap" style="width:100%"><div class="inner">
    <h1>Vernizes UV, lacas e tintas para plásticos e metais</h1>
    <p class="lead">A Corquímica fabrica verniz UV Base e Top Coat, lacas, tintas para ABS e PS, tintas para piso, corantes UV e solventes, em Estância Velha, RS. Desenvolvidos para a sua peça, com apoio técnico dentro da sua fábrica.</p>
    <div class="btnrow">${waBtn(ctx, 'Falar sobre o meu projeto', 'Olá! Quero falar sobre o meu projeto com a Corquímica.')}<a class="pb out" href="/produtos/" style="color:#fff">Ver produtos <i>${AR}</i></a></div>
  </div></div>
</section>

<section class="sec" id="sobre"><div class="wrap"><div class="core essence"><div class="essence-side"><span class="label">Nossa essência</span>${photo('home-sobre')}</div><div>
  <p class="big">A Corquímica é fabricante de vernizes UV, lacas, tintas e corantes em Estância Velha, RS. <b>Atua desde ${site.foundingYear} e atende mais de ${site.clients} clientes em todo o país</b>, com formulações pensadas para a necessidade de cada um.</p>
  <hr class="rule">
  <p class="lead" style="margin-top:22px">Buscamos inovação o tempo todo. Participamos de feiras internacionais e temos parcerias estratégicas na Europa e na Ásia, para trazer novas tecnologias ao seu processo.</p>
  <div style="margin-top:26px">${pb('Conheça a Corquímica', '/sobre/', 'sand')}</div></div></div></div></section>

<section class="sec" id="segmentos"><div class="wrap"><div class="float2"><div>${photoSwap('home-segmentos', segments.map((s) => ['segmento-' + s.id, s.id]))}</div><div><h2>Segmentos que atendemos</h2><div class="rows">${segRows}</div></div></div></div></section>

<section class="sec"><div class="wrap center"><span class="label">A diferença que fazemos</span><h2>Líder em acabamentos UV para a indústria de plásticos</h2>
<div class="mos">
  <div class="mc sand"><div><b>+${site.clients}</b><span>clientes atendidos em todo o país</span></div><span>Da moda ao automotivo, acompanhamos a produção de quem depende de cor, brilho e proteção.</span></div>
  ${card('home-apoio-tecnico', 'Apoio técnico in loco', 'Nossa equipe regula a aplicação e treina colaboradores dentro da sua fábrica.')}
  <div class="mc sand"><div><b>Sob medida</b><span>formulação personalizada</span></div><span>Cada cliente tem uma peça, um material e um processo. A fórmula é ajustada a eles.</span></div>
  ${card('home-feira-internacional', 'Europa e Ásia', 'Feiras internacionais e parcerias estratégicas para trazer inovação ao Brasil.')}
  ${card('home-laboratorio', 'Laboratório próprio', 'Desenvolvimento de cores, efeitos e sistemas completos de acabamento.')}
</div></div></section>

<section class="sec dark on-dark"><div class="wrap"><div class="stats2"><div><span class="label">Resultados em números</span><h2>Nossa força em excelência</h2><p>Experiência na indústria, uma linha completa de produtos e uma equipe técnica dedicada a entregar acabamento de alta performance.</p></div>
${stats(ctx)}</div></div></section>

<section class="sec" id="produtos"><div class="wrap"><div class="sol"><div class="glass"><span class="label">Nossas famílias de produto</span><h2>Soluções para o seu acabamento</h2><div class="frgrid">${famRows}</div></div></div></div></section>

<section class="sec dark on-dark" id="processo"><div class="wrap"><span class="label">O sistema em 4 etapas</span><h2 style="margin-top:18px;max-width:680px">Base Coat + Top Coat, do primer ao brilho final</h2>
<div class="steps">${steps.map((s) => `<div class="step"><div><b>${s[0]}.</b><h3>${s[1]}</h3></div><p>${s[2]}</p></div>`).join('')}</div>
<div class="alignbar"><span>Quer saber qual sistema serve para a sua peça?</span>${waBtn(ctx, 'Falar sobre o meu projeto', 'Olá! Quero falar sobre o meu projeto com a Corquímica.', 'sand')}</div></div></section>

<section class="sec"><div class="wrap"><div class="plans"><div class="lft"><span class="label">Como trabalhamos</span><h2>Do laboratório à sua linha de produção</h2></div>
<div class="plan hi"><h3>Formulação personalizada <em>Diferencial</em></h3><p>Desenvolvemos a fórmula conforme a peça, o material e o efeito desejado.</p><ul><li>Cor igualada à amostra do cliente</li><li>Teste na sua peça</li><li>Ajuste de brilho, fosco ou soft touch</li></ul></div>
<div class="plan"><h3>Apoio técnico in loco</h3><p>Nossa equipe vai até a sua fábrica para colocar o sistema para rodar.</p><ul><li>Regulagem da aplicação e da cura UV</li><li>Treinamento de colaboradores</li><li>Acompanhamento pós-implantação</li></ul></div></div></div></section>

${latest.length ? `<section class="sec tint"><div class="wrap"><span class="label">Conteúdo técnico</span><h2 style="margin:18px 0 32px">Aprenda sobre verniz UV e metalização</h2><div class="cards3">${latest.map((a) => `<a class="step light" href="/conteudo-tecnico/${a.slug}/"><div><b>${esc(a.category_label || 'Artigo')}</b><h3>${esc(a.title)}</h3></div><p>${esc(a.description)}</p></a>`).join('')}</div></div></section>` : ''}

<section class="sec" id="faq-geral"><div class="wrap faq-wrap"><div><span class="label">Perguntas frequentes</span><h2>Tire suas dúvidas sobre a Corquímica</h2><p class="lead">Respostas diretas sobre nossa empresa, produtos e atendimento.</p></div><div>${faq(ctx.faqGeral)}</div></div></section>
${cta(ctx, 'Vamos desenvolver o acabamento ideal para o seu produto', 'Chame o comercial pelo WhatsApp e conte o que a sua peça precisa.', 'Olá! Quero falar sobre o meu projeto com a Corquímica.')}`;
  const title = 'Verniz UV, lacas e tintas para plástico | Corquímica';
  const description = 'Fabricante de verniz UV Base e Top Coat, lacas, tintas para ABS e PS, corantes UV e solventes em Estância Velha, RS. Peça amostra pelo WhatsApp.';
  return { path: '/', title, description, body, bodyClass: 'home',
    graph: [pageNode(site, { name: title, description, path: '/' }), faqNode(ctx.faqGeral)] };
}

/* ---------------- SOBRE ---------------- */
export function sobre(ctx) {
  const { site } = ctx;
  const path = '/sobre/';
  const title = 'Sobre a Corquímica: fabricante de verniz UV no RS';
  const description = `Fabricante de verniz UV, lacas, tintas e corantes em Estância Velha, RS, desde ${site.foundingYear}. Mais de ${site.clients} clientes, parcerias na Europa e na Ásia e apoio técnico in loco.`;
  const bc = [{ name: 'Início', path: '/' }, { name: 'Sobre', path }];
  const g = ctx.faqGeral;
  const body = `<div class="wrap">${crumbs(bc)}
<div class="ph2"><div><span class="label">Sobre a Corquímica</span><h1>Inovação e formulação sob medida para a indústria</h1>
<p class="def">A Corquímica é fabricante de vernizes UV, lacas, tintas e corantes, sediada em Estância Velha, RS. Atua desde ${site.foundingYear} e atende mais de ${site.clients} clientes em todo o país.</p>
<p class="def" style="margin-top:14px">Participamos de feiras internacionais e temos parcerias estratégicas na Europa e na Ásia. Cada cliente recebe uma formulação desenvolvida para a sua necessidade, e a equipe técnica acompanha a aplicação dentro da fábrica.</p>
<div style="margin-top:28px">${waBtn(ctx, 'Falar sobre o meu projeto', 'Olá! Gostaria de conhecer a Corquímica e conversar sobre o meu projeto.')}</div>${updated(site)}</div>${photo('sobre-fabrica')}</div></div>
<section class="sec dark on-dark"><div class="wrap"><div class="stats2"><div><span class="label">Em números</span><h2>Nossa força em excelência</h2></div>${stats(ctx)}</div></div></section>
<section class="sec"><div class="wrap"><div class="two"><div><span class="label">O que nos move</span><h2>Três compromissos com o cliente</h2></div><div>
<div class="pr"><i>${AR}</i><div><b>Inovação constante.</b> Feiras internacionais e parceiros na Europa e na Ásia.</div></div>
<div class="pr"><i>${AR}</i><div><b>Formulação personalizada.</b> Fórmula ajustada à peça e ao processo.</div></div>
<div class="pr"><i>${AR}</i><div><b>Apoio técnico in loco.</b> Equipe na sua fábrica, da regulagem ao treinamento.</div></div></div></div></div></section>
<section class="sec" style="padding-top:0"><div class="wrap faq-wrap"><div><span class="label">Perguntas frequentes</span><h2>Sobre a empresa</h2></div><div>${faq(g)}</div></div></section>
${cta(ctx, 'Quer conhecer a Corquímica de perto?', 'Fale com a gente e agende uma conversa ou visita técnica.', 'Olá! Gostaria de conhecer a Corquímica e agendar uma conversa.')}`;
  return { path, title, description, body, graph: [pageNode(site, { type: 'AboutPage', name: title, description, path }), breadcrumbNode(site, bc), faqNode(g)] };
}

/* ---------------- CONTATO ---------------- */
export function contato(ctx) {
  const { site } = ctx;
  const path = '/contato/';
  const title = 'Contato e WhatsApp | Corquímica, Estância Velha RS';
  const description = `Fale com o comercial da Corquímica pelo WhatsApp ${site.whatsappDisplay}, telefone ${site.phoneDisplay} ou ${site.email}. ${site.address.street}, Estância Velha, RS.`;
  const bc = [{ name: 'Início', path: '/' }, { name: 'Contato', path }];
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${site.address.street}, ${site.address.city}, ${site.address.region}`)}`;
  const body = `<div class="wrap">${crumbs(bc)}
<div class="ph2"><div><span class="label">Contato</span><h1>Fale com o comercial da Corquímica</h1>
<p class="def">O caminho mais rápido é o WhatsApp. Conte o material da peça e o acabamento que você quer, e a equipe indica o sistema e envia amostra.</p>
<div style="margin:26px 0">${waBtn(ctx, 'Falar no WhatsApp', 'Olá! Vim pelo site da Corquímica e gostaria de falar com o comercial.')}</div>
<address class="contact-list"><p><b>WhatsApp</b><a href="${esc(waUrl(site))}" target="_blank" rel="noopener">${esc(site.whatsappDisplay)}</a></p><p><b>Telefone fixo</b><a href="tel:${site.phone}">${esc(site.phoneDisplay)}</a></p><p><b>E-mail</b><a href="mailto:${site.email}">${esc(site.email)}</a></p><p><b>Endereço</b>${esc(site.address.street)}, ${esc(site.address.district)}<br>${esc(site.address.city)}, ${esc(site.address.region)} · <a href="${esc(map)}" target="_blank" rel="noopener">Ver no mapa</a></p></address></div>
<div>${lead(ctx, { pageUrl: path })}</div></div></div>`;
  return { path, title, description, body, withForm: true, graph: [pageNode(site, { type: 'ContactPage', name: title, description, path }), breadcrumbNode(site, bc)] };
}

/* ---------------- HUBS ---------------- */
export function produtosHub(ctx) {
  const { site, families } = ctx;
  const path = '/produtos/';
  const title = 'Produtos: verniz UV, lacas, tintas e corantes | Corquímica';
  const description = 'Verniz UV Base e Top Coat, lacas, tintas para ABS e PS, tintas para piso, corantes UV, solventes e desengraxantes. Conheça as famílias de produto da Corquímica.';
  const bc = [{ name: 'Início', path: '/' }, { name: 'Produtos', path }];
  const cards = families.map((f) => `<a class="card" href="/produtos/${f.id}/"><h3>${esc(f.n)}</h3><p>${txt(f.short)}</p><span class="more">Ver detalhes ${AR}</span></a>`).join('');
  const body = `<div class="wrap">${crumbs(bc)}
<div class="head"><span class="label">Produtos</span><h1>Produtos da Corquímica para acabamento de plásticos e metais</h1>
<p class="def">São ${families.length} famílias que funcionam juntas: o verniz UV Base prepara a peça, a metalização a vácuo dá o efeito metálico e o Verniz UV Top Coat protege a metalização. Lacas e tintas dão cor, corantes UV tingem os vernizes, e os solventes e desengraxantes completam o processo.</p>${updated(site)}</div>
<div class="cards">${cards}</div></div>
${cta(ctx, 'Não sabe qual produto usar?', 'Conte a peça e o acabamento desejado. A equipe indica o sistema.', 'Olá! Preciso de ajuda para escolher o produto certo para a minha peça.')}`;
  return { path, title, description, body, graph: [pageNode(site, { type: 'CollectionPage', name: title, description, path }), breadcrumbNode(site, bc),
    { '@type': 'ItemList', itemListElement: families.map((f, i) => ({ '@type': 'ListItem', position: i + 1, name: f.n, url: abs(site, `/produtos/${f.id}/`) })) }] };
}
export function segmentosHub(ctx) {
  const { site, segments } = ctx;
  const path = '/segmentos/';
  const title = 'Segmentos: moda, móveis, automotivo, cosméticos | Corquímica';
  const description = 'Acabamento com verniz UV, lacas e tintas para moda, moveleiro, automotivo, cosméticos e plásticos em geral. Veja as aplicações da Corquímica por segmento.';
  const bc = [{ name: 'Início', path: '/' }, { name: 'Segmentos', path }];
  const cards = segments.map((s) => `<a class="card" href="/segmentos/${s.id}/"><h3>${esc(s.n)}</h3><p>${txt(s.short)}</p><span class="more">Ver aplicações ${AR}</span></a>`).join('');
  const body = `<div class="wrap">${crumbs(bc)}
<div class="head"><span class="label">Segmentos</span><h1>Acabamento para cada segmento da indústria</h1>
<p class="def">A Corquímica atende moda, moveleiro, automotivo, cosméticos e plásticos em geral, com o sistema de verniz UV, laca ou tinta certo para cada peça.</p>${updated(site)}</div>
<div class="cards">${cards}</div></div>
${cta(ctx, 'Seu segmento não está na lista?', 'Se a sua peça é de plástico ou Zamac e precisa de cor, brilho ou proteção, nós temos um sistema para ela.', 'Olá! Tenho uma peça que precisa de acabamento e gostaria de conversar.')}`;
  return { path, title, description, body, graph: [pageNode(site, { type: 'CollectionPage', name: title, description, path }), breadcrumbNode(site, bc)] };
}

/* ---------------- FAMÍLIA ---------------- */
export function familia(ctx, f) {
  const { site, families, segments } = ctx;
  const path = `/produtos/${f.id}/`;
  const bc = [{ name: 'Início', path: '/' }, { name: 'Produtos', path: '/produtos/' }, { name: f.n, path }];
  const rows = f.table.map((r) => `<tr><td><b>${txt(r[0])}</b></td><td>${txt(r[1])}</td><td>${txt(r[2])}</td></tr>`).join('');
  const related = families.filter((x) => x.id !== f.id).slice(0, 3);
  const segs = f.seg.map((id) => segments.find((s) => s.id === id)).filter(Boolean);
  const solv = f.solvente ? `<div class="how"><b>Solvente indicado</b>Este produto é sempre indicado com uma formulação de solvente desenvolvida pela Corquímica, para melhor atender o resultado esperado. <a href="/produtos/solventes/">Ver solventes</a>.</div>` : '';
  const body = `<div class="wrap">${crumbs(bc)}
<div class="ph2"><div><span class="label">${esc(f.n)}</span><h1>${txt(f.h1)}</h1><p class="def">${txt(f.def)}</p>
<div class="how"><b>Na prática</b>${txt(f.prac)}</div>${solv}
${waBtn(ctx, 'Falar sobre o meu projeto', `Olá! Quero falar sobre o meu projeto com o produto: ${f.n}.`)}${updated(site)}</div>${photo('familia-' + f.id)}</div></div>
<section class="sec" style="padding-top:0"><div class="wrap"><span class="label">Características</span><h2 class="sub">O que ${esc(f.n)} entrega</h2>${prGrid(f.feat)}</div></section>
<section class="sec dark on-dark"><div class="wrap"><span class="label">Benefícios</span><h2 style="margin-top:18px">Para a sua produção</h2><div class="cards3">${f.ben.map((x, i) => `<div class="step"><div><b>0${i + 1}.</b></div><h3>${txt(x)}</h3></div>`).join('')}</div></div></section>
<section class="sec"><div class="wrap"><span class="label">Versões</span><h2 style="margin-top:18px">${esc(f.n)}: qual usar</h2><div class="tbl"><table><thead><tr><th scope="col">Produto</th><th scope="col">Substrato ou uso</th><th scope="col">Indicado para</th></tr></thead><tbody>${rows}</tbody></table></div>
<div style="margin-top:44px"><span class="label">Onde é usado</span><div class="tags">${segs.map((s) => `<a href="/segmentos/${s.id}/">${esc(s.n)}</a>`).join('')}</div></div></div></section>
<section class="sec" style="padding-top:0"><div class="wrap faq-wrap"><div><span class="label">Perguntas frequentes</span><h2>${esc(f.n)}: dúvidas comuns</h2><div class="chips">${f.kw.slice(0, 3).map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div></div><div>${faq(f.faq)}</div></div></section>
<section class="sec dark on-dark"><div class="wrap two"><div><span class="label">Fale com o comercial</span><h2>Fale sobre o seu projeto com ${esc(f.n)}</h2>
<p class="lead" style="color:var(--on-dark-mut);margin-top:18px">WhatsApp: <a href="${esc(waUrl(site))}" target="_blank" rel="noopener">${esc(site.whatsappDisplay)}</a><br>Telefone: <a href="tel:${site.phone}">${esc(site.phoneDisplay)}</a><br>E-mail: <a href="mailto:${site.email}">${esc(site.email)}</a></p></div><div style="color:var(--ink)">${lead(ctx, { product: f.id, pageUrl: path })}</div></div></section>
<section class="sec"><div class="wrap"><span class="label">Veja também</span><div class="cards" style="margin-top:22px">${related.map((x) => `<a class="card" href="/produtos/${x.id}/"><h3>${esc(x.n)}</h3><p>${txt(x.short)}</p><span class="more">Ver detalhes ${AR}</span></a>`).join('')}</div></div></section>`;
  const description = plain(f.meta);
  return { path, title: f.title, description, body, withForm: true, image: '/og-default.png',
    graph: [pageNode(site, { type: 'WebPage', name: f.title, description, path, about: { '@type': 'Product', name: f.n, description: plain(f.def), category: 'Tintas, vernizes e acabamentos industriais', brand: { '@type': 'Brand', name: site.name }, manufacturer: { '@id': abs(site, '/#organizacao') } } }),
      breadcrumbNode(site, bc), faqNode(f.faq)] };
}

/* ---------------- SEGMENTO ---------------- */
export function segmento(ctx, s) {
  const { site, families } = ctx;
  const path = `/segmentos/${s.id}/`;
  const bc = [{ name: 'Início', path: '/' }, { name: 'Segmentos', path: '/segmentos/' }, { name: s.n, path }];
  const prods = s.prods.map((id) => families.find((f) => f.id === id)).filter(Boolean);
  const chars = s.chars ? `<section class="sec dark on-dark"><div class="wrap"><span class="label">Características mais importantes</span><h2 style="margin-top:18px">O que a embalagem de ${esc(s.n.toLowerCase())} exige</h2><div class="cards3">${s.chars.map((x, i) => `<div class="step"><div><b>0${i + 1}.</b></div><h3 style="font-size:18px">${txt(x)}</h3></div>`).join('')}</div></div></section>` : '';
  const body = `<div class="wrap">${crumbs(bc)}
<div class="ph2"><div><span class="label">Segmento · ${esc(s.n)}</span><h1>${txt(s.h1)}</h1><p class="def">${txt(s.intro)}</p>
<div class="how"><b>Como funciona</b>${txt(s.how)}</div>${waBtn(ctx, 'Falar sobre o meu projeto', `Olá! Tenho um projeto no segmento ${s.n} e gostaria de falar com o comercial.`)}${updated(site)}</div>${photo('segmento-' + s.id)}</div></div>
<section class="sec" style="padding-top:0"><div class="wrap"><span class="label">Aplicações</span><h2 class="sub">O que atendemos em ${esc(s.n)}</h2>${prGrid(s.apps)}</div></section>
${chars}
<section class="sec dark on-dark"><div class="wrap"><span class="label">Produtos indicados</span><h2 style="margin-top:18px">Famílias recomendadas para ${esc(s.n)}</h2><div class="tags">${prods.map((p) => `<a href="/produtos/${p.id}/">${esc(p.n)}</a>`).join('')}</div></div></section>
<section class="sec"><div class="wrap faq-wrap"><div><span class="label">Perguntas frequentes</span><h2>${esc(s.n)}: dúvidas comuns</h2></div><div>${faq(s.faq)}</div></div></section>
<section class="sec tint"><div class="wrap two"><div><span class="label">Fale com o comercial</span><h2>Vamos testar na sua peça?</h2><p class="lead" style="margin-top:18px">Envie o material e o acabamento desejado.</p></div><div>${lead(ctx, { pageUrl: path })}</div></div></section>`;
  const description = plain(s.meta);
  return { path, title: s.title, description, body, withForm: true,
    graph: [pageNode(site, { type: 'WebPage', name: s.title, description, path }), breadcrumbNode(site, bc), faqNode(s.faq)] };
}

/* ---------------- CONTEÚDO TÉCNICO ---------------- */
export function artigosHub(ctx) {
  const { site, articles } = ctx;
  const path = '/conteudo-tecnico/';
  const title = 'Conteúdo técnico sobre verniz UV e metalização | Corquímica';
  const description = 'Artigos da Corquímica sobre verniz UV, metalização a vácuo, lacas, tintas para plástico e acabamento industrial. Conteúdo para quem produz.';
  const bc = [{ name: 'Início', path: '/' }, { name: 'Conteúdo técnico', path }];
  const body = `<div class="wrap">${crumbs(bc)}<div class="head"><span class="label">Conteúdo técnico</span><h1>Conteúdo técnico para quem produz</h1><p class="def">Guias práticos sobre verniz UV, metalização a vácuo, lacas e tintas para plástico, escritos pela equipe da Corquímica.</p></div>
<div class="cards">${articles.map((a) => `<a class="card" href="/conteudo-tecnico/${a.slug}/"><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p><span class="more">Ler artigo ${AR}</span></a>`).join('')}</div></div>
${cta(ctx, 'Ficou com dúvida?', 'Fale com a equipe técnica pelo WhatsApp.', 'Olá! Li um conteúdo do site e tenho uma dúvida técnica.')}`;
  return { path, title, description, body, graph: [pageNode(site, { type: 'CollectionPage', name: title, description, path }), breadcrumbNode(site, bc)] };
}
export function artigo(ctx, a) {
  const { site } = ctx;
  const path = `/conteudo-tecnico/${a.slug}/`;
  const bc = [{ name: 'Início', path: '/' }, { name: 'Conteúdo técnico', path: '/conteudo-tecnico/' }, { name: a.title, path }];
  const faqList = Array.isArray(a.faq) ? a.faq.filter((x) => x && x.q && x.a).map((x) => [x.q, x.a]) : [];
  const fam = ctx.families.find((f) => f.id === a.category);
  const published = (a.published_at || site.contentUpdated).slice(0, 10);
  const modified = (a.updated_at || a.published_at || site.contentUpdated).slice(0, 10);
  const body = `<div class="wrap">${crumbs(bc)}<article class="prose"><span class="label">Conteúdo técnico</span><h1>${esc(a.title)}</h1>
<p class="def">${esc(a.description)}</p><p class="upd">Publicado em ${new Date(published + 'T12:00:00').toLocaleDateString('pt-BR')} · Atualizado em ${new Date(modified + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
${md(a.body_md)}
${fam ? `<p class="how"><b>Produto relacionado</b><a href="/produtos/${fam.id}/">${esc(fam.n)}</a></p>` : ''}
${faqList.length ? `<h2>Perguntas frequentes</h2>${faq(faqList, false)}` : ''}</article></div>
${cta(ctx, 'Quer aplicar isso na sua peça?', 'Fale com a equipe técnica pelo WhatsApp.', `Olá! Li o artigo "${a.title}" e quero falar sobre o meu projeto.`)}`;
  return { path, title: `${a.title} | Corquímica`.length > 62 ? `${a.title}`.slice(0, 58) + ' | Corquímica' : `${a.title} | Corquímica`, description: a.description, body, ogType: 'article',
    graph: [pageNode(site, { type: 'Article', name: a.title, description: a.description, path, dateModified: modified }), { '@type': 'Article', '@id': abs(site, path) + '#artigo', headline: a.title, description: a.description, datePublished: published, dateModified: modified, inLanguage: 'pt-BR', author: { '@id': abs(site, '/#organizacao') }, publisher: { '@id': abs(site, '/#organizacao') }, mainEntityOfPage: abs(site, path) }, breadcrumbNode(site, bc), ...(faqList.length ? [faqNode(faqList)] : [])] };
}

/* ---------------- PRIVACIDADE e 404 ---------------- */
export function privacidade(ctx) {
  const { site } = ctx;
  const path = '/politica-de-privacidade/';
  const title = 'Política de privacidade | Corquímica';
  const description = 'Como a Corquímica trata os dados enviados pelo site, em conformidade com a LGPD: finalidade, base legal, prazo e direitos do titular.';
  const bc = [{ name: 'Início', path: '/' }, { name: 'Política de privacidade', path }];
  const body = `<div class="wrap">${crumbs(bc)}<article class="prose"><h1>Política de privacidade</h1>
<p class="def">Esta política explica como a ${esc(site.legalName)} trata os dados enviados por este site.${txt(' [VALIDAR revisão jurídica antes de publicar]')}</p>
<h2>Quais dados coletamos</h2><p>Quando você usa o formulário do site, coletamos o nome e a empresa informados, o material da peça, o segmento, a mensagem e a página de origem. Não pedimos CPF, documentos nem dados sensíveis.</p>
<h2>Para que usamos</h2><p>Usamos esses dados apenas para responder ao seu contato comercial e enviar amostras e informações técnicas. Base legal: consentimento e procedimentos preliminares de contrato (LGPD, art. 7º).</p>
<h2>Com quem compartilhamos</h2><p>Os dados ficam em banco de dados do provedor Supabase e no WhatsApp, quando você envia a mensagem. Não vendemos dados.${txt(' [VALIDAR confirmar região do banco e operadores]')}</p>
<h2>Por quanto tempo guardamos</h2><p>Guardamos os dados pelo tempo necessário ao atendimento comercial.${txt(' [VALIDAR definir prazo]')}</p>
<h2>Seus direitos</h2><p>Você pode pedir acesso, correção ou exclusão dos seus dados pelo e-mail <a href="mailto:${site.email}">${esc(site.email)}</a>.</p></article></div>`;
  return { path, title, description, body, noindex: true, graph: [pageNode(site, { name: title, description, path }), breadcrumbNode(site, bc)] };
}
export function notFound(ctx) {
  const body = `<div class="wrap"><div class="head" style="padding-block:80px"><span class="label">Erro 404</span><h1>Página não encontrada</h1><p class="def">O endereço pode ter mudado. Veja os produtos ou fale com a gente pelo WhatsApp.</p><div class="btnrow" style="margin-top:24px">${pb('Ver produtos', '/produtos/')}${waBtn(ctx, 'Falar no WhatsApp', 'Olá! Não encontrei o que procurava no site.')}</div></div></div>`;
  return { path: '/404.html', title: 'Página não encontrada | Corquímica', description: 'A página que você procurava não foi encontrada. Veja os produtos da Corquímica ou fale pelo WhatsApp.', body, noindex: true, graph: [] };
}
