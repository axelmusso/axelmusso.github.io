-- Fase 8: ranquear no Google e ser citado pelas IAs.
-- 1) Medição própria de visitas, sem cookie, sem IP e sem navegador: só página, dia e canal de origem.
--    O canal "ia" separa quem chega por ChatGPT, Perplexity, Gemini, Copilot, Claude e afins.
-- 2) Fila de propostas de conteúdo ligadas às lacunas da Fase 7. O agente escreve o rascunho; publicar é decisão humana.
-- Aplicada no Supabase em 18/10/2026.

create table if not exists public.visitas (
  id bigint generated always as identity primary key,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  caminho text not null,
  canal text not null check (canal in ('ia', 'busca', 'social', 'direto', 'email', 'outro')),
  origem text,                                 -- só o domínio de quem mandou (ex.: chatgpt.com), nunca a URL inteira
  criado_em timestamptz not null default now()
);
create index if not exists visitas_dia on public.visitas (dia desc, canal);

alter table public.visitas enable row level security;
revoke all on public.visitas from anon, authenticated;
grant select on public.visitas to authenticated;
drop policy if exists "le_quem_tem_papel" on public.visitas;
create policy "le_quem_tem_papel" on public.visitas for select to authenticated using ((select public.papel_do_usuario()) is not null);

-- Única porta de entrada do site: valida e classifica. O visitante não lê nem altera nada.
create or replace function public.registrar_visita(p_caminho text, p_origem text default null, p_utm text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  o text := lower(nullif(trim(coalesce(p_origem, '')), ''));
  u text := lower(nullif(trim(coalesce(p_utm, '')), ''));
  c text;
begin
  if p_caminho is null or p_caminho !~ '^/[A-Za-z0-9/_.-]{0,200}$' or p_caminho like '/app/%' then return; end if;
  if o is not null and o !~ '^[a-z0-9.-]{3,100}$' then o := null; end if;
  if o like '%corquimica.com.br' then o := null; end if;   -- navegação dentro do site não é origem
  -- ChatGPT costuma mandar utm_source=chatgpt.com mesmo quando o navegador esconde a origem.
  if coalesce(o, '') ~ '(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|claude\.ai|you\.com|poe\.com|deepseek\.com|meta\.ai|grok\.com|mistral\.ai)$'
     or coalesce(u, '') ~ '(chatgpt|openai|perplexity|gemini|copilot|claude)' then c := 'ia';
  elsif coalesce(o, '') ~ '(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+)$' then c := 'busca';
  elsif coalesce(o, '') ~ '(^|\.)(facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|t\.co|x\.com|youtube\.com|tiktok\.com|pinterest\.com|wa\.me|whatsapp\.com)$' then c := 'social';
  elsif coalesce(u, '') ~ '(email|newsletter|resend)' then c := 'email';
  elsif o is null then c := 'direto';
  else c := 'outro';
  end if;
  insert into public.visitas (caminho, canal, origem) values (left(p_caminho, 200), c, o);
end $$;
revoke all on function public.registrar_visita(text, text, text) from public;
grant execute on function public.registrar_visita(text, text, text) to anon, authenticated;

-- Resumo para a tela (só quem tem papel): visitas por canal e as páginas mais vistas vindas de IA.
create or replace function public.resumo_visitas(p_dias int default 30)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when (select public.papel_do_usuario()) is null then null else jsonb_build_object(
    'desde', (now() at time zone 'America/Sao_Paulo')::date - p_dias,
    'por_canal', coalesce((select jsonb_object_agg(canal, n) from (select canal, count(*) n from public.visitas where dia > (now() at time zone 'America/Sao_Paulo')::date - p_dias group by canal) x), '{}'),
    'ia_por_origem', coalesce((select jsonb_agg(jsonb_build_object('origem', coalesce(origem, '(utm)'), 'n', n) order by n desc) from (select origem, count(*) n from public.visitas where canal = 'ia' and dia > (now() at time zone 'America/Sao_Paulo')::date - p_dias group by origem) x), '[]'),
    'ia_paginas', coalesce((select jsonb_agg(jsonb_build_object('caminho', caminho, 'n', n) order by n desc) from (select caminho, count(*) n from public.visitas where canal = 'ia' and dia > (now() at time zone 'America/Sao_Paulo')::date - p_dias group by caminho order by n desc limit 15) x), '[]'),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'total', t, 'ia', i) order by dia) from (select dia, count(*) t, count(*) filter (where canal = 'ia') i from public.visitas where dia > (now() at time zone 'America/Sao_Paulo')::date - p_dias group by dia) x), '[]')
  ) end
$$;
revoke all on function public.resumo_visitas(int) from public, anon;
grant execute on function public.resumo_visitas(int) to authenticated;

-- Fila de conteúdo: cada proposta da análise de mercado vira uma linha aqui.
create table if not exists public.propostas_conteudo (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid references public.analises_mercado (id) on delete set null,
  lacuna text,
  tipo text,
  titulo text not null,
  url_sugerida text,
  esboco jsonb not null default '[]',
  dados_que_faltam jsonb not null default '[]',
  por_que text,
  status text not null default 'proposta' check (status in ('proposta', 'rascunho', 'aprovada', 'publicada', 'descartada')),
  rascunho text,                               -- texto pronto da página (Markdown), escrito pelo agente
  custo_usd numeric(12, 6) not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists propostas_conteudo_status on public.propostas_conteudo (status, criado_em desc);

alter table public.propostas_conteudo enable row level security;
revoke all on public.propostas_conteudo from anon, authenticated;
grant select, update on public.propostas_conteudo to authenticated;
drop policy if exists "le_quem_tem_papel" on public.propostas_conteudo;
create policy "le_quem_tem_papel" on public.propostas_conteudo for select to authenticated using ((select public.papel_do_usuario()) is not null);
-- Aprovar ou descartar é decisão humana (dono ou operador). O rascunho só a Edge Function escreve.
drop policy if exists "decide_dono_operador" on public.propostas_conteudo;
create policy "decide_dono_operador" on public.propostas_conteudo for update to authenticated
  using ((select public.papel_do_usuario()) in ('dono', 'operador'))
  with check ((select public.papel_do_usuario()) in ('dono', 'operador'));
revoke update on public.propostas_conteudo from authenticated;
grant update (status, atualizado_em) on public.propostas_conteudo to authenticated;

-- Análise fechada → propostas entram na fila (uma vez só por análise).
create or replace function public.propostas_da_analise()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'fechada' and old.status is distinct from 'fechada' and jsonb_typeof(new.propostas) = 'array' then
    insert into public.propostas_conteudo (analise_id, lacuna, tipo, titulo, url_sugerida, esboco, dados_que_faltam, por_que)
    select new.id, p->>'lacuna', p->>'tipo', coalesce(p->>'titulo', '(sem título)'), p->>'url_sugerida',
           coalesce(p->'esboco', '[]'), coalesce(p->'dados_que_faltam', '[]'), p->>'por_que'
    from jsonb_array_elements(new.propostas) p
    where not exists (select 1 from public.propostas_conteudo x where x.analise_id = new.id);
  end if;
  return new;
end $$;
drop trigger if exists propostas_da_analise on public.analises_mercado;
create trigger propostas_da_analise after update of status on public.analises_mercado
  for each row execute function public.propostas_da_analise();

-- As propostas da análise que já fechou (18/10) entram na fila agora.
insert into public.propostas_conteudo (analise_id, lacuna, tipo, titulo, url_sugerida, esboco, dados_que_faltam, por_que)
select a.id, p->>'lacuna', p->>'tipo', coalesce(p->>'titulo', '(sem título)'), p->>'url_sugerida',
       coalesce(p->'esboco', '[]'), coalesce(p->'dados_que_faltam', '[]'), p->>'por_que'
from public.analises_mercado a, jsonb_array_elements(a.propostas) p
where a.status = 'fechada' and jsonb_typeof(a.propostas) = 'array'
  and not exists (select 1 from public.propostas_conteudo x where x.analise_id = a.id);
