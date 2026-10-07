// SEO técnico: <head>, Open Graph e dados estruturados (JSON-LD).
import { esc, plain } from './util.mjs';

export const abs = (site, p) => site.url.replace(/\/$/, '') + p;

const ld = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

export function orgNode(site) {
  return {
    '@type': 'Organization',
    '@id': abs(site, '/#organizacao'),
    name: site.name,
    legalName: site.legalName,
    url: abs(site, '/'),
    logo: abs(site, '/favicon.svg'),
    description: site.description,
    foundingDate: String(site.foundingYear),
    email: site.email,
    telephone: site.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      addressCountry: site.address.country,
    },
    areaServed: { '@type': 'Country', name: 'Brasil' },
    contactPoint: [
      { '@type': 'ContactPoint', contactType: 'sales', telephone: '+' + site.whatsapp, availableLanguage: 'pt-BR', description: 'WhatsApp' },
      { '@type': 'ContactPoint', contactType: 'sales', telephone: site.phone, email: site.email, availableLanguage: 'pt-BR' },
    ],
    sameAs: site.social,
    knowsAbout: ['Verniz UV', 'Metalização a vácuo', 'Laca acrílica', 'Tintas para plástico', 'Corantes UV', 'Solventes industriais'],
  };
}
export const websiteNode = (site) => ({
  '@type': 'WebSite', '@id': abs(site, '/#site'), url: abs(site, '/'), name: site.name,
  inLanguage: 'pt-BR', publisher: { '@id': abs(site, '/#organizacao') },
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
export const pageNode = (site, { type = 'WebPage', name, description, path, about, dateModified }) => ({
  '@type': type, '@id': abs(site, path) + '#pagina', url: abs(site, path), name: plain(name),
  description: plain(description), inLanguage: 'pt-BR',
  isPartOf: { '@id': abs(site, '/#site') }, publisher: { '@id': abs(site, '/#organizacao') },
  dateModified: dateModified || site.contentUpdated,
  ...(about ? { about } : {}),
});

export function head(site, p) {
  const url = abs(site, p.path);
  const image = abs(site, p.image || '/og-default.png');
  const robots = p.noindex
    ? 'noindex, nofollow'
    : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1';
  const graph = [orgNode(site), websiteNode(site), ...(p.graph || [])];
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plain(p.title))}</title>
<meta name="description" content="${esc(plain(p.description))}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" hreflang="pt-BR" href="${esc(url)}">
<meta property="og:type" content="${p.ogType || 'website'}">
<meta property="og:locale" content="pt_BR">
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${ld({ '@context': 'https://schema.org', '@graph': graph })}`;
}
