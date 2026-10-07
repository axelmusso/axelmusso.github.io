// Utilitários: escape, marcadores de pendência, markdown mínimo, fotos.
import fs from 'node:fs';
import path from 'node:path';

export const state = {
  mode: 'staging',        // 'staging' (rascunho, não indexável) ou 'production'
  pendingText: [],        // trechos com [VALIDAR]
  pendingPhotos: new Set(), // fotos que ainda não existem
  page: '',
};

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PEND = /\s*\[VALIDAR([^\]]*)\]/g;
export const hasPending = (s) => /\[VALIDAR[^\]]*\]/.test(String(s ?? ''));

// Texto seguro para HTML. Em rascunho mostra a marca VALIDAR; em produção remove.
export function txt(s) {
  const raw = String(s ?? '');
  if (hasPending(raw)) state.pendingText.push({ page: state.page, text: raw.replace(PEND, '').slice(0, 90) });
  const clean = esc(raw);
  return clean.replace(PEND, (_, extra) =>
    state.mode === 'staging' ? ` <mark class="pend">VALIDAR${esc(extra)}</mark>` : '');
}
// Texto puro (sem HTML), sem marcadores. Usado em meta, JSON-LD e llms.txt.
export const plain = (s) => String(s ?? '').replace(PEND, '').replace(/\s+/g, ' ').trim();

// Markdown mínimo: ## ### listas - e 1. , **negrito**, *itálico*, [link](url), parágrafos.
export function md(src) {
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, (_, a, u) => `<a href="${u}">${a}</a>`);
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of String(src ?? '').split(/\r?\n/)) {
    const l = line.trimEnd();
    if (!l.trim()) { close(); continue; }
    let m;
    if ((m = l.match(/^###\s+(.*)/))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = l.match(/^##\s+(.*)/))) { close(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = l.match(/^[-*]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = l.match(/^\d+\.\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else { close(); out.push(`<p>${inline(l)}</p>`); }
  }
  close();
  return out.join('\n');
}

// ---- fotos ----
export const photoFiles = new Map(); // slot -> nome do arquivo
export function scanPhotos(dir) {
  photoFiles.clear();
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(.+)\.(webp|jpe?g|png|avif)$/i);
    if (m) photoFiles.set(m[1], f);
  }
}
export let photoMeta = {};
export const setPhotoMeta = (m) => { photoMeta = m; };

const RATIO = { r43: 'r43', r45: 'r45', hero: 'r169', card: 'r43' };
export function photo(slot, { eager = false } = {}) {
  const meta = photoMeta[slot] || { alt: slot, shot: slot, ratio: 'r43' };
  const file = photoFiles.get(slot);
  const cls = RATIO[meta.ratio] || 'r43';
  if (file) {
    return `<figure class="phimg ${cls}"><img src="/img/${esc(file)}" alt="${esc(meta.alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></figure>`;
  }
  state.pendingPhotos.add(slot);
  if (state.mode === 'staging') {
    return `<div class="ph ${cls}" role="img" aria-label="${esc(meta.alt)}"><span>FOTO REAL: ${esc(meta.shot)}</span></div>`;
  }
  return `<div class="ph ${cls}" role="img" aria-label="${esc(meta.alt)}"></div>`;
}
// Foto como fundo de bloco (hero, cartões do mosaico).
export function photoBg(slot) {
  const meta = photoMeta[slot] || { alt: slot, shot: slot };
  const file = photoFiles.get(slot);
  if (file) return { style: ` style="background-image:linear-gradient(180deg,#0a0a3c99,#0a0a3ccc),url('/img/${esc(file)}');background-size:cover;background-position:center"`, tag: '' };
  state.pendingPhotos.add(slot);
  return { style: '', tag: state.mode === 'staging' ? `<span class="ph-tag">FOTO REAL: ${esc(meta.shot)}</span>` : '' };
}
