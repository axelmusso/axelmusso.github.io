-- Fase 5: memória que aprende. Fatos, aprendizados com número e embedding (pgvector), busca por semelhança
-- e consolidação semanal. Regra: memória guarda padrão aprendido, nunca dado de pessoa.
-- Aplicada no Supabase em 15/10/2026.

create extension if not exists vector with schema extensions;

create table if not exists public.memoria_fatos (
  id uuid primary key default gen_random_uuid(),
  fato text not null,
  fonte text not null,
  confianca numeric(3, 2) not null default 0.5 check (confianca between 0 and 1),
  valido_ate date,
  criado_em timestamptz not null default now()
);

create table if not exists public.memoria_aprendizados (
  id uuid primary key default gen_random_uuid(),
  hipotese text not null,                    -- o padrão, com o número que o sustenta
  evidencia jsonb not null default '[]',     -- lista de medições: {metrica, valor, amostra, fonte, em}
  resultado text,                            -- o que aconteceu quando foi testado
  confianca numeric(3, 2) not null default 0.5 check (confianca between 0 and 1),
  status text not null default 'hipotese' check (status in ('proposta', 'hipotese', 'testando', 'confirmado', 'refutado')),
  tags text[] not null default '{}',
  embedding extensions.vector(1536),
  visto_vezes int not null default 1,
  origem text,                               -- conselho, campanha, manual...
  origem_id uuid,                            -- ex.: conselho_sessoes.id
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists memoria_embedding on public.memoria_aprendizados using hnsw (embedding extensions.vector_cosine_ops);
drop trigger if exists marcar_atualizado on public.memoria_aprendizados;
create trigger marcar_atualizado before update on public.memoria_aprendizados for each row execute function privado.marcar_atualizado();

create table if not exists public.memoria_consolidacoes (
  id uuid primary key default gen_random_uuid(),
  resumo text not null,                      -- o que mudou, em português
  mudancas jsonb not null default '[]',
  criado_em timestamptz not null default now()
);

-- Toda chamada de IA registra quais memórias entraram no prompt (citação visível no log).
alter table public.execucoes_agente add column if not exists memorias uuid[];

-- Leitura para quem tem papel; escrita só pelas Edge Functions, que validam (número presente, sem dado pessoal).
do $$
declare t text;
begin
  foreach t in array array['memoria_fatos', 'memoria_aprendizados', 'memoria_consolidacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists "le_quem_tem_papel" on public.%I', t);
    execute format('create policy "le_quem_tem_papel" on public.%I for select to authenticated using ((select public.papel_do_usuario()) is not null)', t);
  end loop;
end $$;
-- O embedding é grande e não serve na tela: o navegador não lê essa coluna.
revoke select on public.memoria_aprendizados from authenticated;
grant select (id, hipotese, evidencia, resultado, confianca, status, tags, visto_vezes, origem, origem_id, criado_em, atualizado_em)
  on public.memoria_aprendizados to authenticated;

-- Busca por semelhança. confianca_min e incluir_baixas controlam o que entra:
-- antes de agir: confiança > 0,6 e não refutado; para achar duplicado: qualquer confiança, não refutado.
create or replace function public.buscar_memoria(consulta extensions.vector, limite int default 5, confianca_min numeric default 0.6)
returns table (id uuid, hipotese text, evidencia jsonb, resultado text, confianca numeric, status text, tags text[], visto_vezes int, similaridade float)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.hipotese, m.evidencia, m.resultado, m.confianca, m.status, m.tags, m.visto_vezes,
         1 - (m.embedding operator(extensions.<=>) consulta) as similaridade
  from public.memoria_aprendizados m
  where m.status <> 'refutado' and m.confianca > confianca_min and m.embedding is not null
  order by m.embedding operator(extensions.<=>) consulta
  limit limite
$$;
revoke all on function public.buscar_memoria(extensions.vector, int, numeric) from public, anon, authenticated;
grant execute on function public.buscar_memoria(extensions.vector, int, numeric) to service_role;

-- Pares quase iguais (para a consolidação fundir).
create or replace function public.memoria_duplicadas(limiar float default 0.92)
returns table (manter uuid, fundir uuid, similaridade float)
language sql stable security definer set search_path = ''
as $$
  select a.id, b.id, 1 - (a.embedding operator(extensions.<=>) b.embedding)
  from public.memoria_aprendizados a
  join public.memoria_aprendizados b on a.criado_em < b.criado_em or (a.criado_em = b.criado_em and a.id < b.id)
  where a.status <> 'refutado' and b.status <> 'refutado' and a.status <> 'proposta' and b.status <> 'proposta'
    and a.embedding is not null and b.embedding is not null
    and 1 - (a.embedding operator(extensions.<=>) b.embedding) >= limiar
$$;
revoke all on function public.memoria_duplicadas(float) from public, anon, authenticated;
grant execute on function public.memoria_duplicadas(float) to service_role;
