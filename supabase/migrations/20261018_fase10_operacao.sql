-- Fase 10: operação à vista.
-- Painel da tela Operação (e-mails, leads por origem, aprovações pendentes, fila) e alertas por e-mail para o dono:
--   gasto de IA acima de 80% do teto (dia ou mês), reclamação de spam acima de 0,1%,
--   mais de 50 jobs em erro nas últimas 24 h, e qualquer agente com 5 falhas seguidas.
-- Os alertas são conferidos pelo worker a cada execução (sem agendamento novo) e saem no máximo 1 vez por dia por tipo.
-- Aplicada no Supabase em 18/10/2026.

create table if not exists public.alertas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                      -- gasto, spam, fila, agente
  chave text not null unique,              -- tipo + alvo + dia: o mesmo alerta não repete no dia
  detalhe text not null,
  enviado_em timestamptz,                  -- quando o e-mail saiu (null = falhou ou não saiu)
  criado_em timestamptz not null default now()
);
create index if not exists alertas_criado on public.alertas (criado_em desc);
alter table public.alertas enable row level security;
revoke all on public.alertas from anon, authenticated;
grant select on public.alertas to authenticated;
drop policy if exists "le_quem_tem_papel" on public.alertas;
create policy "le_quem_tem_papel" on public.alertas for select to authenticated using ((select public.papel_do_usuario()) is not null);

-- Condições de alerta ativas agora. Cada linha: tipo, alvo (o que disparou) e detalhe em português.
create or replace function public.condicoes_alerta()
returns table (tipo text, alvo text, detalhe text) language sql stable security definer set search_path = ''
as $$
  with g as (select * from public.gasto_ia()),
  ev as (
    select count(*) filter (where e->>'tipo' = 'delivered') entregues, count(*) filter (where e->>'tipo' = 'complained') reclamacoes
    from public.emails m, jsonb_array_elements(case when jsonb_typeof(m.eventos) = 'array' then m.eventos else '[]'::jsonb end) e
    where m.enviado_em > now() - interval '30 days'
  ),
  ult as (
    select papel, sucesso, row_number() over (partition by papel order by criado_em desc) n
    from public.execucoes_agente where criado_em > now() - interval '7 days'
  )
  select 'gasto', 'dia', format('Gasto de IA hoje: US$ %s de US$ %s (%s%% do teto diário).', round(g.hoje_usd, 2), g.teto_diario_usd, round(100 * g.hoje_usd / nullif(g.teto_diario_usd, 0)))
    from g where g.teto_diario_usd > 0 and g.hoje_usd >= 0.8 * g.teto_diario_usd
  union all
  select 'gasto', 'mes', format('Gasto de IA no mês: US$ %s de US$ %s (%s%% do teto mensal).', round(g.mes_usd, 2), g.teto_mensal_usd, round(100 * g.mes_usd / nullif(g.teto_mensal_usd, 0)))
    from g where g.teto_mensal_usd > 0 and g.mes_usd >= 0.8 * g.teto_mensal_usd
  union all
  select 'spam', 'taxa', format('Reclamação de spam em %s%% dos e-mails entregues nos últimos 30 dias (%s de %s). O limite é 0,1%%: reveja os textos e a lista antes de enviar mais.', round(100.0 * ev.reclamacoes / ev.entregues, 2), ev.reclamacoes, ev.entregues)
    from ev where ev.reclamacoes > 0 and ev.reclamacoes::numeric / greatest(ev.entregues, 1) > 0.001
  union all
  select 'fila', 'erros', format('%s trabalhos automáticos terminaram em erro nas últimas 24 horas. A fila pode estar travada.', count(*))
    from public.jobs where status = 'erro' and terminado_em > now() - interval '24 hours' having count(*) > 50
  union all
  select 'agente', u.papel, format('O agente "%s" falhou 5 vezes seguidas.', u.papel)
    from ult u where u.n <= 5 group by u.papel having count(*) = 5 and bool_and(not u.sucesso)
$$;

-- Registra o alerta do dia (devolve o id só se for novo: é o sinal para mandar o e-mail).
create or replace function public.registrar_alerta(p_tipo text, p_alvo text, p_detalhe text)
returns uuid language sql security definer set search_path = ''
as $$
  insert into public.alertas (tipo, chave, detalhe)
  values (p_tipo, p_tipo || ':' || p_alvo || ':' || (now() at time zone 'America/Sao_Paulo')::date, p_detalhe)
  on conflict (chave) do nothing
  returning id
$$;

do $$
declare f text;
begin
  foreach f in array array['condicoes_alerta()', 'registrar_alerta(text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Painel da tela Operação (quem tem papel): números dos últimos p_dias.
create or replace function public.painel_operacao(p_dias int default 30)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with desde as (select now() - make_interval(days => p_dias) d),
  env as (select m.* from public.emails m, desde where m.enviado_em > desde.d),
  ev as (
    select e->>'tipo' tipo, count(distinct m.id) n
    from env m, jsonb_array_elements(case when jsonb_typeof(m.eventos) = 'array' then m.eventos else '[]'::jsonb end) e group by 1
  )
  select case when (select public.papel_do_usuario()) is null then null else jsonb_build_object(
    'dias', p_dias,
    'emails', jsonb_build_object(
      'enviados', (select count(*) from env),
      'entregues', coalesce((select n from ev where tipo = 'delivered'), 0),
      'abertos', coalesce((select n from ev where tipo = 'opened'), 0),
      'bounces', coalesce((select n from ev where tipo = 'bounced'), 0),
      'reclamacoes', coalesce((select n from ev where tipo = 'complained'), 0),
      'respondidos', (select count(distinct r.email_id) from public.respostas r, desde where r.recebido_em > desde.d and r.email_id is not null),
      'respostas', (select count(*) from public.respostas r, desde where r.recebido_em > desde.d),
      'telefones', (select count(*) from public.interacoes i, desde where i.assunto = 'Telefone obtido' and i.ocorrido_em > desde.d)
    ),
    'leads_por_origem', coalesce((select jsonb_agg(jsonb_build_object('origem', o, 'n', n) order by n desc) from (
      select split_part(origem, ':', 1) o, count(*) n from public.empresas, desde where criado_em > desde.d group by 1
      union all
      select 'formulario_site', count(*) from public.leads, desde where created_at > desde.d having count(*) > 0
    ) x), '[]'),
    'aprovacoes', jsonb_build_object(
      'emails', (select count(*) from public.emails where status = 'rascunho'),
      'aprovados_esperando', (select count(*) from public.emails where status = 'aprovado'),
      'respostas', (select count(*) from public.respostas where status = 'nova' and rascunho is not null),
      'conteudo', (select count(*) from public.propostas_conteudo where status = 'rascunho')
    ),
    'jobs', jsonb_build_object(
      'pendentes', (select count(*) from public.jobs where status = 'pendente'),
      'rodando', (select count(*) from public.jobs where status = 'rodando'),
      'erro_24h', (select count(*) from public.jobs where status = 'erro' and terminado_em > now() - interval '24 hours')
    ),
    'alertas_ativos', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'detalhe', detalhe)) from public.condicoes_alerta()), '[]')
  ) end
$$;
revoke all on function public.painel_operacao(int) from public, anon;
grant execute on function public.painel_operacao(int) to authenticated;
