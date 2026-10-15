-- Fase 6, parte C: perfil de produto de cada empresa. O e-mail só fala de um produto quando há evidência de que a empresa usa.
--   verniz   = usa vernizes UV/lacas na linha (grupos MOV e MET da base, ou evidência no site)
--   resina3d = usa só resinas 3D (grupo 3D)
--   geral    = sem informação: mensagem mais geral, sem falar de verniz
-- Aplicada no Supabase em 15/10/2026.
alter table public.empresas
  add column if not exists perfil_produto text not null default 'geral' check (perfil_produto in ('verniz', 'resina3d', 'geral')),
  add column if not exists perfil_fonte text;

update public.empresas set
  perfil_produto = case
    when upper(replace(grupo, ' ', '')) in ('MOV', 'MET') then 'verniz'
    when upper(replace(grupo, ' ', '')) = '3D' then 'resina3d'
    else 'geral' end,
  perfil_fonte = 'grupo de cadastro ' || coalesce(grupo, '(vazio)')
where origem = 'base_clientes';

-- Ajuste (15/10/2026): metalizadoras (MET) têm perfil próprio. Podem ouvir só de Verniz UV, Solventes e Tintas para ABS.
alter table public.empresas drop constraint if exists empresas_perfil_produto_check;
alter table public.empresas add constraint empresas_perfil_produto_check check (perfil_produto in ('verniz', 'metalizacao', 'resina3d', 'geral'));
update public.empresas set perfil_produto = 'metalizacao' where origem = 'base_clientes' and upper(replace(grupo, ' ', '')) = 'MET';
