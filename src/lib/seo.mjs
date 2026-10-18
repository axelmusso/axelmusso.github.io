// SEO técnico: <head>, Open Graph, hreflang e dados estruturados (JSON-LD).
import { esc, plain } from './util.mjs';
import { META, LANGS } from './i18n.mjs';

export const abs = (site, p) => site.url.replace(/\/$/, '') + p;

const ld = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

export function orgNode(ctx) {
  const { site, t } = ctx;
  return {
    // Também LocalBusiness: tem endereço físico (a fábrica), o que ajuda buscas locais e o Google Maps.
    '@type': ['Organization', 'LocalBusiness'],
    '@id': abs(site, '/#organizacao'),
    image: abs(site, '/og-default.png'),
    name: site.name,
    legalName: site.legalName,
    url: abs(site, '/'),
    logo: abs(site, '/icon-512.png'),
    description: site.description,
    foundingDate: String(site.foundingYear),
    email: site.email,
    telephone: site.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street + ', ' + site.address.district,
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    areaServed: { '@type': 'Country', name: t.areaServed },
    contactPoint: [
      { '@type': 'ContactPoint', contactType: 'sales', telephone: '+' + site.whatsapp, availableLanguage: 'pt-BR', description: 'WhatsApp' },
      { '@type': 'ContactPoint', contactType: 'sales', telephone: site.phone, email: site.email, availableLanguage: 'pt-BR' },
    ],
    sameAs: site.social,
    knowsAbout: t.knowsAbout,
  };
}
export const websiteNode = (ctx) => ({
  '@type': 'WebSite', '@id': abs(ctx.site, '/#site'), url: abs(ctx.site, '/'), name: ctx.site.name,
  inLanguage: LANGS.map((l) => META[l].html), publisher: { '@id': abs(ctx.site, '/#organizacao') },
});
export const breadcrumbNode = (site, items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem', position: i + 1, name: it.name, item: abs(site, it.path),
  })),
});
export const faqNode = (list) => ({
  '@type': 'FAQPage',
  mainEntity: list.map(([q, a]) => ({
    '@type': 'Question', name: plain(q), acceptedAnswer: { '@type': 'Answer', text: plain(a) },
  })),
});
export const pageNode = (ctx, { type = 'WebPage', name, description, path, about, dateModified }) => ({
  '@type': type, '@id': abs(ctx.site, path) + '#pagina', url: abs(ctx.site, path), name: plain(name),
  description: plain(description), inLanguage: META[ctx.lang].html,
  isPartOf: { '@id': abs(ctx.site, '/#site') }, publisher: { '@id': abs(ctx.site, '/#organizacao') },
  dateModified: dateModified || ctx.site.contentUpdated,
  ...(about ? { about } : {}),
});

export function head(ctx, p) {
  const { site, lang } = ctx;
  const url = abs(site, p.path);
  const image = abs(site, p.image || '/og-default.png');
  const robots = p.noindex
    ? 'noindex, nofollow'
    : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1';
  const graph = [orgNode(ctx), websiteNode(ctx), ...(p.graph || [])];
  // hreflang: a página em cada idioma disponível, mais x-default (português).
  const alt = p.alt || { [lang]: p.path };
  const hreflang = p.path === '/404.html' ? '' : LANGS.filter((l) => alt[l]).map((l) => `<link rel="alternate" hreflang="${META[l].html}" href="${esc(abs(site, alt[l]))}">`).join('\n')
    + (alt.pt ? `\n<link rel="alternate" hreflang="x-default" href="${esc(abs(site, alt.pt))}">` : '');
  // Política de segurança: só scripts do próprio site; fontes do Google; dados só para o Supabase do formulário.
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com', "img-src 'self' data:", `connect-src 'self'${ctx.supabase?.url ? ' ' + ctx.supabase.url : ''}`,
    "form-action 'self' https://wa.me", "base-uri 'self'", "object-src 'none'",
  ].join('; ');
  const ogAlt = LANGS.filter((l) => l !== lang && alt[l]).map((l) => `<meta property="og:locale:alternate" content="${META[l].og}">`).join('\n');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(plain(p.title))}</title>
<meta name="description" content="${esc(plain(p.description))}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(url)}">
${hreflang}
<meta property="og:type" content="${p.ogType || 'website'}">
<meta property="og:locale" content="${META[lang].og}">
${ogAlt}
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(plain(p.title))}">
<meta property="og:description" content="${esc(plain(p.description))}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(plain(p.title))}">
<meta name="twitter:description" content="${esc(plain(p.description))}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#0A0A3C">
<link rel="icon" href="/favicon.ico?v=2" sizes="48x48">
<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png?v=2" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
${ld({ '@context': 'https://schema.org', '@graph': graph })}`;
}
