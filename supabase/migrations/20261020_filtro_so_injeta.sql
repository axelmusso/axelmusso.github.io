-- Regra do dono (20/10/2026): empresa que só injeta (ou sopra, extruda) e não pinta, não enverniza nem metaliza a peça
-- não é cliente da Corquímica. A qualificação passa a dizer se a empresa dá acabamento na peça (sim, não, incerto).

alter table public.empresas add column if not exists acabamento text check (acabamento in ('sim', 'nao', 'incerto'));
comment on column public.empresas.acabamento is 'Se a empresa pinta, enverniza, metaliza ou decora a peça (pela leitura do site na qualificação).';

-- "Injeção sem acabamento" deixa de qualificar (era 55, acima da mínima 50); peça automotiva ou de eletrodoméstico
-- passa a exigir prova de acabamento (a função de qualificar cuida disso).
update public.config set valor = jsonb_set(valor, '{segmentos}', (
  select jsonb_agg(case
    when s ->> 'id' = 'injecao_plastica' then s || '{"nome": "Só injeção, sopro ou extrusão, sem pintura, verniz ou metalização", "nota": 0, "grupo": "fora"}'::jsonb
    when s ->> 'id' = 'plastico_auto_linha_branca' then s || '{"nome": "Peças plásticas automotivas e de eletrodomésticos, com pintura, verniz ou metalização"}'::jsonb
    when s ->> 'id' = 'plastico_acabamento' then s || '{"nome": "Peças plásticas injetadas com pintura, verniz, metalização, hot stamping ou decoração"}'::jsonb
    else s end order by i)
  from jsonb_array_elements(valor -> 'segmentos') with ordinality as t(s, i)))
where chave = 'icp';

-- Recalcula a nota de quem já estava no segmento (o gatilho aplicar_segmento_icp lê a tabela nova).
update public.empresas set segmento_icp = segmento_icp where segmento_icp = 'injecao_plastica';

-- Reavaliação: prospects de segmentos de peça sem prova de acabamento (perfil "geral") voltam para a qualificação.
-- A função de qualificar tira da fila os rascunhos de quem cair abaixo da nota mínima e encerra a cadência.
select public.enfileirar('qualificar', jsonb_build_object('empresa_id', e.id), 5, 'qualificar:' || e.id::text, now(), 'reavaliacao_acabamento')
from public.empresas e
where e.relacao = 'prospect' and coalesce(e.status, '') <> 'descartada' and not coalesce(e.icp_manual, false)
  and e.qualificado_em is not null and coalesce(e.perfil_produto, 'geral') = 'geral'
  and e.segmento_icp in ('injecao_plastica', 'plastico_auto_linha_branca', 'plastico_acabamento', 'saltos_solados', 'enfeites_bijuterias',
                         'puxadores_acessorios', 'sanitarios_linha_branca', 'embalagem_cosmetica', 'calcados_fabricante')
  and (e.segmento_icp = 'injecao_plastica'
       or exists (select 1 from public.emails m where m.empresa_id = e.id and m.status in ('rascunho', 'aprovado', 'enviado'))
       or e.icp_score >= (select (valor ->> 'nota_minima')::int from public.config where chave = 'icp'));
