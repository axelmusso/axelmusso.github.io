-- Fase 6, parte J (16/10/2026): correção do Áxel. Pés, rodízios, puxadores e acessórios de móveis de PLÁSTICO (ou zamac)
-- são alvo prioritário (ex. AKEO, um dos clientes mais importantes). Saem do "plástico técnico".
update public.config set valor = jsonb_set(valor, '{segmentos}', (
  select jsonb_agg(case
    when s->>'id' = 'puxadores_acessorios' then jsonb_set(s, '{nome}', '"Acessórios de móveis de plástico ou zamac: puxadores, pés, rodízios, sapatas, maçanetas e peças decorativas"')
    when s->>'id' = 'plastico_tecnico' then jsonb_set(s, '{nome}', '"Plástico técnico ou oculto (tacos de salto, núcleos estruturais, chapas e painéis acrílicos)"')
    else s end order by o)
  from jsonb_array_elements(valor->'segmentos') with ordinality t(s, o))) where chave = 'icp';

-- AKEO (cliente ativo, acessórios plásticos para móveis): segmento definido pelo Áxel.
update public.empresas set segmento_icp = 'puxadores_acessorios', icp_manual = true,
  icp_motivo = 'Acessórios de móveis de plástico (definido pelo Áxel): um dos clientes mais importantes'
where nome_chave like 'akeo%' and origem = 'base_clientes';
