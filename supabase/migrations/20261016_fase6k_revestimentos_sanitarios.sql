-- Fase 6, parte K (16/10/2026): dois segmentos alvo novos, pedidos pelo Áxel com exemplos da base.
--   Revestimentos PET/PVC (Lamiecco, Allparts, Plasbil): usam tintas e vernizes no revestimento.
--   Bebedouros, chuveiros elétricos e sifões de plástico (Acquabios; Zagonel e Lorenzetti como parecidos; Fiamon e Aplivac metalizam sifões).
update public.config set valor = jsonb_set(valor, '{segmentos}', (
  select jsonb_agg(s order by o) from (
    select case when s->>'id' = 'plastico_auto_linha_branca' then jsonb_set(s, '{nome}', '"Peças plásticas automotivas e de eletrodomésticos"') else s end s, o::numeric o
    from jsonb_array_elements(valor->'segmentos') with ordinality t(s, o)
    where s->>'id' not in ('revestimento_pet_pvc', 'sanitarios_linha_branca')
    union all select '{"id":"revestimento_pet_pvc","nome":"Revestimentos de PET ou PVC (painéis, forros, laminados e filmes decorativos impressos ou envernizados)","nota":95,"grupo":"alvo","perfil":"verniz"}'::jsonb, 6.1
    union all select '{"id":"sanitarios_linha_branca","nome":"Bebedouros, chuveiros elétricos, sifões e peças plásticas para banheiro","nota":95,"grupo":"alvo"}'::jsonb, 6.2
  ) x)) where chave = 'icp';

-- Exemplos da base, definidos pelo Áxel.
update public.empresas set segmento_icp = 'revestimento_pet_pvc', icp_manual = true, icp_motivo = 'Revestimentos PET/PVC (definido pelo Áxel)'
where origem = 'base_clientes' and (nome_chave like 'lamiecco%' or nome_chave like 'allparts%');
update public.empresas set segmento_icp = 'sanitarios_linha_branca', icp_manual = true, icp_motivo = 'Bebedouros (definido pelo Áxel)'
where origem = 'base_clientes' and nome_chave like 'acquabios%';
