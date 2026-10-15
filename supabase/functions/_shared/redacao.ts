// Redação dos e-mails comerciais (1º contato, follow-ups, retomadas e respostas). Usada pela prospecção e pela cadência.
import { banco, chamarIA } from './ia.ts';
import { buscarMemoria } from './memoria.ts';
import { jsonDe } from './web.ts';

export const SOBRE_A_CORQUIMICA = `Corquímica Ind. e Com. Ltda, fabricante desde 1997 em Estância Velha (RS), mais de 100 clientes no Brasil.
Linha: Verniz UV Base, Verniz UV Top Coat, Lacas, Corantes UV, Resinas 3D, Solventes.
Atende moda e calçados (saltos, solados, acessórios), moveleiro, metalização, automotivo, cosméticos (frascos, tampas), linha branca e plástico em geral.
Quando o cliente procura a Corquímica: problema de qualidade no acabamento (aderência, brilho, trinca, cura) ou homologação de um novo fornecedor.
Não invente números, prazos, certificações nem casos de clientes: use só o que está aqui ou no dado da empresa.`;

// O que se pode dizer de produto, conforme o que se sabe da empresa (perfil_produto).
export const PERFIS: Record<string, string> = {
  verniz: 'A empresa USA vernizes/lacas na linha (confirmado). Pode falar de Verniz UV Base, Verniz UV Top Coat, Lacas, Corantes UV e Solventes, e de problemas de acabamento (aderência, brilho, trinca, cura).',
  resina3d: 'A empresa usa SÓ resinas para impressão 3D. Fale apenas de Resinas 3D. NÃO fale de verniz, laca, corante nem acabamento de peças.',
  geral: 'NÃO se sabe se a empresa usa algum produto da Corquímica. NÃO afirme nem suponha que ela usa verniz, laca ou resina, e não cite problema de acabamento como se fosse dela. Mensagem mais geral: para dizer o que a Corquímica faz, use só algo como "indústria química de Estância Velha (RS), desde 1997", sem citar verniz, laca, corante nem resina; e pergunte, sem pressupor, se faz sentido conversar.',
};

const PROIBIDO = /espero que (esteja|estejam|você esteja) bem|tudo bem\?|venho por meio|gostaria de apresentar|soluç(ão|ões) inovador|líder (de|no) mercado|qualidade incompar|excelência/i;
export type Rascunho = { sem_gancho?: boolean; motivo?: string; assunto: string; corpo: string; angulo: string };

// Regras do texto que a máquina confere antes de pôr na fila de aprovação.
export function problemas(t: Rascunho, perfil = 'geral') {
  const p: string[] = [];
  const corpo = (t.corpo ?? '').trim();
  const ultima = corpo.split(/[.!]\s/).pop() ?? '';
  if ((corpo.match(/\?/g) ?? []).length !== 1 || !corpo.endsWith('?')) p.push('o corpo deve ter uma pergunta só, na última frase');
  if (!/celular|whats/i.test(ultima)) p.push('a pergunta final deve ser sobre seguir pelo WhatsApp');
  if (/qual (é |e )?(o )?seu (celular|n[úu]mero|whats)/i.test(ultima)) p.push('a pergunta do celular está direta demais: pergunte se seria possível compartilhar');
  if (!/fernando/i.test(corpo)) p.push('falta a apresentação breve do Fernando');
  if (perfil !== 'verniz' && /\b(verniz|vernizes|lacas?|corantes?)\b/i.test(corpo + ' ' + (t.assunto ?? ''))) p.push('fala de verniz/laca/corante sem saber se a empresa usa');
  if (PROIBIDO.test(corpo) || PROIBIDO.test(t.assunto ?? '')) p.push('tem frase de vendedor proibida');
  if (corpo.split(/\s+/).length > 130) p.push('passou de 130 palavras');
  if ((t.assunto ?? '').length > 70) p.push('assunto com mais de 70 caracteres');
  return p;
}

// O que cada passo da cadência pede. 1–4: sequência de 14 dias. 5–7: retomadas a cada 60 dias.
function pedidoDoPasso(passo: number, retomada: boolean, meses: number | null) {
  const fim = 'Termine com UMA pergunta, gentil e sem pressão, perguntando se seria possível compartilhar um número de celular para seguirem a conversa pelo WhatsApp (ex.: "Seria possível me passar um celular para seguirmos pelo WhatsApp?"). Nunca pergunte "qual é o seu celular".';
  const quem = retomada
    ? 'Apresente-se em uma frase curta: Fernando Gutierrez, executivo comercial da Corquímica. NÃO apresente a Corquímica (ele já foi cliente).'
    : 'Apresente-se em uma frase curta (Fernando Gutierrez, executivo comercial da Corquímica) e apresente a Corquímica em outra frase curta (fabricante de Estância Velha/RS desde 1997, com o que for relevante para o perfil).';
  const lembrete = 'Comece lembrando em poucas palavras quem escreve (ex.: "Aqui é o Fernando, da Corquímica, de novo.").';
  if (passo >= 5) return `Escreva uma RETOMADA depois de cerca de 2 meses sem resposta aos e-mails anteriores. ${quem} Traga um motivo NOVO para falar agora (diferente dos e-mails anteriores), reconheça com leveza que já escreveu antes, sem cobrar. ${fim}`;
  if (retomada) return [
    `Escreva um e-mail de RETOMADA para um ex-cliente: comprou da Corquímica pela última vez há cerca de ${meses ?? 'alguns'} meses. ${quem} Não finja que é o primeiro contato. Reconheça o tempo sem pedidos sem cobrar nem culpar e traga um motivo concreto para voltar a conversar, dentro do que o perfil permite. ${fim}`,
    `Segundo e-mail para o ex-cliente, com OUTRO ângulo, dentro do que o perfil permite. ${lembrete} Não repita o e-mail anterior. ${fim}`,
    `Terceiro e-mail para o ex-cliente: ofereça uma conversa rápida ou um teste prático (amostra) do que fizer sentido para o perfil, dizendo em uma frase como funciona. ${lembrete} Sem inventar casos. ${fim}`,
    `Último e-mail curto (até 60 palavras) da sequência para o ex-cliente. ${lembrete} Diga que vai parar de escrever por enquanto e deixe a porta aberta. ${fim}`,
  ][passo - 1];
  return [
    `Escreva o PRIMEIRO e-mail de prospecção. ${quem} Use o gancho (fato verdadeiro e específico desta empresa) em uma frase e ligue a uma situação em que a Corquímica pode ajudar, dentro do que o perfil permite. ${fim} Se o gancho não permitir um e-mail honesto e específico, devolva {"sem_gancho": true, "motivo": "..."}.`,
    `Segundo e-mail, 3 dias úteis depois, com OUTRO ângulo (não é reenvio), dentro do que o perfil permite. ${lembrete} ${fim}`,
    `Terceiro e-mail: ofereça uma conversa rápida ou um teste prático (amostra) do que fizer sentido para o perfil, dizendo em uma frase como funciona. ${lembrete} Sem inventar casos de clientes. ${fim}`,
    `Último e-mail curto (até 60 palavras) da sequência. ${lembrete} Diga que vai parar de escrever por enquanto e deixe a porta aberta. ${fim}`,
  ][passo - 1];
}

const REGRAS = `Regras do texto: português do Brasil, tom de conversa entre profissionais, até 110 palavras no corpo, sem saudação genérica ("espero que esteja bem"), sem adjetivo de vendedor, sem lista, sem link, sem assinatura nem despedida (a assinatura é colocada depois). Comece por "Olá" + nome do contato se houver, senão "Olá, pessoal da <empresa>". Uma pergunta só, e ela é a última frase. Assunto curto (até 60 caracteres), sem caixa alta e sem ponto de exclamação; o assunto também respeita o perfil de produto.
Responda só com JSON: {"assunto":"","corpo":"","angulo":"nome curto da abordagem"}`;

// Escreve o e-mail do passo. Devolve o rascunho conferido (ou "sem gancho"), as memórias usadas e o custo.
export async function redigirEmail(o: { empresa: Record<string, any>; contato: Record<string, any>; passo: number; tipo: 'prospeccao' | 'retomada'; manual: boolean; jobId?: string | null }) {
  const { empresa: e, contato, passo, tipo, manual } = o;
  const retomada = tipo === 'retomada';
  const perfil = PERFIS[e.perfil_produto] ? e.perfil_produto : 'geral';
  const anteriores = await banco(`/rest/v1/emails?select=passo,assunto,corpo&empresa_id=eq.${e.id}&status=eq.enviado&order=enviado_em`);
  const mem = await buscarMemoria(`e-mail de ${tipo}, passo ${passo}, para empresa de ${e.setor ?? 'indústria'}: assunto, ângulo e resposta`, 3, manual);
  const meses = e.ultima_compra ? Math.max(1, Math.round((Date.now() - new Date(e.ultima_compra).getTime()) / (30.4 * 864e5))) : null;
  const contexto = `${SOBRE_A_CORQUIMICA}

EMPRESA: ${JSON.stringify({ nome: e.nome, setor: e.setor, cidade: e.cidade, uf: e.uf, gancho: e.gancho, gancho_fonte: e.gancho_fonte, icp_motivo: e.icp_motivo })}
PERFIL DE PRODUTO (${perfil}): ${PERFIS[perfil]}
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
  if (problemas(t, perfil).length) { // uma revisão com o que falhou
    r = await chamarIA({ provedor: 'anthropic', papel: 'redator', nivel: 'rotina', manual, maxTokens: 2000, memorias, jobId: o.jobId, instrucoes, contexto: contexto + `\n\nSua versão anterior:\n${JSON.stringify(t)}\nCorrija: ${problemas(t, perfil).join('; ')}.` });
    t = jsonDe<Rascunho>(r.texto); custo += r.custoUsd;
  }
  return { sem_gancho: false as const, assunto: t.assunto.trim(), corpo: t.corpo.trim(), angulo: t.angulo || `${tipo}-${passo}`, revisar: problemas(t, perfil), custo, memorias };
}

// Tira do texto a parte citada do e-mail anterior ("> ..." e o que vem depois de "Em ..., escreveu:" / "On ... wrote:").
export function semCitacao(texto: string) {
  const linhas = texto.split(/\r?\n/);
  const corte = linhas.findIndex((l) => /^\s*(Em .+escreveu:|On .+wrote:|-+ ?Mensagem original|-+ ?Original Message|De: .+)\s*$/i.test(l) || /^\s*>/.test(l));
  return (corte >= 0 ? linhas.slice(0, corte) : linhas).join('\n').trim() || texto.trim();
}

// Lê uma resposta recebida, classifica e rascunha a continuação (que espera aprovação).
export async function classificarResposta(o: { texto: string; assunto: string; empresa: Record<string, any> | null; enviados: { assunto: string; corpo: string }[]; manual: boolean }) {
  const r = await chamarIA({
    provedor: 'anthropic', papel: 'classificador_respostas', nivel: 'rotina', manual: o.manual, maxTokens: 2000,
    instrucoes: `Você lê respostas a e-mails comerciais da Corquímica e prepara a continuação, assinada por Fernando Gutierrez. Responda só com JSON.\n${SOBRE_A_CORQUIMICA}`,
    contexto: `EMPRESA: ${JSON.stringify(o.empresa ? { nome: o.empresa.nome, setor: o.empresa.setor, cidade: o.empresa.cidade, relacao: o.empresa.relacao } : null)}
PERFIL DE PRODUTO: ${PERFIS[o.empresa?.perfil_produto] ?? PERFIS.geral}
O QUE ENVIAMOS:\n${o.enviados.map((e) => e.assunto + '\n' + e.corpo).join('\n---\n') || '(não identificado)'}

RESPOSTA RECEBIDA (assunto: ${o.assunto}; só o texto novo, sem a parte citada do nosso e-mail):\n${semCitacao(o.texto).slice(0, 6000)}

Classifique em: "interessado" (quer conversar, mandou telefone ou celular, inclusive na assinatura, pediu amostra/preço), "pergunta" (fez pergunta antes de decidir), "nao_agora" (sem interesse agora, mas educado), "nao" (não quer), "descadastro" (pediu para parar de receber), "automatica" (gerada por sistema: aviso de férias/ausência, confirmação automática de recebimento, ticket).
Uma resposta curta escrita por uma pessoa ("recebi", "obrigado", "pode mandar") NÃO é automática: se trouxer celular, é "interessado"; senão, "pergunta".
Para interessado, pergunta e nao_agora, escreva o rascunho da resposta: curto, responde o que foi perguntado sem inventar dado técnico (se não souber, diga que confirma por WhatsApp), e se ainda não tiver o celular, pergunte com gentileza se seria possível compartilhar um para seguirem pelo WhatsApp. Sem despedida nem assinatura no rascunho (a assinatura completa é colocada depois). Para nao, descadastro e automatica, rascunho vazio.
Devolva {"classificacao":"","rascunho":"","motivo":"uma frase"}`,
  });
  const v = jsonDe<{ classificacao: string; rascunho: string; motivo: string }>(r.texto);
  const validas = ['interessado', 'pergunta', 'nao_agora', 'nao', 'descadastro', 'automatica'];
  return { classificacao: validas.includes(v.classificacao) ? v.classificacao : 'pergunta', rascunho: (v.rascunho ?? '').trim(), motivo: v.motivo ?? '', custo: r.custoUsd };
}
