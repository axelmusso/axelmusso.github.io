// Gera public/apresentacao-corquimica.pdf a partir de src/apresentacao/apresentacao.html,
// usando o Google Chrome instalado no Mac em modo sem janela (nenhuma biblioteca nova).
// Uso: node scripts/gerar-apresentacao.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origem = path.join(RAIZ, 'src/apresentacao/apresentacao.html');
const destino = path.join(RAIZ, 'public/apresentacao-corquimica.pdf');

execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${destino}`, 'file://' + origem], { stdio: 'ignore' });
const kb = Math.round(fs.statSync(destino).size / 1024);
console.log(`PDF gerado: public/apresentacao-corquimica.pdf (${kb} KB)`);
if (kb > 1500) console.log('Atenção: acima de 1,5 MB; vale reduzir as fotos.');
