-- Fase 4: Conselho (Claude estrategista x ChatGPT cético).
-- Sessões, mensagens e o dossiê montado só com dados reais do banco, cada número com a sua fonte.
-- Aplicada no Supabase em 15/10/2026.

create table if not exists public.conselho_sessoes (
  id uuid primary key default gen_random_uuid(),
  tema text not null check (char_length(tema) between 3 and 1000),
  gatilho text not null default 'manual',   -- manual (pessoa na tela) ou o nome da rotina que abriu
  nivel text not null default 'rotina' check (nivel in ('rotina', 'dificil')),
  dossie jsonb not null,
  decisao text,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'fechada', 'erro')),
  custo_usd numeric(12, 6) not null default 0,
  tokens int not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists conselho_sessoes_criado on public.conselho_sessoes (criado_em desc);

create table if not exists public.conselho_mensagens (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.conselho_sessoes (id) on delete cascade,
  rodada int not null,                       -- 1, 2 ou 3 (fechamento)
  provedor text not null check (provedor in ('anthropic', 'openai', 'humano')),
  papel text not null,                       -- estrategista, cetico, relator, dono
  conteudo text not null,
  fontes jsonb not null default '[]',        -- fontes citadas no texto
  criado_em timestamptz not null default now()
);
create index if not exists conselho_mensagens_sessao on public.conselho_mensagens (sessao_id, criado_em);

-- Quem tem papel lê. Escrita só pela Edge Function (chave secreta).
do $$
declare t text;
begin
  foreach t in array array['conselho_sessoes', 'conselho_mensagens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists "le_quem_tem_papel" on public.%I', t);
    execute format('create policy "le_quem_tem_papel" on public.%I for select to authenticated using ((select public.papel_do_usuario()) is not null)', t);
  end loop;
end $$;

-- Teto de tokens por sessão: ao bater, o sistema força o fechamento.
insert into public.config (chave, valor) values ('teto_tokens_conselho', '60000') on conflict (chave) do nothing;

-- Dossiê: o mesmo para os dois. Só números do banco, cada bloco com a fonte (tabela e filtro).
create or replace function public.dossie_conselho()
returns jsonb language sql stable security definer set search_path = ''
as $$
with ultima as (
  select empresa_id, max(ocorrido_em) as em from public.interacoes group by empresa_id
),
abertos as (
  select n.*, e.nome as empresa, e.setor,
         floor(extract(epoch from now() - coalesce(u.em, e.criado_em)) / 86400)::int as dias_sem_interacao
  from public.negocios n join public.empresas e on e.id = n.empresa_id left join ultima u on u.empresa_id = n.empresa_id
  where n.etapa not in ('ganho', 'perdido')
)
select jsonb_build_object(
  'gerado_em', now(),
  'funil', jsonb_build_object(
    'fonte', 'negocios agrupados por etapa (todos)',
    'etapas', coalesce((select jsonb_agg(jsonb_build_object('etapa', etapa, 'negocios', n, 'valor_estimado', v) order by ordem)
      from (select etapa, count(*) n, coalesce(sum(valor_estimado), 0) v,
                   array_position(array['novo','qualificado','contatado','respondeu','reuniao','proposta','ganho','perdido'], etapa) ordem
            from public.negocios group by etapa) x), '[]')),
  'parados', jsonb_build_object(
    'fonte', 'negocios abertos x última interacoes.ocorrido_em da empresa; parado = 14+ dias sem interação',
    'por_etapa', coalesce((select jsonb_agg(jsonb_build_object('etapa', etapa, 'abertos', n, 'parados_14d', p, 'media_dias_sem_interacao', m))
      from (select etapa, count(*) n, count(*) filter (where dias_sem_interacao >= 14) p, round(avg(dias_sem_interacao)) m from abertos group by etapa) x), '[]'),
    'exemplos', coalesce((select jsonb_agg(jsonb_build_object('empresa', empresa, 'setor', setor, 'negocio', titulo, 'etapa', etapa, 'dias_sem_interacao', dias_sem_interacao))
      from (select * from abertos order by dias_sem_interacao desc limit 15) x), '[]')),
  'interacoes_90d', jsonb_build_object(
    'fonte', 'interacoes com ocorrido_em nos últimos 90 dias, por tipo e direção (sem mudança de etapa)',
    'contagem', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'direcao', direcao, 'n', n))
      from (select tipo, direcao, count(*) n from public.interacoes
            where ocorrido_em > now() - interval '90 days' and tipo <> 'mudanca_etapa' group by tipo, direcao) x), '[]')),
  'emails_90d', jsonb_build_object(
    'fonte', 'interacoes tipo email, últimos 90 dias: saida = enviados, entrada = respostas',
    'enviados', (select count(*) from public.interacoes where tipo = 'email' and direcao = 'saida' and ocorrido_em > now() - interval '90 days'),
    'respostas', (select count(*) from public.interacoes where tipo = 'email' and direcao = 'entrada' and ocorrido_em > now() - interval '90 days')),
  'movimentos_etapa_90d', jsonb_build_object(
    'fonte', 'interacoes tipo mudanca_etapa nos últimos 90 dias (conteudo = "de → para")',
    'contagem', coalesce((select jsonb_agg(jsonb_build_object('movimento', conteudo, 'n', n))
      from (select conteudo, count(*) n from public.interacoes where tipo = 'mudanca_etapa' and ocorrido_em > now() - interval '90 days'
            group by conteudo order by n desc limit 20) x), '[]')),
  'perdas', jsonb_build_object(
    'fonte', 'negocios etapa perdido, agrupados por motivo_perda',
    'motivos', coalesce((select jsonb_agg(jsonb_build_object('motivo', coalesce(motivo_perda, '(sem motivo)'), 'n', n))
      from (select motivo_perda, count(*) n from public.negocios where etapa = 'perdido' group by motivo_perda order by n desc) x), '[]')),
  'tarefas', jsonb_build_object(
    'fonte', 'tarefas não concluídas; atrasadas = vence_em antes de hoje',
    'abertas', (select count(*) from public.tarefas where not concluida),
    'atrasadas', (select count(*) from public.tarefas where not concluida and vence_em < (now() at time zone 'America/Sao_Paulo')::date)),
  'empresas', jsonb_build_object(
    'fonte', 'empresas por status e por setor (10 maiores)',
    'total', (select count(*) from public.empresas),
    'por_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.empresas group by status) x), '{}'),
    'por_setor', coalesce((select jsonb_agg(jsonb_build_object('setor', coalesce(setor, '(sem setor)'), 'n', n))
      from (select setor, count(*) n from public.empresas group by setor order by n desc limit 10) x), '[]')),
  'concorrentes', jsonb_build_object('fonte', 'tabela concorrentes (Fase 7)', 'itens', '[]'::jsonb, 'observacao', 'ainda não coletado'),
  'memoria', jsonb_build_object('fonte', 'memoria_aprendizados (Fase 5)', 'itens', '[]'::jsonb, 'observacao', 'ainda não existe')
)
$$;
-- Só a chave secreta (Edge Function) executa.
revoke all on function public.dossie_conselho() from public, anon, authenticated;
grant execute on function public.dossie_conselho() to service_role;

-- Cada passo da IA acontece uma vez só por sessão (clique duplo não gera rodada repetida).
create unique index if not exists conselho_passo_unico on public.conselho_mensagens (sessao_id, rodada, papel) where provedor <> 'humano';
