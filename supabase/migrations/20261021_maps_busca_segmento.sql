-- Busca por segmento no Google Maps (21/10/2026): a rotina descoberta usa as consultas que sobram do "achar site"
-- para buscar "<segmento> em <cidade>", cidade por cidade, e cadastrar as empresas novas como prospect.
-- A qualificação de sempre decide quem é cliente (quem só injeta fica com nota 0).
-- Cidades na ordem de peso na base de clientes; segmentos na ordem do que mais se parece com os clientes.
insert into public.config (chave, valor) values
  ('maps_segmentos', '["metalização a vácuo de peças plásticas", "pintura de peças plásticas", "fábrica de saltos e solados", "componentes para calçados", "fivelas e enfeites para calçados", "pés e componentes plásticos para móveis", "tampas e embalagens para cosméticos", "peças plásticas automotivas", "cromagem de plástico", "verniz UV em peças"]'::jsonb),
  ('maps_cidades', '["Novo Hamburgo RS", "Caxias do Sul RS", "Campo Bom RS", "Sapiranga RS", "Estância Velha RS", "Três Coroas RS", "Igrejinha RS", "Porto Alegre RS", "Parobé RS", "Dois Irmãos RS", "São Leopoldo RS", "São João Batista SC"]'::jsonb)
on conflict (chave) do nothing;
