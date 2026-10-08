// Cópias de segurança no Supabase (pasta privada "site-versoes" + tabela site_versoes).
// Uso (no GitHub Actions, com a variável SB_KEY = chave secreta do Supabase):
//   node scripts/backup.mjs site                 guarda o código-fonte e o site pronto (dist/) desta versão
//   node scripts/backup.mjs contatos             guarda uma cópia da tabela de contatos (leads)
//   node scripts/backup.mjs baixar <codigo> <arquivo.zip>   baixa o .zip de uma versão (usado na restauração)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/supabase.public.json'), 'utf8'));
const URL_SB = (process.env.SUPABASE_URL || pub.url).replace(/\/$/, '');
const KEY = process.env.SB_KEY || '';
const BUCKET = 'site-versoes';
const [mode, ...args] = process.argv.slice(2);

if (!KEY) {
  console.log('::warning::Backup no Supabase não feito: falta o segredo SUPABASE_SECRET_KEY no GitHub (veja o README, seção "Versões e backups").');
  process.exit(mode === 'baixar' ? 1 : 0);
}
// Chaves novas (sb_secret_…) vão só no cabeçalho apikey; as antigas (JWT) também no Authorization.
const auth = { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) };
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString().trim();
// Data e hora de Brasília, ex.: 2026-10-08 15:30
const agora = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

async function upload(dest, body, type) {
  const r = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}/${dest}`, { method: 'POST', headers: { ...auth, 'Content-Type': type, 'x-upsert': 'true' }, body });
  if (!r.ok) throw new Error(`upload ${dest}: HTTP ${r.status} ${await r.text()}`);
}
async function registrar(row) {
  const r = await fetch(`${URL_SB}/rest/v1/site_versoes`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`registro: HTTP ${r.status} ${await r.text()}`);
}

if (mode === 'site') {
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) throw new Error('rode o build antes (falta dist/)');
  const sha = process.env.GITHUB_SHA || sh('git rev-parse HEAD');
  const descricao = sh(`git log -1 --pretty=%s ${sha}`);
  const versao = agora();
  const tmp = fs.mkdtempSync('/tmp/versao-');
  const zip = path.join(tmp, 'versao.zip');
  // fonte/ = arquivos do repositório nesta versão; site/ = o site pronto que foi publicado
  sh(`git archive --format=zip --prefix=fonte/ -o "${zip}" ${sha}`);
  fs.cpSync(path.join(ROOT, 'dist'), path.join(tmp, 'site'), { recursive: true });
  sh(`zip -qr "${zip}" site`, { cwd: tmp });
  const nome = `site/${versao.replace(' ', '_').replace(':', '-')}_${sha.slice(0, 7)}.zip`;
  const buf = fs.readFileSync(zip);
  await upload(nome, buf, 'application/zip');
  await registrar({ tipo: 'site', versao, commit_sha: sha, descricao, arquivo: nome, tamanho_bytes: buf.length, execucao_url: run });
  console.log(`Backup guardado: ${nome} (${(buf.length / 1048576).toFixed(1)} MB), versão ${versao}, código ${sha.slice(0, 7)}.`);
} else if (mode === 'contatos') {
  const r = await fetch(`${URL_SB}/rest/v1/leads?select=*&order=created_at.asc`, { headers: auth });
  if (!r.ok) throw new Error(`leitura dos contatos: HTTP ${r.status}`);
  const rows = await r.json();
  const versao = agora();
  const nome = `contatos/${versao.slice(0, 10)}.json`;
  const body = JSON.stringify(rows, null, 1);
  await upload(nome, body, 'application/json');
  await registrar({ tipo: 'contatos', versao, descricao: `${rows.length} contato(s)`, arquivo: nome, tamanho_bytes: Buffer.byteLength(body) });
  console.log(`Cópia dos contatos guardada: ${nome} (${rows.length} registros).`);
} else if (mode === 'baixar') {
  const [codigo, saida] = args;
  if (!codigo || !saida) throw new Error('uso: node scripts/backup.mjs baixar <codigo> <arquivo.zip>');
  const q = `${URL_SB}/rest/v1/site_versoes?select=arquivo,versao,commit_sha&tipo=eq.site&commit_sha=like.${encodeURIComponent(codigo)}*&order=criado_em.desc&limit=1`;
  const r = await fetch(q, { headers: auth });
  const [row] = r.ok ? await r.json() : [];
  if (!row) throw new Error(`versão ${codigo} não encontrada no Supabase`);
  const f = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}/${row.arquivo}`, { headers: auth });
  if (!f.ok) throw new Error(`download: HTTP ${f.status}`);
  fs.writeFileSync(saida, Buffer.from(await f.arrayBuffer()));
  console.log(`Baixado ${row.arquivo} (versão ${row.versao}, código ${row.commit_sha.slice(0, 7)}).`);
} else {
  console.log('uso: node scripts/backup.mjs site | contatos | baixar <codigo> <arquivo.zip>');
  process.exit(1);
}
