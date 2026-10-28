// Qual e-mail da empresa tentar, e o que fazer quando ele não responde.
// Regra (16/10/2026): a empresa, prospect ou ex-cliente, só sai da tentativa quando acabam os e-mails dela ou alguém responde.
//   ordem: área de decisão (compras@, producao@...) → pessoas → caixas gerais (contato@...) → nota fiscal/financeiro (nfe@...)
//   noreply@ e afins nunca recebem
//   sem e-mail novo: procura no site da empresa e no cadastro público do CNPJ (no máximo a cada 30 dias), com fonte e data
import { banco } from './ia.ts';
import { suprimido } from './envio.ts';
import { tipoEmail } from './redacao.ts';
import { dominioDe, lerPagina } from './web.ts';

const q = encodeURIComponent;
const GRATUITOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br', 'icloud.com', 'msn.com'];
const ORDEM_TIPO: Record<string, number> = { decisor: 0, pessoa: 1, generico: 2, fiscal: 3 };
const ORDEM_ORIGEM: Record<string, number> = { manual: 0, indicado: 0, resposta: 0, base_clientes: 1, site: 2, receita_federal: 3 };
// Origens em que uma pessoa confirmou o endereço: valem mesmo com domínio diferente do da empresa.
const CONFIRMADO = ['manual', 'indicado', 'resposta'];
export const pessoaConfirmada = (c: { origem?: string; nome?: string | null }) => CONFIRMADO.includes(c.origem ?? '') && !!c.nome?.trim();
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// E-mail corporativo de OUTRA empresa (contador, holding, fornecedor): juridico@flamarpar para a Vitesse, vendas1@metalcornh
// para a Ramarim. Com domínio conhecido, tem de ser o mesmo; sem domínio, o domínio do e-mail tem de lembrar o nome da empresa.
// Regra do dono (20/10/2026): endereço que não combina com a empresa não faz sentido e não recebe e-mail.
export function dominioEstranho(email: string, empresa: { nome?: string; dominio?: string | null; site?: string | null }) {
  const dom = email.split('@')[1]?.toLowerCase() ?? '';
  if (!dom || GRATUITOS.includes(dom)) return false;
  const proprio = empresa.dominio || dominioDe(empresa.site);
  if (proprio) return !(dom === proprio || dom.endsWith('.' + proprio));
  const rotulo = semAcento(dom.split('.')[0]).replace(/[^a-z0-9]/g, '');
  const palavras = semAcento(empresa.nome ?? '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(ltda|industria|comercio|produtos|plasticos|metais|servicos|grupo)$/.test(w));
  if (!palavras.length) return false; // nome curto ou só sigla: não dá para julgar
  return !palavras.some((w) => rotulo.includes(w) || w.includes(rotulo));
}
// E-mail do cadastro do CNPJ que parece ser do escritório de contabilidade, não da empresa.
const DE_TERCEIRO = /contab|contador|escritorio|assessoria|consultoria/i;

// Endereços que já receberam e-mail desta empresa (sobrevive à reimportação da planilha, que recria os contatos).
async function jaTentados(empresaId: string) {
  const env = await banco(`/rest/v1/emails?select=para&empresa_id=eq.${empresaId}&status=eq.enviado`);
  return new Set<string>(env.map((m: { para: string }) => m.para.toLowerCase()));
}

// dominio: o da empresa; com ele, e-mail gratuito (Gmail, Hotmail...) fica por último, pois costuma ser de terceiro.
async function escolher(e: Record<string, any>, tentados: Set<string>, dominio?: string | null) {
  const empresaId = e.id;
  const lista = await banco(`/rest/v1/contatos?select=id,nome,cargo,email,origem&empresa_id=eq.${empresaId}&pode_contatar=is.true&email=not.is.null&order=coletado_em.desc.nullslast`);
  const livres = [];
  for (const c of lista) {
    const email = c.email.toLowerCase();
    if (tentados.has(email) || tipoEmail(email) === 'bloqueado' || (await suprimido(email))) continue;
    if (!CONFIRMADO.includes(c.origem) && dominioEstranho(email, e)) continue;
    livres.push(c);
  }
  const gratuitoComDominio = (email: string) => !!dominio && !GRATUITOS.includes(dominio) && GRATUITOS.includes(email.split('@')[1]?.toLowerCase());
  // Pessoa com nome que o dono cadastrou, indicou ou que respondeu vem antes de qualquer caixa (pcp@, compras@):
  // a Luceneia, CEO da Jador, lê o comercial@ (27/10/2026). Entre iguais, o cadastrado mais recentemente.
  const peso = (c: { email: string; origem: string; nome?: string }) => pessoaConfirmada(c) ? -1 :
    (gratuitoComDominio(c.email) ? 100 : 0) + ORDEM_TIPO[tipoEmail(c.email)] * 10 + (ORDEM_ORIGEM[c.origem] ?? 2);
  return livres.sort((a, b) => peso(a) - peso(b))[0] ?? null;
}

const podeBuscar = (e: Record<string, any>) => !e.contatos_buscados_em || Date.now() - new Date(e.contatos_buscados_em).getTime() > 30 * 864e5;

async function gravar(empresaId: string, email: string, origem: string, fonte: string, base: string) {
  email = email.toLowerCase();
  if (tipoEmail(email) === 'bloqueado' || (await suprimido(email))) return false;
  if ((await banco(`/rest/v1/contatos?select=id&empresa_id=eq.${empresaId}&email=ilike.${q(email)}&limit=1`)).length) return false;
  await banco('/rest/v1/contatos', { metodo: 'POST', corpo: { empresa_id: empresaId, email, origem, fonte_url: fonte, coletado_em: new Date().toISOString(), base_legal: base, pode_contatar: true } });
  return true;
}

// Procura outros e-mails da empresa: site (pelo domínio do e-mail que já temos) e cadastro público do CNPJ.
export async function buscarContatos(e: Record<string, any>) {
  const achados: string[] = [], avisos: string[] = [];
  // Domínio para procurar o site: o da empresa ou o de um e-mail dela que ainda vale e combina com o nome.
  const conhecidos = await banco(`/rest/v1/contatos?select=email,origem&empresa_id=eq.${e.id}&email=not.is.null&pode_contatar=is.true`);
  const dom = e.dominio || dominioDe(e.site) ||
    conhecidos.filter((c: { email: string; origem: string }) => CONFIRMADO.includes(c.origem) || !dominioEstranho(c.email, e))
      .map((c: { email: string }) => c.email.split('@')[1]?.toLowerCase()).find((d: string) => d && !GRATUITOS.includes(d)) || null;
  if (dom) {
    try {
      const home = await lerPagina(e.site || 'https://' + dom, 15_000);
      const paginas = [home];
      const internas = home.links.filter((l) => dominioDe(l) === dominioDe(home.url) && /contato|fale|atendimento|sobre|empresa|quem-somos|institucional/i.test(l)).slice(0, 2);
      for (const l of internas) { try { paginas.push(await lerPagina(l, 8_000)); } catch { /* página interna opcional */ } }
      // Gmail, Hotmail... publicado no site também vale se leva o nome da empresa: empresa pequena costuma usar só ele
      // (sssolados@hotmail no site da SS Solados, apoiocomponentes@gmail no da Apoio, 28/10/2026). O de uma pessoa
      // (representante, quem fez o site) continua de fora. Na hora de escolher, fica depois dos e-mails do domínio.
      const rotulo = dom.split('.')[0].replace(/[^a-z0-9]/g, '');
      const palavras = semAcento(e.nome ?? '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(ltda|industria|comercio|produtos|plasticos|metais|servicos|grupo)$/.test(w));
      const daEmpresa = (m: string) => {
        const local = m.split('@')[0].replace(/[^a-z0-9]/g, '');
        return GRATUITOS.includes(m.split('@')[1] ?? '') && local.length >= 4 && ((rotulo.length >= 4 && (local.includes(rotulo) || rotulo.includes(local))) || palavras.some((w) => local.includes(w)));
      };
      for (const p of paginas) for (const m of p.emails) {
        if ((m.endsWith('@' + dom) || m.endsWith('.' + dom) || daEmpresa(m)) && (await gravar(e.id, m, 'site', p.url, 'Legítimo interesse (contato profissional publicado no site da empresa)'))) achados.push(m);
      }
      // WhatsApp ou celular publicado no site, se a empresa ainda não tem (pedido do dono, 26/10/2026).
      const comZap = paginas.find((p) => p.whatsapp?.length);
      if (!e.whatsapp && comZap) await banco('/rest/v1/empresas?id=eq.' + e.id, { metodo: 'PATCH', corpo: { whatsapp: comZap.whatsapp[0], whatsapp_fonte: comZap.url } });
      // O site respondeu: guarda o endereço (o domínio só se nenhuma outra empresa já usa).
      if (!e.site || !e.dominio) {
        const livre = !(await banco(`/rest/v1/empresas?select=id&dominio=eq.${q(dom)}&id=neq.${e.id}&limit=1`)).length;
        await banco('/rest/v1/empresas?id=eq.' + e.id, { metodo: 'PATCH', corpo: { site: e.site || home.url, ...(e.dominio || !livre ? {} : { dominio: dom }) } });
      }
    } catch (err) { avisos.push(`site ${dom}: ${(err as Error).message}`); }
  }
  const cnpj = String(e.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length === 14) {
    try {
      const fonte = 'https://brasilapi.com.br/api/cnpj/v1/' + cnpj;
      const r = await fetch(fonte, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        const d = await r.json();
        const m = String(d.email ?? '').trim().toLowerCase();
        if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(m) && !DE_TERCEIRO.test(m) && !dominioEstranho(m, e) && (await gravar(e.id, m, 'receita_federal', fonte, 'Dado público do cadastro CNPJ (Receita Federal)'))) achados.push(m);
      } else avisos.push(`CNPJ: consulta respondeu ${r.status}`);
    } catch (err) { avisos.push(`CNPJ: ${(err as Error).message}`); }
  }
  await banco('/rest/v1/empresas?id=eq.' + e.id, { metodo: 'PATCH', corpo: { contatos_buscados_em: new Date().toISOString() } });
  return { achados, avisos };
}

// Melhor e-mail ainda não tentado. Se não houver, ou se só sobrar caixa fiscal, procura outros antes.
export async function melhorContato(e: Record<string, any>) {
  const tentados = await jaTentados(e.id);
  const dominio = e.dominio || dominioDe(e.site);
  let c = await escolher(e, tentados, dominio);
  if ((!c || tipoEmail(c.email) === 'fiscal') && podeBuscar(e)) {
    await buscarContatos(e);
    c = await escolher(e, tentados, dominio);
  }
  return c;
}

// Passa a cadência para o próximo e-mail da empresa. fechar: cadência atual, encerrada só se houver para quem passar.
// Devolve a cadência nova (passo 0, vence agora: o 1º e-mail para o novo contato é rascunhado em seguida) ou null.
export async function proximoContato(e: Record<string, any>, tipo: string, motivo: string, fechar?: string) {
  const c = await melhorContato(e);
  if (!c) return null;
  if (fechar) await banco('/rest/v1/cadencias?id=eq.' + fechar, { metodo: 'PATCH', corpo: { status: 'encerrada', motivo_fim: motivo, proximo_em: null } });
  const [cad] = await banco('/rest/v1/cadencias', { metodo: 'POST', corpo: { empresa_id: e.id, contato_id: c.id, tipo, passo: 0, proximo_em: new Date().toISOString() } });
  await banco('/rest/v1/interacoes', { metodo: 'POST', corpo: { empresa_id: e.id, contato_id: c.id, tipo: 'nota', direcao: 'interna', assunto: 'Novo contato na cadência', conteudo: `${motivo}: a cadência segue com ${c.email} (${tipoEmail(c.email)}, fonte: ${c.origem ?? 'sem fonte'}).`, agente_id: 'cadencia' } });
  return { cadencia: cad, contato: c };
}

// Depois de bounce ou caixa sem leitura: segue com outro e-mail, se a empresa não respondeu nem está em outra cadência.
export async function seguirComOutro(empresaId: string, motivo: string) {
  const [e] = await banco('/rest/v1/empresas?select=*&id=eq.' + empresaId);
  if (!e || e.relacao === 'cliente_ativo') return null;
  if ((await banco(`/rest/v1/cadencias?select=id&empresa_id=eq.${empresaId}&status=in.(ativa,pausada,respondeu)&limit=1`)).length) return null;
  return proximoContato(e, e.relacao === 'ex_cliente' ? 'retomada' : 'prospeccao', motivo);
}
