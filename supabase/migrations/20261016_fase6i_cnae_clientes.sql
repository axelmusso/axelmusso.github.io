-- Fase 6, parte I: dados do cadastro do CNPJ (CNAE principal e secundários, situação), para conhecer o perfil dos clientes
-- e procurar empresas parecidas. Preenchido pela ação "dados_cnpj" da prospecção.
alter table public.empresas
  add column if not exists cnaes_secundarios text[],
  add column if not exists situacao_cadastral text;
