-- Fase 9: rodar 24 horas.
-- Fila de trabalhos (jobs) + pg_cron. A cada 5 minutos o cron chama a Edge Function "worker", que pega os jobs
-- vencidos por prioridade, trava a linha (para não rodar duas vezes), executa e, se falhar, reagenda com espera
-- crescente (5, 10 e 20 min) até 3 tentativas. As rotinas fixas são jobs que o próprio cron põe na fila.
-- Botão de parada: config.sistema_ativo = false. O cron não chama o worker, as rotinas não entram na fila
-- e o worker, se já estiver rodando, para antes do próximo job. A camada de IA também confere esse botão.
-- Aplicada no Supabase em 18/10/2026.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  payload jsonb not null default '{}',
  chave text,                                    -- evita o mesmo trabalho duas vezes na fila (ex.: "qualificar:<empresa>")
  status text not null default 'pendente' check (status in ('pendente', 'rodando', 'feito', 'erro', 'cancelado')),
  prioridade int not null default 5,             -- maior roda antes
  tentativas int not null default 0,
  rodar_em timestamptz not null default now(),
  iniciado_em timestamptz,
  terminado_em timestamptz,
  resultado jsonb,
  erro text,
  origem text not null default 'rotina',         -- rotina, worker (filho de outro job) ou manual
  criado_em timestamptz not null default now()
);
create index if not exists jobs_fila on public.jobs (status, rodar_em, prioridade desc);
create unique index if not exists jobs_chave_aberta on public.jobs (chave) where chave is not null and status in ('pendente', 'rodando');

alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to authenticated;
drop policy if exists "le_quem_tem_papel" on public.jobs;
create policy "le_quem_tem_papel" on public.jobs for select to authenticated using ((select public.papel_do_usuario()) is not null);

-- Põe um job na fila (se já houver um igual aberto, não duplica). Rotinas só entram com o sistema ligado.
create or replace function public.enfileirar(p_tipo text, p_payload jsonb default '{}', p_prioridade int default 5, p_chave text default null, p_rodar_em timestamptz default now(), p_origem text default 'rotina')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare novo uuid;
begin
  if p_origem = 'rotina' and (select valor from public.config where chave = 'sistema_ativo') is distinct from 'true'::jsonb then return null; end if;
  insert into public.jobs (tipo, payload, prioridade, chave, rodar_em, origem)
  values (p_tipo, coalesce(p_payload, '{}'), p_prioridade, p_chave, coalesce(p_rodar_em, now()), p_origem)
  on conflict (chave) where chave is not null and status in ('pendente', 'rodando') do nothing
  returning id into novo;
  return novo;
end $$;

-- Pega o próximo job vencido e trava (FOR UPDATE SKIP LOCKED: dois workers nunca pegam o mesmo).
-- Job "rodando" há mais de 20 minutos é dado como perdido (a função caiu) e volta para a fila.
create or replace function public.pegar_job()
returns setof public.jobs language plpgsql security definer set search_path = ''
as $$
declare j public.jobs;
begin
  update public.jobs set status = case when tentativas >= 3 then 'erro' else 'pendente' end,
         erro = coalesce(erro, 'Ficou rodando mais de 20 minutos (a função caiu).'), terminado_em = case when tentativas >= 3 then now() end
  where status = 'rodando' and iniciado_em < now() - interval '20 minutes';
  select * into j from public.jobs where status = 'pendente' and rodar_em <= now()
  order by prioridade desc, rodar_em limit 1 for update skip locked;
  if not found then return; end if;
  update public.jobs set status = 'rodando', iniciado_em = now(), tentativas = tentativas + 1, erro = null
  where id = j.id returning * into j;
  return next j;
end $$;

-- Termina um job: feito, ou de volta à fila com espera crescente (5, 10, 20 min); na 3ª falha, erro.
create or replace function public.terminar_job(p_id uuid, p_ok boolean, p_resultado jsonb default null, p_erro text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.jobs set
    status = case when p_ok then 'feito' when tentativas >= 3 then 'erro' else 'pendente' end,
    rodar_em = case when p_ok or tentativas >= 3 then rodar_em else now() + interval '5 minutes' * power(2, tentativas - 1) end,
    terminado_em = case when p_ok or tentativas >= 3 then now() end,
    resultado = p_resultado, erro = left(p_erro, 1000)
  where id = p_id and status = 'rodando';
end $$;

-- Segredo que só o cron e o worker conhecem (guardado no Vault, nunca no código).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'worker_segredo') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'worker_segredo', 'Autoriza o pg_cron a chamar a Edge Function worker (Fase 9)');
  end if;
end $$;
create or replace function public.conferir_segredo_worker(p text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from vault.decrypted_secrets where name = 'worker_segredo' and decrypted_secret = p) $$;

do $$
declare f text;
begin
  foreach f in array array['enfileirar(text, jsonb, integer, text, timestamp with time zone, text)', 'pegar_job()', 'terminar_job(uuid, boolean, jsonb, text)', 'conferir_segredo_worker(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Chamada do worker pelo cron: só com o sistema ligado.
create or replace function public.chamar_worker()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select valor from public.config where chave = 'sistema_ativo') is distinct from 'true'::jsonb then return; end if;
  perform net.http_post(
    url := 'https://fjgqojdziavduzgqpztp.supabase.co/functions/v1/worker',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cq-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'worker_segredo')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
end $$;
revoke all on function public.chamar_worker() from public, anon, authenticated;

-- Agenda (horários em UTC; Brasília = UTC-3).
do $$
declare j text;
begin
  foreach j in array array['cq-worker', 'cq-descoberta', 'cq-cadencia', 'cq-enriquecimento', 'cq-semanal', 'cq-relatorio'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;
select cron.schedule('cq-worker', '*/5 * * * *', $$select public.chamar_worker()$$);
-- diária de manhã (7h): descoberta de novas empresas (site pelo Google Maps)
select cron.schedule('cq-descoberta', '0 10 * * *', $$select public.enfileirar('descoberta', '{}', 4, 'descoberta')$$);
-- de hora em hora em horário comercial (seg a sex, 8h às 17h): cadência de e-mail e leitura de respostas
select cron.schedule('cq-cadencia', '0 11-20 * * 1-5', $$select public.enfileirar('cadencia', '{}', 8, 'cadencia')$$);
-- diária à noite (21h): enriquecimento e pontuação
select cron.schedule('cq-enriquecimento', '0 0 * * *', $$select public.enfileirar('enriquecimento', '{}', 3, 'enriquecimento')$$);
-- semanal (segunda, 6h): coleta de concorrentes e consolidação da memória
select cron.schedule('cq-semanal', '0 9 * * 1', $$select public.enfileirar('concorrencia_semanal', '{}', 2, 'concorrencia_semanal'), public.enfileirar('memoria_consolidar', '{}', 2, 'memoria_consolidar')$$);
-- diária às 8h: relatório do dia para o dono
select cron.schedule('cq-relatorio', '0 11 * * *', $$select public.enfileirar('relatorio', '{}', 9, 'relatorio')$$);
