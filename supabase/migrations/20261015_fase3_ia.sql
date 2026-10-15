-- Fase 3: camada de IA. Registro de toda chamada (custo, tokens, erro) e soma de gasto para o teto.
-- Aplicada no Supabase em 15/10/2026.

create table if not exists public.execucoes_agente (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,                       -- job da fila (Fase 9); nulo em chamadas avulsas
  provedor text not null check (provedor in ('anthropic', 'openai')),
  modelo text not null,
  papel text,                        -- estrategista, cético, redator, classificador, teste...
  tokens_entrada int not null default 0,
  tokens_saida int not null default 0,
  custo_usd numeric(12, 6) not null default 0,
  duracao_ms int,
  sucesso bool not null,
  erro text,                         -- inclui "teto diário atingido" quando a chamada foi recusada antes de sair
  criado_em timestamptz not null default now()
);
create index if not exists execucoes_criado_em on public.execucoes_agente (criado_em desc);

-- Quem tem papel lê; ninguém escreve pelo navegador. Só as Edge Functions (chave secreta) gravam.
alter table public.execucoes_agente enable row level security;
revoke all on public.execucoes_agente from anon, authenticated;
grant select on public.execucoes_agente to authenticated;
drop policy if exists "le_quem_tem_papel" on public.execucoes_agente;
create policy "le_quem_tem_papel" on public.execucoes_agente for select to authenticated
  using ((select public.papel_do_usuario()) is not null);

-- Gasto de hoje e do mês, no fuso de Brasília. Usada antes de cada chamada e na tela de Operação.
create or replace function public.gasto_ia()
returns table (hoje_usd numeric, mes_usd numeric, teto_diario_usd numeric, teto_mensal_usd numeric)
language sql stable security definer set search_path = ''
as $$
  with g as (
    select
      coalesce(sum(custo_usd) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date), 0) as hoje,
      coalesce(sum(custo_usd) filter (where date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', now() at time zone 'America/Sao_Paulo')), 0) as mes
    from public.execucoes_agente
    where criado_em > now() - interval '32 days'
  )
  select g.hoje, g.mes,
    (select (valor #>> '{}')::numeric from public.config where chave = 'teto_diario_usd'),
    (select (valor #>> '{}')::numeric from public.config where chave = 'teto_mensal_usd')
  from g
  where (select auth.role()) = 'service_role' or (select public.papel_do_usuario()) is not null
$$;
revoke all on function public.gasto_ia() from public, anon;
grant execute on function public.gasto_ia() to authenticated, service_role;
