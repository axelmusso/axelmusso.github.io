// Redação dos e-mails comerciais (1º contato, follow-ups, retomadas e respostas). Usada pela prospecção e pela cadência.
import { banco, chamarIA } from './ia.ts';
import { buscarMemoria } from './memoria.ts';
import { jsonDe } from './web.ts';

export const SOBRE_A_CORQUIMICA = `Corquímica Ind. e Com. Ltda, fabricante desde 1997 em Estância Velha (RS), mais de 100 clientes no Brasil.
Produtos em foco: Verniz UV Base, Verniz UV Top Coat, Lacas, Corantes UV, Resinas 3D, Solventes.
Atende moda e calçados (saltos, solados, acessórios), moveleiro, automotivo, cosméticos (frascos, tampas), linha branca e plástico em geral.
Quando o cliente procura a Corquímica: problema de qualidade no acabamento (aderência, brilho, trinca, cura) ou homologação de um novo fornecedor.
Não invente números, prazos, certificações nem casos de clientes: use só o que está aqui ou no dado da empresa.`;

const PROIBIDO = /espero que (esteja|estejam|você esteja) bem|tudo bem\?|venho por meio|gostaria de apresentar|soluç(ão|ões) inovador|líder (de|no) mercado|qualidade incompar|excelência/i;
export type Rascunho = { sem_gancho?: boolean; motivo?: string; assunto: string; corpo: string; angulo: string };

// Regras do texto que a máquina confere antes de pôr na fila de aprovação.
export function problemas(t: Rascunho) {
  const p: string[] = [];
  const corpo = (t.corpo ?? '').trim();
  if ((corpo.match(/\?/g) ?? []).length !== 1 || !corpo.endsWith('?')) p.push('o corpo deve ter uma pergunta só, na última frase');
  if (!/celular|whats/i.test(corpo.split(/[.!]\s/).pop() ?? '')) p.push('a pergunta final deve pedir o celular para seguir pelo WhatsApp');
  if (PROIBIDO.test(corpo) || PROIBIDO.test(t.assunto ?? '')) p.push('tem frase de vendedor proibida');
  if (corpo.split(/\s+/).length > 120) p.push('passou de 120 palavras');
  if ((t.assunto ?? '').length > 70) p.push('assunto com mais de 70 caracteres');
  return p;
}

// O que cada passo da cadência pede. 1–4: sequência de 14 dias. 5–7: retomadas a cada 60 dias.
function pedidoDoPasso(passo: number, retomada: boolean, meses: number | null) {
  const fim = 'Termine com UMA pergunta pedindo o celular para seguir pelo WhatsApp e mostrar o produto na prática.';
  if (passo >= 5) return `Escreva uma RETOMADA depois de cerca de 2 meses sem resposta aos e-mails anteriores. Traga um motivo NOVO para falar agora (diferente dos e-mails anteriores), reconheça com leveza que já escreveu antes, sem cobrar. ${fim}`;
  if (retomada) return [
    `Escreva um e-mail de RETOMADA para um ex-cliente: comprou da Corquímica pela última vez há cerca de ${meses ?? 'alguns'} meses. Não finja que é o primeiro contato. Reconheça o tempo sem pedidos sem cobrar nem culpar e traga um motivo concreto para voltar a conversar (um dos produtos em foco). ${fim}`,
    `Segundo e-mail para o ex-cliente, com OUTRO ângulo: um produto em foco que talvez ele não tenha usado e o problema de acabamento que ele resolve. Não repita o e-mail anterior. ${fim}`,
    `Terceiro e-mail para o ex-cliente: ofereça um teste prático na linha dele (amostra), dizendo em uma frase como funciona. Sem inventar casos. ${fim}`,
    `Último e-mail curto (até 50 palavras) da sequência para o ex-cliente: diga que vai parar de escrever por enquanto e deixe a porta aberta. ${fim}`,
  ][passo - 1];
  return [
    `Escreva o PRIMEIRO e-mail de prospecção. Abra com o gancho (fato verdadeiro e específico desta empresa) em uma frase e ligue a uma situação em que a Corquímica ajuda (qualidade no acabamento ou homologação de fornecedor). ${fim} Se o gancho não permitir um e-mail honesto e específico, devolva {"sem_gancho": true, "motivo": "..."}.`,
    `Segundo e-mail, 3 dias úteis depois, com OUTRO ângulo (não é reenvio): o problema de acabamento mais comum no segmento desta empresa e por que costuma acontecer. ${fim}`,
    `Terceiro e-mail: ofereça um teste prático na linha da empresa (amostra), dizendo em uma frase como funciona. Sem inventar casos de clientes. ${fim}`,
    `Último e-mail curto (até 50 palavras) da sequência: diga que vai parar de escrever por enquanto e deixe a porta aberta. ${fim}`,
  ][passo - 1];
}

const REGRAS = `Regras do texto: português do Brasil, tom de conversa entre profissionais, até 90 palavras no corpo, sem saudação genérica ("espero que esteja bem"), sem adjetivo de vendedor, sem lista, sem link, sem assinatura (ela é colocada depois). Comece por "Olá" + nome do contato se houver, senão "Olá, pessoal da <empresa>". Uma pergunta só, e ela é a última frase. Assunto curto (até 60 caracteres), sem caixa alta e sem ponto de exclamação.
Responda só com JSON: {"assunto":"","corpo":"","angulo":"nome curto da abordagem"}`;

// Escreve o e-mail do passo. Devolve o rascunho conferido (ou "sem gancho"), as memórias usadas e o custo.
export async function redigirEmail(o: { empresa: Record<string, any>; contato: Record<string, any>; passo: number; tipo: 'prospeccao' | 'retomada'; manual: boolean; jobId?: string | null }) {
  const { empresa: e, contato, passo, tipo, manual } = o;
  const retomada = tipo === 'retomada';
  const anteriores = await banco(`/rest/v1/emails?select=passo,assunto,corpo&empresa_id=eq.${e.id}&status=eq.enviado&order=enviado_em`);
  const mem = await buscarMemoria(`e-mail de ${tipo}, passo ${passo}, para empresa de ${e.setor ?? 'indústria'}: assunto, ângulo e resposta`, 3, manual);
  const meses = e.ultima_compra ? Math.max(1, Math.round((Date.now() - new Date(e.ultima_compra).getTime()) / (30.4 * 864e5))) : null;
  const contexto = `${SOBRE_A_CORQUIMICA}

EMPRESA: ${JSON.stringify({ nome: e.nome, setor: e.setor, cidade: e.cidade, uf: e.uf, gancho: e.gancho, gancho_fonte: e.gancho_fonte, icp_motivo: e.icp_motivo })}
CONTATO: ${JSON.stringify({ nome: contato.nome, cargo: contato.cargo })}
${anteriores.length ? 'E-MAILS JÁ ENVIADOS (não repita):\n' + anteriores.map((a: Record<string, unknown>) => `[passo ${a.passo}] ${a.assunto}\n${a.corpo}`).join('\n\n') + '\n' : ''}${mem.length ? 'APRENDIZADOS DA MEMÓRIA (use se ajudarem):\n' + mem.map((m: Record<string, unknown>) => `#${String(m.id).slice(0, 8)} ${m.hipotese}`).join('\n') + '\n' : ''}
${pedidoDoPasso(passo, retomada, meses)}
${REGRAS}`;
  const instrucoes = 'Você escreve e-mails comerciais B2B curtos, honestos e específicos para a Corquímica, assinados por Fernando Gutierrez.';
  const memorias = mem.map((m) => m.id);
  let r = await chamarIA({ provedor: 'anthropic', papel: 'redator', nivel: 'rotina', manual, maxTokens: 2000, memorias, jobId: o.jobId, instrucoes, contexto });
  let t = jsonDe<Rascunho>(r.texto);
  let custo = r.custoUsd;
  if (t.sem_gancho) return { sem_gancho: true as const, motivo: t.motivo ?? '', custo, memorias };
  if (problemas(t).length) { // uma revisão com o que falhou
    r = await chamarIA({ provedor: 'anthropic', papel: 'redator', nivel: 'rotina', manual, maxTokens: 2000, memorias, jobId: o.jobId, instrucoes, contexto: contexto + `\n\nSua versão anterior:\n${JSON.stringify(t)}\nCorrija: ${problemas(t).join('; ')}.` });
    t = jsonDe<Rascunho>(r.texto); custo += r.custoUsd;
  }
  return { sem_gancho: false as const, assunto: t.assunto.trim(), corpo: t.corpo.trim(), angulo: t.angulo || `${tipo}-${passo}`, revisar: problemas(t), custo, memorias };
}

// Lê uma resposta recebida, classifica e rascunha a continuação (que espera aprovação).
export async function classificarResposta(o: { texto: string; assunto: string; empresa: Record<string, any> | null; enviados: { assunto: string; corpo: string }[]; manual: boolean }) {
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'classificador_respostas', nivel: 'rotina', manual: o.manual, maxTokens: 2000,
    instrucoes: `Você lê respostas a e-mails comerciais da Corquímica e prepara a continuação, assinada por Fernando Gutierrez. Responda só com JSON.\n${SOBRE_A_CORQUIMICA}`,
    contexto: `EMPRESA: ${JSON.stringify(o.empresa ? { nome: o.empresa.nome, setor: o.empresa.setor, cidade: o.empresa.cidade } : null)}
O QUE ENVIAMOS:\n${o.enviados.map((e) => e.assunto + '\n' + e.corpo).join('\n---\n') || '(não identificado)'}

RESPOSTA RECEBIDA (assunto: ${o.assunto}):\n${o.texto.slice(0, 6000)}

Classifique em: "interessado" (quer conversar, mandou telefone, pediu amostra/preço), "pergunta" (fez pergunta antes de decidir), "nao_agora" (sem interesse agora, mas educado), "nao" (não quer), "descadastro" (pediu para parar de receber), "automatica" (resposta automática, férias, ausência).
Para interessado, pergunta e nao_agora, escreva o rascunho da resposta: curto, responde o que foi perguntado sem inventar dado técnico (se não souber, diga que confirma por WhatsApp), e se ainda não tiver o celular, peça para seguir pelo WhatsApp. Para nao, descadastro e automatica, rascunho vazio.
Devolva {"classificacao":"","rascunho":"","motivo":"uma frase"}`,
  });
  const v = jsonDe<{ classificacao: string; rascunho: string; motivo: string }>(r.texto);
  const validas = ['interessado', 'pergunta', 'nao_agora', 'nao', 'descadastro', 'automatica'];
  return { classificacao: validas.includes(v.classificacao) ? v.classificacao : 'pergunta', rascunho: (v.rascunho ?? '').trim(), motivo: v.motivo ?? '', custo: r.custoUsd };
}
