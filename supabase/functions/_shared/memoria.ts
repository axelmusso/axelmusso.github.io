// Memória dos agentes: grava aprendizado com número, busca por semelhança antes de agir e consolida toda semana.
// Regra de ouro: guarda padrão aprendido, nunca pessoa (sem e-mail, telefone, CPF/CNPJ).
import { banco, chamarIA, gerarEmbedding } from './ia.ts';

export type Medicao = { metrica: string; valor: number | string; amostra: number; fonte?: string; em?: string; contraria?: boolean; aplicada?: boolean };
export type NovoAprendizado = {
  hipotese: string;
  evidencia?: Medicao[] | Record<string, unknown>[];
  resultado?: string | null;
  confianca?: number;
  status?: 'proposta' | 'hipotese' | 'testando' | 'confirmado' | 'refutado';
  tags?: string[];
  origem?: string;
  origem_id?: string | null;
};

export class ErroMemoria extends Error {}

const PESSOAL = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'e-mail'],
  [/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/, 'telefone'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, 'CPF'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, 'CNPJ'],
] as const;

// Recusa o que não serve: sem número ("personalizar funciona melhor") ou com dado de pessoa.
export function validar(a: NovoAprendizado) {
  const h = (a.hipotese ?? '').trim();
  if (h.length < 15 || h.length > 600) throw new ErroMemoria('O aprendizado precisa ter entre 15 e 600 caracteres.');
  const tudo = h + ' ' + JSON.stringify(a.evidencia ?? []) + ' ' + (a.resultado ?? '');
  for (const [re, nome] of PESSOAL) if (re.test(tudo)) throw new ErroMemoria(`Memória não guarda dado pessoal (achei algo parecido com ${nome}). Escreva o padrão, não a pessoa.`);
  if (a.status === 'proposta') return; // decisão ainda sem resultado: o número vem quando for medida
  if (!/\d/.test(h)) throw new ErroMemoria('Aprendizado precisa do número que o sustenta. Ex.: "assunto com a cidade teve 31% de resposta contra 12% do genérico, em 84 envios".');
  const med = (a.evidencia ?? []) as Medicao[];
  if (!med.some((m) => Number(m.amostra) > 0 && m.valor !== undefined && m.valor !== '')) {
    throw new ErroMemoria('Falta a evidência medida: ao menos uma medição com valor e tamanho da amostra.');
  }
}

// Confiança inicial pelo tamanho da amostra: 30 envios ≈ 0,38; 150 ou mais ≈ 0,70.
export const confiancaPorAmostra = (med: Medicao[]) => {
  const n = med.reduce((s, m) => s + (Number(m.amostra) || 0), 0);
  return Math.round((0.3 + 0.4 * Math.min(1, n / 150)) * 100) / 100;
};
const vetor = (v: number[]) => '[' + v.join(',') + ']';

// Grava; se já existe um quase igual (semelhança ≥ 0,92), funde no existente em vez de duplicar.
export async function gravarAprendizado(a: NovoAprendizado, manual = true) {
  validar(a);
  const evidencia = (a.evidencia ?? []).map((m) => ({ em: new Date().toISOString().slice(0, 10), ...m }));
  const emb = await gerarEmbedding(a.hipotese, 'memoria_gravar', manual);
  if (a.status !== 'proposta') {
    const [igual] = await banco('/rest/v1/rpc/buscar_memoria', { metodo: 'POST', corpo: { consulta: vetor(emb), limite: 1, confianca_min: -1 } });
    if (igual && igual.similaridade >= 0.92 && igual.status !== 'proposta') {
      // Repetiu: a confiança passa a contar a amostra somada das medições, mais um bônus por ter se repetido.
      const todas = [...igual.evidencia, ...evidencia] as Medicao[];
      const conf = Math.min(0.95, Math.max(Number(igual.confianca), confiancaPorAmostra(todas)) + 0.05);
      await banco('/rest/v1/memoria_aprendizados?id=eq.' + igual.id, {
        metodo: 'PATCH',
        corpo: { evidencia: todas, visto_vezes: igual.visto_vezes + 1, confianca: conf, tags: [...new Set([...(igual.tags ?? []), ...(a.tags ?? [])])] },
      });
      return { acao: 'fundido', id: igual.id as string, similaridade: igual.similaridade as number };
    }
  }
  const [novo] = await banco('/rest/v1/memoria_aprendizados', {
    metodo: 'POST',
    corpo: {
      hipotese: a.hipotese.trim(), evidencia, resultado: a.resultado ?? null,
      confianca: a.confianca ?? (a.status === 'proposta' ? 0.3 : confiancaPorAmostra(evidencia as Medicao[])),
      status: a.status ?? 'hipotese', tags: a.tags ?? [], embedding: vetor(emb), origem: a.origem ?? 'manual', origem_id: a.origem_id ?? null,
    },
  });
  return { acao: 'criado', id: novo.id as string };
}

// Antes de agir: aprendizados parecidos com a tarefa, confiança > 0,6, não refutados.
export async function buscarMemoria(texto: string, limite = 5, manual = true) {
  const emb = await gerarEmbedding(texto, 'memoria_buscar', manual);
  const itens = await banco('/rest/v1/rpc/buscar_memoria', { metodo: 'POST', corpo: { consulta: vetor(emb), limite, confianca_min: 0.6 } });
  // Só o que é de fato parecido com a tarefa (semelhança mínima 0,3), para não encher o prompt de ruído.
  return (itens as { id: string; similaridade: number }[]).filter((m) => m.similaridade >= 0.3);
}
export const idCurto = (id: string) => id.slice(0, 8);

// Consolidação semanal: apaga refutados, funde duplicados, derruba contrariados, sobe o que se repetiu, e resume.
export async function consolidar(manual = true) {
  const mudancas: { acao: string; id: string; detalhe: string }[] = [];
  const seteDias = new Date(Date.now() - 7 * 864e5).toISOString();

  for (const r of await banco('/rest/v1/memoria_aprendizados?select=id,hipotese&status=eq.refutado')) {
    await banco('/rest/v1/memoria_aprendizados?id=eq.' + r.id, { metodo: 'DELETE' });
    mudancas.push({ acao: 'apagado (refutado)', id: r.id, detalhe: r.hipotese });
  }

  const fundidos = new Set<string>();
  for (const p of await banco('/rest/v1/rpc/memoria_duplicadas', { metodo: 'POST', corpo: { limiar: 0.92 } })) {
    if (fundidos.has(p.manter) || fundidos.has(p.fundir)) continue;
    const [a] = await banco('/rest/v1/memoria_aprendizados?select=id,hipotese,evidencia,confianca,visto_vezes,tags&id=eq.' + p.manter);
    const [b] = await banco('/rest/v1/memoria_aprendizados?select=id,hipotese,evidencia,confianca,visto_vezes,tags&id=eq.' + p.fundir);
    if (!a || !b) continue;
    await banco('/rest/v1/memoria_aprendizados?id=eq.' + a.id, {
      metodo: 'PATCH',
      corpo: { evidencia: [...a.evidencia, ...b.evidencia], visto_vezes: a.visto_vezes + b.visto_vezes, confianca: Math.min(0.95, Math.max(Number(a.confianca), Number(b.confianca), confiancaPorAmostra([...a.evidencia, ...b.evidencia])) + 0.05), tags: [...new Set([...a.tags, ...b.tags])] },
    });
    await banco('/rest/v1/memoria_aprendizados?id=eq.' + b.id, { metodo: 'DELETE' });
    fundidos.add(b.id);
    mudancas.push({ acao: 'fundido', id: a.id, detalhe: `"${b.hipotese}" entrou em "${a.hipotese}" (semelhança ${Number(p.similaridade).toFixed(2)})` });
  }

  for (const m of await banco('/rest/v1/memoria_aprendizados?select=id,hipotese,evidencia,confianca,status,visto_vezes&status=in.(hipotese,testando,confirmado)')) {
    // Contrariado: só conta medição que ainda não derrubou a confiança na hora do registro (aplicada = já descontada).
    const contrarias = (m.evidencia as Medicao[]).filter((e) => e.contraria && !e.aplicada && (e.em ?? '') >= seteDias.slice(0, 10)).length;
    let conf = Number(m.confianca), status = m.status;
    if (contrarias) { conf = Math.max(0, conf - 0.2 * contrarias); if (conf < 0.2) status = 'refutado'; }
    else if (m.visto_vezes >= 3 && status !== 'confirmado') { status = 'confirmado'; conf = Math.min(0.95, conf + 0.1); }
    if (conf !== Number(m.confianca) || status !== m.status) {
      await banco('/rest/v1/memoria_aprendizados?id=eq.' + m.id, { metodo: 'PATCH', corpo: { confianca: conf, status } });
      mudancas.push({ acao: contrarias ? (status === 'refutado' ? 'refutado' : 'confiança caiu') : 'confirmado', id: m.id, detalhe: `${m.hipotese} (confiança ${Number(m.confianca).toFixed(2)} → ${conf.toFixed(2)})` });
    }
  }

  let resumo = 'Nada mudou nesta semana: nenhum duplicado, nada contrariado, nada novo confirmado.';
  if (mudancas.length) {
    const r = await chamarIA({
      provedor: 'anthropic', papel: 'memoria_consolidar', nivel: 'barato', manual, maxTokens: 800,
      instrucoes: 'Resuma para o dono da empresa, em português simples e em até 6 linhas, o que mudou na memória dos agentes nesta semana. Mantenha os números. Não invente nada além da lista.',
      contexto: JSON.stringify(mudancas),
    });
    resumo = r.texto.trim();
  }
  const [c] = await banco('/rest/v1/memoria_consolidacoes', { metodo: 'POST', corpo: { resumo, mudancas } });
  return { id: c.id, resumo, mudancas };
}
