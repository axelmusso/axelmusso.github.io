// IndexNow: avisa o Bing (e os buscadores que usam o índice dele, inclusive o que alimenta o ChatGPT)
// que páginas mudaram. Roda no GitHub depois de publicar. Lê o sitemap do site no ar.
// Uso: node scripts/indexnow.mjs [todas]   (sem "todas": só as com lastmod nos últimos 2 dias)
import fs from 'node:fs';

const site = JSON.parse(fs.readFileSync(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const host = new URL(site.url).host;
const todas = process.argv[2] === 'todas';

// Logo depois da publicação o endereço do site às vezes ainda não resolve no servidor do GitHub (EAI_AGAIN):
// tenta até 5 vezes, com 20 s entre as tentativas.
async function buscar(url, opcoes) {
  for (let i = 1; ; i++) {
    try { return await fetch(url, opcoes); }
    catch (e) { if (i >= 5) throw e; console.log(`Tentativa ${i} falhou (${e.cause?.code ?? e.message}); de novo em 20 s.`); await new Promise((r) => setTimeout(r, 20_000)); }
  }
}

const sm = await (await buscar(site.url + '/sitemap.xml')).text();
const limite = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
const urls = [...sm.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)]
  .filter(([, , lastmod]) => todas || lastmod >= limite)
  .map(([, loc]) => loc);

if (!urls.length) { console.log('IndexNow: nenhuma página mudou nos últimos 2 dias.'); process.exit(0); }
const r = await buscar('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key: site.indexNowKey, keyLocation: `${site.url}/${site.indexNowKey}.txt`, urlList: urls.slice(0, 10000) }),
});
// 200 e 202 = recebido. Erro aqui não derruba a publicação.
console.log(`IndexNow: ${urls.length} URL(s), resposta ${r.status}.`);
