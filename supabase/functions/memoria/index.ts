// Memória pela tela: gravar aprendizado, registrar resultado de uma proposta, buscar e consolidar.
//   { acao: 'gravar', hipotese, evidencia: [{metrica, valor, amostra, fonte}], tags?, status? }
//   { acao: 'resultado', id, metrica, valor, amostra, contraria?, resultado? }   → mede uma proposta ou aprendizado
//   { acao: 'buscar', texto }                                               → o que os agentes leriam antes de agir
//   { acao: 'consolidar' }                                                  → só o dono (roda sozinho toda semana na Fase 9)
import { banco, ErroIA } from '../_shared/ia.ts';
import { cors, json, usuario } from '../_shared/http.ts';
import { buscarMemoria, confiancaPorAmostra, consolidar, ErroMemoria, gravarAprendizado, validar, type Medicao } from '../_shared/memoria.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { erro: 'Use POST.' });
  const quem = await usuario(req);
  if (!quem) return json(req, 401, { erro: 'Faça login de novo.' });
  if (quem.papel !== 'dono' && quem.papel !== 'operador') return json(req, 403, { erro: 'Seu papel não pode alterar a memória.' });

  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json(req, 400, { erro: 'Corpo inválido.' }); }
  try {
    if (c.acao === 'gravar') {
      return json(req, 200, await gravarAprendizado({
        hipotese: String(c.hipotese ?? ''), evidencia: (c.evidencia as Medicao[]) ?? [], resultado: (c.resultado as string) ?? null,
        status: (c.status as 'hipotese') ?? 'testando', tags: (c.tags as string[]) ?? [], origem: 'manual',
      }));
    }
    if (c.acao === 'resultado') {
      const id = String(c.id ?? '');
      const [m] = await banco('/rest/v1/memoria_aprendizados?select=*&id=eq.' + encodeURIComponent(id));
      if (!m) return json(req, 404, { erro: 'Aprendizado não encontrado.' });
      const medicao: Medicao = { metrica: String(c.metrica ?? ''), valor: c.valor as string, amostra: Number(c.amostra), contraria: !!c.contraria, aplicada: true, fonte: 'informado na tela', em: new Date().toISOString().slice(0, 10) };
      const resultado = (c.resultado as string) ?? m.resultado;
      // A medição passa pela mesma validação (número, sem dado pessoal) de um aprendizado novo.
      validar({ hipotese: m.hipotese + ' ' + medicao.valor, evidencia: [medicao], resultado, status: 'testando' });
      // Contraria: cai 0,2 na hora. Confirma: confiança pela amostra somada das medições, mais 0,05.
      const conf = medicao.contraria ? Math.max(0, Number(m.confianca) - 0.2) : Math.min(0.95, Math.max(Number(m.confianca), confiancaPorAmostra([...m.evidencia, medicao])) + 0.05);
      const status = medicao.contraria && conf < 0.2 ? 'refutado' : m.status === 'proposta' || m.status === 'hipotese' ? 'testando' : m.status;
      await banco('/rest/v1/memoria_aprendizados?id=eq.' + encodeURIComponent(id), {
        metodo: 'PATCH', corpo: { evidencia: [...m.evidencia, medicao], resultado, confianca: conf, status, visto_vezes: m.visto_vezes + (medicao.contraria ? 0 : 1) },
      });
      return json(req, 200, { ok: true, status, confianca: conf });
    }
    if (c.acao === 'buscar') return json(req, 200, { itens: await buscarMemoria(String(c.texto ?? ''), 5) });
    if (c.acao === 'consolidar') {
      if (quem.papel !== 'dono') return json(req, 403, { erro: 'Só o dono consolida.' });
      return json(req, 200, await consolidar(true));
    }
    return json(req, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    if (e instanceof ErroMemoria) return json(req, 422, { erro: e.message });
    const codigo = e instanceof ErroIA ? e.codigo : 'http';
    return json(req, codigo === 'teto' || codigo === 'parado' ? 429 : 502, { erro: (e as Error).message, codigo });
  }
});
