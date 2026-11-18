-- 18/11/2026: destravar o funil e criar alertas para paradas silenciosas.
-- Diagnóstico: desde 02/11 a rotina da manhã procurava o site das MESMAS ~100 empresas todo dia (3.101 buscas para 338 empresas),
-- porque quem não tinha site achado nunca era marcado. O Conselho pulava a revisão semanal por "falta de folga" no teto diário.
-- Nada disso gerava alerta. E ninguém sabia quem desligou a busca por IA (foi uma sessão do Claude em 24/10, sem registro).

-- 1) Marca de "já procuramos o site desta empresa" (ache ou não).
alter table public.empresas add column if not exists site_buscado_em timestamptz;
update public.empresas e set site_buscado_em = j.ultimo
  from (select (payload->>'empresa_id')::uuid id, max(criado_em) ultimo from public.jobs
        where tipo = 'maps_achar_site' and payload ? 'empresa_id' group by 1) j
 where e.id = j.id and e.site_buscado_em is null;

-- 2) Revisão semanal do Conselho em cron próprio (terça 6h de Brasília), separada da concorrência de segunda.
select cron.unschedule('cq-revisao') where exists (select 1 from cron.job where jobname = 'cq-revisao');
select cron.schedule('cq-revisao', '0 9 * * 2', $$select public.enfileirar('revisao_semanal', '{}', 2, 'revisao_semanal')$$);

-- 3) Histórico de toda mudança na config: quem, quando, de quê para quê.
create table if not exists public.config_historico (
  id bigint generated always as identity primary key,
  chave text not null,
  valor_antes jsonb,
  valor_depois jsonb,
  quem text,
  em timestamptz not null default now()
);
alter table public.config_historico enable row level security;

create or replace function public.registrar_mudanca_config() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.valor is not distinct from old.valor then return new; end if;
  insert into public.config_historico (chave, valor_antes, valor_depois, quem)
  values (coalesce(new.chave, old.chave), case when tg_op <> 'INSERT' then old.valor end, case when tg_op <> 'DELETE' then new.valor end,
          coalesce(auth.uid()::text, nullif(current_setting('request.jwt.claim.role', true), ''), current_user));
  return coalesce(new, old);
end $$;
drop trigger if exists config_historico on public.config;
create trigger config_historico after insert or update or delete on public.config
  for each row execute function public.registrar_mudanca_config();

-- 4) Alertas: os 5 que já existiam + paradas silenciosas do funil.
create or replace function public.condicoes_alerta()
 returns table(tipo text, alvo text, detalhe text)
 language sql stable security definer set search_path to ''
as $function$
  with g as (select * from public.gasto_ia()),
  ev as (
    select count(*) filter (where e->>'tipo' = 'delivered') entregues, count(*) filter (where e->>'tipo' = 'complained') reclamacoes,
           count(distinct m.id) filter (where e->>'tipo' = 'bounced') bounces
    from public.emails m, jsonb_array_elements(case when jsonb_typeof(m.eventos) = 'array' then m.eventos else '[]'::jsonb end) e
    where m.enviado_em > now() - interval '30 days'
  ),
  env as (select count(*) n from public.emails where enviado_em > now() - interval '30 days'),
  ult as (
    select papel, sucesso, row_number() over (partition by papel order by criado_em desc) n
    from public.execucoes_agente where criado_em > now() - interval '7 days'
  ),
  ativo as (select (select valor from public.config where chave = 'sistema_ativo') = 'true'::jsonb sim),
  achar as (select count(*) total, count(distinct payload->>'empresa_id') distintas from public.jobs
            where tipo = 'maps_achar_site' and criado_em > now() - interval '7 days'),
  combos as (
    select count(*) pendentes from
      jsonb_array_elements_text(coalesce((select valor from public.config where chave = 'maps_segmentos'), '[]')) s,
      jsonb_array_elements_text(coalesce((select valor from public.config where chave = 'maps_cidades'), '[]')) c
    where not exists (select 1 from public.jobs j where j.tipo = 'maps_buscar_segmento' and j.chave = 'buscar:' || s || ' em ' || c
                      and j.status in ('pendente', 'rodando', 'feito') and j.criado_em > now() - interval '90 days')
  ),
  rev as (select pulou_motivo, row_number() over (order by criado_em desc) n from public.revisoes)
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
  -- ---- paradas silenciosas do funil (18/11/2026) ----
  union all
  select 'funil', 'sem_empresas_novas', 'Nenhuma empresa nova entrou no funil nos últimos 3 dias. A descoberta pode estar travada ou sem fontes.'
    from ativo where ativo.sim and not exists (select 1 from public.empresas where criado_em > now() - interval '3 days')
  union all
  select 'funil', 'poucas_candidatas', format('Só %s empresas prontas para o 1º e-mail. Abaixo de 20 o envio para por falta de gente: é preciso mais fontes ou rever a nota mínima.', n)
    from (select count(*) n from public.candidatas_primeiro_email(100)) x, ativo where ativo.sim and x.n < 20
  union all
  select 'funil', 'sem_rascunhos', 'Nenhum 1º e-mail foi redigido nos últimos 3 dias.'
    from ativo where ativo.sim and not exists (select 1 from public.emails where passo = 1 and criado_em > now() - interval '3 days')
  union all
  select 'funil', 'sem_envios', 'Nenhum e-mail foi enviado nos últimos 5 dias com o sistema ligado.'
    from ativo where ativo.sim and not exists (select 1 from public.emails where enviado_em > now() - interval '5 days')
  union all
  select 'funil', 'maps_repetindo', format('A busca de sites repetiu empresas: %s buscas para só %s empresas diferentes em 7 dias.', total, distintas)
    from achar where total >= 50 and distintas < 0.5 * total
  union all
  select 'funil', 'buscas_esgotadas', 'Todas as combinações segmento × cidade do Maps já foram buscadas nos últimos 90 dias. Adicione segmentos ou cidades.'
    from combos, ativo where ativo.sim and combos.pendentes = 0
  union all
  select 'conselho', 'sem_sessao', 'O Conselho não se reuniu nos últimos 8 dias.'
    from ativo where ativo.sim and not exists (select 1 from public.conselho_sessoes where criado_em > now() - interval '8 days')
  union all
  select 'conselho', 'revisao_pulada', 'As duas últimas revisões semanais do Conselho foram puladas: ' || coalesce((select pulou_motivo from rev where n = 1), '')
    from (select count(*) filter (where pulou_motivo is not null) puladas, count(*) total from rev where n <= 2) r where r.total = 2 and r.puladas = 2
  union all
  select 'email', 'bounce', format('%s%% dos e-mails dos últimos 30 dias voltaram (%s de %s). Acima de 3%% a reputação do remetente cai: revise a origem dos contatos.', round(100.0 * ev.bounces / env.n, 1), ev.bounces, env.n)
    from ev, env where env.n >= 50 and ev.bounces::numeric / env.n > 0.03
  union all
  select 'config', h.chave, format('A configuração "%s" mudou: de %s para %s (por %s).', h.chave, coalesce(left(h.valor_antes::text, 120), '—'), coalesce(left(h.valor_depois::text, 120), '—'), coalesce(h.quem, '?'))
    from (select distinct on (chave) * from public.config_historico where em > now() - interval '24 hours' order by chave, em desc) h
$function$;

-- 5) Domínios de provedores antigos com 80-100% de bounce: não enviar mais.
insert into public.lista_supressao (dominio, motivo)
select d, 'bounce' from unnest(array['terra.com.br', 'ig.com.br']) d
where not exists (select 1 from public.lista_supressao s where lower(s.dominio) = d and s.email is null);

-- 6) Mais segmentos de plástico no Maps (só quem decora/acaba plástico, não quem só injeta ou só imprime).
update public.config set valor = (
  select jsonb_agg(distinct x) from jsonb_array_elements_text(valor || '["bijuterias e acessórios plásticos","componentes plásticos para calçados","peças plásticas automotivas pintadas","tampas plásticas decoradas","molduras de plástico","metalização de embalagens plásticas","galvanoplastia em plástico"]'::jsonb) x)
where chave = 'maps_segmentos';
