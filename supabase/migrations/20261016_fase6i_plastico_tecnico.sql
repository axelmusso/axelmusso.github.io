-- Fase 6, parte I (16/10/2026): correções do Áxel nas notas. Tacos de salto (Goldtech), núcleo estrutural (C-Core),
-- painel acrílico com impressão digital UV (Al Componenti) e alumínio (Alumiconte) não são cliente.
-- Novo segmento "plástico técnico" (fora) e saltos/solados sem tacos.
update public.config set valor = jsonb_set(valor, '{segmentos}', (
  select jsonb_agg(s order by o) from (
    select case when s->>'id' = 'saltos_solados' then jsonb_set(s, '{nome}', '"Saltos e solados (plástico, PU, TPU)"')
                when s->>'id' = 'injecao_plastica' then jsonb_set(s, '{nome}', '"Injeção ou sopro de peças plásticas visíveis, sem acabamento"')
                else s end s, o
    from jsonb_array_elements(valor->'segmentos') with ordinality t(s, o)
    where s->>'id' <> 'plastico_tecnico'
    union all
    select '{"id":"plastico_tecnico","nome":"Plástico técnico ou oculto (tacos de salto, núcleos, chapas e painéis acrílicos, perfis, buchas, sapatas)","nota":0,"grupo":"fora"}'::jsonb, 100
  ) x)) where chave = 'icp';
