// Conteúdo e SEO (Fase 8): o agente escreve o rascunho de uma página a partir de uma proposta da análise de mercado.
//   { acao: 'rascunhar', proposta_id }  → texto pronto em Markdown: fatos da Corquímica só do site, explicação técnica geral do setor
//     (se o dono pediu para refazer, o último motivo e a versão anterior entram no pedido)
//     Regra do dono (19/10): o rascunho sai pronto, com o que se sabe do site e do setor; o que é particular da
//     Corquímica e não está no site fica no nível geral (sem [PREENCHER] e sem expor detalhe interno).
// O rascunho fica no banco. Publicar é decisão humana: aprovado vira página por PR, nunca direto no site.
import { banco, chamarIA, ErroIA } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';
import { ROBO } from '../_shared/web.ts';

const q = encodeURIComponent;
class ErroConteudo extends Error {}

// Fatos que o site já publica (versão para IAs, só português), para o rascunho não inventar nada.
async function nossoSite() {
  const r = await fetch('https://corquimica.com.br/llms-full.txt', { headers: { 'User-Agent': ROBO }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new ErroConteudo('Não consegui ler corquimica.com.br/llms-full.txt.');
  let total = 0;
  return (await r.text()).split(/\n---\n/)
    .map((s) => ({ url: s.match(/^URL:\s*(\S+)/m)?.[1] ?? '', texto: s.replace(/^URL:.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 2500) }))
    .filter((s) => s.url && !/\/(es|en)\//.test(s.url))
    .filter((s) => (total += s.texto.length) <= 45_000);
}

const INSTRUCOES = `Você escreve páginas do site da Corquímica, fabricante de vernizes UV (Base e Top Coat para metalização a vácuo), lacas, tintas para ABS e PS, corantes UV, resinas 3D e solventes, em Estância Velha (RS), desde 1997.
O leitor é o comprador ou o responsável de produção de uma indústria de plástico. Ele chega pelo Google ou por um assistente de IA (ChatGPT, Perplexity, Gemini) com uma pergunta concreta, antes de escolher fornecedor.

Regras (do dono, 19/10/2026: o rascunho deve sair pronto, quase sem nada para preencher, e sem expor a empresa):
1. Sobre a Corquímica (produtos, linhas, o que oferece, cidade, contato), use SOMENTE o que está em FATOS DO SITE.
2. Para responder a pergunta do comprador com profundidade, use o conhecimento técnico geral e consolidado do setor: causas comuns de um defeito, boas práticas de preparo e aplicação, como funciona um processo, o que avaliar numa homologação. Escreva no nível de princípio, sem números específicos (tempos, temperaturas, espessuras, porcentagens, resultados de teste) e sem citar norma que não esteja no site.
3. O que é particular da Corquímica e não está no site (prazos, pedido mínimo, capacidade, números de teste, certificações, nomes de clientes, formulações, detalhes de processo interno) NÃO entra no texto e NÃO vira lacuna para preencher: fique no nível geral ou diga que a equipe técnica avalia caso a caso. Detalhe demais expõe a empresa; na dúvida, generalize.
4. Não use marcadores [PREENCHER]. A única exceção é um dado sem o qual a página ficaria enganosa; mesmo assim, no máximo 1.
5. Assistente de IA cita fato, não adjetivo. Frases curtas e específicas; nada de "qualidade incomparável" ou "solução completa".
6. O primeiro parágrafo responde a pergunta do comprador em 2 ou 3 frases (é o trecho que buscador e IA costumam citar).
7. Escopo plástico. Metal só em enfeites, bijuterias e pés e puxadores de móveis (zamac ou aço). Não fale de madeira.
8. Links internos só para URLs que aparecem em FATOS DO SITE, no formato [texto](/caminho/).
9. Termine com o convite para falar pelo WhatsApp (+55 51 99240-5746) e mandar a peça ou o problema. Sem assinatura de pessoa.
10. Português do Brasil, direto.

Formato de saída (Markdown, exatamente estes campos no topo):
Título SEO: (até 60 caracteres, termina com " | Corquímica")
Descrição: (até 155 caracteres)
URL: (o caminho sugerido)
---
# H1 (diferente do título SEO)
(primeiro parágrafo com a resposta direta)
## seções do esboço...
## Perguntas frequentes
(4 a 6 perguntas reais do comprador, cada uma com resposta curta)
## Fale com a Corquímica
(convite)
---
Para o técnico conferir: (as afirmações técnicas gerais do texto que vale uma olhada de quem conhece o processo, uma por linha; nada para preencher)`;

async function rascunhar(id: string) {
  const [p] = await banco('/rest/v1/propostas_conteudo?select=*&id=eq.' + q(id));
  if (!p) throw new ErroConteudo('Proposta não encontrada.');
  if (['aprovada', 'publicada', 'descartada'].includes(p.status)) throw new ErroConteudo(`Proposta ${p.status}: não reescrevo.`);
  const fatos = await nossoSite();
  const ajuste = (p.ajustes ?? []).at(-1) as { motivo: string } | undefined;
  const refazer = !ajuste ? '' : p.rascunho
    ? `\n\nVERSÃO ANTERIOR, REPROVADA PELO DONO:\n${String(p.rascunho).slice(0, 12_000)}\n\nMOTIVO DO DONO: ${ajuste.motivo}\nReescreva atendendo ao motivo, mantendo as regras.`
    : `\n\nPEDIDO DO DONO PARA ESTA PÁGINA: ${ajuste.motivo}`;
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'redator_conteudo', nivel: 'rotina', manual: true, maxTokens: 8000,
    instrucoes: INSTRUCOES,
    contexto: `PROPOSTA (vinda da análise de concorrência):\n${JSON.stringify({ titulo: p.titulo, tipo: p.tipo, url_sugerida: p.url_sugerida, lacuna: p.lacuna, por_que: p.por_que, esboco: p.esboco })}\n\nFATOS DO SITE (corquimica.com.br):\n${JSON.stringify(fatos)}${refazer}`,
  });
  if (r.truncado) throw new ErroConteudo('O rascunho foi cortado no limite de tokens. Tente de novo.');
  await banco('/rest/v1/propostas_conteudo?id=eq.' + q(id), {
    metodo: 'PATCH',
    corpo: { rascunho: r.texto.trim(), status: 'rascunho', custo_usd: Number((Number(p.custo_usd) + r.custoUsd).toFixed(6)), atualizado_em: new Date().toISOString() },
  });
  return { ok: true, custo: r.custoUsd, marcadores: (r.texto.match(/\[PREENCHER:/g) ?? []).length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador') return json(req, 403, { erro: 'Seu papel não pode escrever conteúdo.' });
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }
  try {
    if (c.acao === 'rascunhar') return json(req, 200, await rascunhar(String(c.proposta_id ?? '')));
    return json(req, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    if (e instanceof ErroIA) return json(req, e.codigo === 'teto' || e.codigo === 'parado' ? 429 : 502, { erro: e.message, codigo: e.codigo });
    return json(req, e instanceof ErroConteudo ? 422 : 400, { erro: (e as Error).message });
  }
});
