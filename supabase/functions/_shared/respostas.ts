// O que fazer com uma resposta já classificada. Usado pelo webhook (automático) e pelo botão "Classificar" (manual).
//   telefone de quem decide (ou da pessoa indicada como responsável) → negócio em "Telefone obtido", tarefa para o Áxel ligar, cadência parada, nada mais automático
//   pessoa indicada com e-mail → vira contato (com a fonte) e ganha um rascunho que cita a indicação, para aprovação
//   "não" ou descadastro → lista de não contatar
//   caixa que ninguém lê (só NF, não monitorada) → contato desligado e a cadência passa para outro e-mail da empresa
import { banco } from './ia.ts';
import { seguirComOutro } from './contatos.ts';
import { agoraBrasilia, suprimido } from './envio.ts';
import { emailGenerico, redigirEmail, type Pessoa } from './redacao.ts';

const q = encodeURIComponent;

export async function suprimir(email: string, motivo: 'bounce' | 'spam' | 'descadastro') {
  const ja = await banco(`/rest/v1/lista_supressao?select=id&email=ilike.${q(email)}&limit=1`);
  if (!ja.length) await banco('/rest/v1/lista_supressao', { metodo: 'POST', corpo: { email: email.toLowerCase(), motivo } });
  await banco(`/rest/v1/contatos?email=ilike.${q(email)}`, { metodo: 'PATCH', corpo: { pode_contatar: false } });
  const cads = await banco(`/rest/v1/cadencias?select=id,contatos!inner(email)&contatos.email=ilike.${q(email)}&status=in.(ativa,pausada)`);
  for (const c of cads) await banco('/rest/v1/cadencias?id=eq.' + c.id, { metodo: 'PATCH', corpo: { status: 'suprimida' } });
  await banco(`/rest/v1/emails?para=ilike.${q(email)}&status=in.(rascunho,aprovado)`, { metodo: 'PATCH', corpo: { status: 'descartado', erro: 'Endereço entrou na lista de não contatar (' + motivo + ').' } });
}

// Negócio aberto da empresa (cria se não houver).
async function negocioAberto(empresa: Record<string, any>, etapa: string) {
  const [n] = await banco(`/rest/v1/negocios?select=id,etapa&empresa_id=eq.${empresa.id}&etapa=not.in.(ganho,perdido)&limit=1`);
  if (n) return n;
  const [novo] = await banco('/rest/v1/negocios', { metodo: 'POST', corpo: { empresa_id: empresa.id, titulo: (empresa.relacao === 'ex_cliente' ? 'Retomada: ' : 'Prospecção: ') + empresa.nome, etapa } });
  return novo;
}

// Sucesso da prospecção: temos o telefone de quem decide. Daí em diante a conversa é do Áxel.
// A pessoa que a empresa indicou já pode ser contato (veio com o e-mail numa resposta anterior): ganha o telefone, sem duplicar.
async function telefoneObtido(resp: Record<string, any>, empresa: Record<string, any>, p: Pessoa) {
  const ja = await banco(`/rest/v1/contatos?select=id&empresa_id=eq.${empresa.id}&${p.email ? 'email=ilike.' + q(p.email) : 'nome=ilike.' + q(p.nome ?? '-')}&limit=1`);
  if (ja.length) await banco('/rest/v1/contatos?id=eq.' + ja[0].id, { metodo: 'PATCH', corpo: { telefone: p.telefone, ...(p.cargo ? { cargo: p.cargo } : {}) } });
  else await banco('/rest/v1/contatos', {
    metodo: 'POST',
    corpo: {
      empresa_id: empresa.id, nome: p.nome ?? null, cargo: p.cargo ?? null, email: p.email ?? null, telefone: p.telefone,
      origem: 'resposta', coletado_em: new Date().toISOString(), pode_contatar: true,
      base_legal: 'Informado pela própria empresa na resposta ao e-mail (' + resp.de + ')',
    },
  });
  const n = await negocioAberto(empresa, 'telefone');
  if (n.etapa !== 'com_axel' && n.etapa !== 'telefone') await banco('/rest/v1/negocios?id=eq.' + n.id, { metodo: 'PATCH', corpo: { etapa: 'telefone' } });
  await banco('/rest/v1/tarefas', {
    metodo: 'POST',
    corpo: {
      titulo: `Ligar/WhatsApp: ${p.nome ?? 'responsável'} (${empresa.nome}) ${p.telefone}`.slice(0, 200),
      descricao: `${p.cargo ? p.cargo + '. ' : ''}Telefone passado na resposta de ${resp.de}: "${String(resp.assunto ?? '').slice(0, 120)}".`,
      vence_em: agoraBrasilia().dia, negocio_id: n.id,
    },
  });
  await banco(`/rest/v1/cadencias?empresa_id=eq.${empresa.id}&status=in.(ativa,pausada)`, { metodo: 'PATCH', corpo: { status: 'respondeu' } });
  await banco(`/rest/v1/emails?empresa_id=eq.${empresa.id}&status=in.(rascunho,aprovado)`, { metodo: 'PATCH', corpo: { status: 'descartado', erro: 'Telefone do responsável obtido: a conversa segue com o Áxel.' } });
  await banco('/rest/v1/respostas?id=eq.' + resp.id, { metodo: 'PATCH', corpo: { rascunho: null } });
  await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: empresa.id, tipo: 'nota', direcao: 'interna', assunto: 'Telefone obtido', conteudo: `${p.nome ?? 'Responsável'}${p.cargo ? ' (' + p.cargo + ')' : ''}: ${p.telefone}`, agente_id: 'respostas' } });
}

// A empresa indicou outra pessoa: vira contato e ganha um rascunho que cita a indicação (sai só com aprovação).
async function indicacao(resp: Record<string, any>, empresa: Record<string, any>, p: Pessoa, manual: boolean) {
  if (!p.email || p.email === String(resp.de).toLowerCase() || (await suprimido(p.email))) return null;
  let [contato] = await banco(`/rest/v1/contatos?select=id,nome,cargo,email&empresa_id=eq.${empresa.id}&email=ilike.${q(p.email)}&limit=1`);
  if (!contato) {
    [contato] = await banco('/rest/v1/contatos', {
      metodo: 'POST',
      corpo: {
        empresa_id: empresa.id, nome: p.nome ?? null, cargo: p.cargo ?? null, email: p.email, telefone: p.telefone ?? null,
        origem: 'indicado', coletado_em: new Date().toISOString(), pode_contatar: true,
        base_legal: 'Legítimo interesse (indicado pela própria empresa, em resposta de ' + resp.de + ')',
      },
    });
  }
  if ((await banco(`/rest/v1/emails?select=id&contato_id=eq.${contato.id}&status=in.(rascunho,aprovado)&limit=1`)).length) return contato;
  // Quem indicou: caixa geral vira "a equipe de vocês"; e-mail de pessoa vira o primeiro nome (joao.silva@ → Joao).
  const local = String(resp.de).split('@')[0];
  const quem = emailGenerico(resp.de) ? 'a equipe de vocês' : local.split(/[._-]/)[0].replace(/^./, (c) => c.toUpperCase());
  const r = await redigirEmail({ empresa, contato, passo: 1, tipo: empresa.relacao === 'ex_cliente' ? 'retomada' : 'prospeccao', manual, indicadoPor: quem });
  if (r.sem_gancho) return contato;
  await banco('/rest/v1/emails', { metodo: 'POST', corpo: { empresa_id: empresa.id, contato_id: contato.id, para: contato.email, passo: 1, angulo: 'indicacao', assunto: r.assunto, corpo: r.corpo, status: 'rascunho', memorias: r.memorias, erro: r.revisar.length ? 'Revisar: ' + r.revisar.join('; ') : null } });
  await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: empresa.id, contato_id: contato.id, tipo: 'email', direcao: 'interna', assunto: 'Indicação recebida', conteudo: `${resp.de} indicou ${p.nome ?? p.email}${p.cargo ? ' (' + p.cargo + ')' : ''}. Rascunho criado para aprovação.`, agente_id: 'respostas' } });
  return contato;
}

// O endereço não é lido por ninguém: desliga o contato, encerra a cadência e segue com outro e-mail da empresa.
async function caixaSemLeitura(resp: Record<string, any>, empresa: Record<string, any>) {
  const [orig] = resp.email_id ? await banco('/rest/v1/emails?select=para&id=eq.' + resp.email_id) : [];
  const email = String(orig?.para ?? resp.de).toLowerCase();
  await banco(`/rest/v1/contatos?empresa_id=eq.${empresa.id}&email=ilike.${q(email)}`, { metodo: 'PATCH', corpo: { pode_contatar: false } });
  await banco(`/rest/v1/emails?empresa_id=eq.${empresa.id}&para=ilike.${q(email)}&status=in.(rascunho,aprovado)`, { metodo: 'PATCH', corpo: { status: 'descartado', erro: 'Caixa sem leitura: a cadência segue com outro e-mail.' } });
  await banco(`/rest/v1/cadencias?empresa_id=eq.${empresa.id}&status=in.(ativa,pausada,respondeu)`, { metodo: 'PATCH', corpo: { status: 'encerrada', motivo_fim: 'caixa sem leitura', proximo_em: null } });
  return await seguirComOutro(empresa.id, `${email} não é lido (resposta automática)`);
}

export type Classificacao = { classificacao: string; telefone_decisor: Pessoa | null; indicado: Pessoa | null; caixa_sem_leitura?: boolean };
export async function aplicarClassificacao(resp: Record<string, any>, empresa: Record<string, any> | null, v: Classificacao, manual: boolean) {
  if (v.classificacao === 'nao' || v.classificacao === 'descadastro') { await suprimir(resp.de, 'descadastro'); return 'suprimido'; }
  if (!empresa) return null;
  if (v.telefone_decisor?.telefone) { await telefoneObtido(resp, empresa, v.telefone_decisor); return 'telefone'; }
  // Telefone da pessoa que a própria empresa indicou como responsável também é sucesso (Nil Arte, 23/10/2026: a loja passou
  // o celular da Fabiana e o negócio ficou parado em "respondeu").
  if (v.indicado?.telefone) { await telefoneObtido(resp, empresa, v.indicado); return 'telefone'; }
  if (v.indicado?.email) { await indicacao(resp, empresa, v.indicado, manual); return 'indicado'; }
  if (v.caixa_sem_leitura) return (await caixaSemLeitura(resp, empresa)) ? 'trocou' : 'sem_outro';
  return null;
}
