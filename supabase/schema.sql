-- Corquímica: tabelas do site. Cole no SQL Editor do Supabase e clique em Run.
create extension if not exists pgcrypto;

-- 1) Leads (formulário do site). O público só consegue INSERIR; ninguém lê pela internet.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contact text not null,
  material text,
  segment text,
  message text,
  product text,
  page text,
  consent boolean not null,
  status text not null default 'novo'
);
alter table public.leads enable row level security;
drop policy if exists "site_pode_inserir_lead" on public.leads;
create policy "site_pode_inserir_lead" on public.leads for insert to anon
  with check (consent = true and char_length(contact) between 2 and 200 and char_length(coalesce(message,'')) <= 600
              and char_length(coalesce(page,'')) <= 200 and char_length(coalesce(product,'')) <= 80);
revoke all on public.leads from anon, authenticated;
grant insert on public.leads to anon;

-- 2) Artigos (conteúdo técnico). O público só lê o que está publicado e na data.
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  description text not null,
  body_md text not null,
  category text,
  category_label text,
  faq jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.articles enable row level security;
drop policy if exists "site_le_artigos_publicados" on public.articles;
create policy "site_le_artigos_publicados" on public.articles for select to anon, authenticated
  using (published = true and published_at <= now());
revoke all on public.articles from anon, authenticated;
grant select on public.articles to anon, authenticated;
-- Para escrever/editar artigos use o Table Editor do painel do Supabase (o painel ignora essas regras).

-- 3) Segurança (08/10/2026): a função que liga o RLS automaticamente não pode ser chamada pela API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 4) Limite de envios do formulário: no máximo 20 contatos por hora e nenhum contato repetido em menos de 1 minuto.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
create or replace function privado.limitar_leads()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if (select count(*) from public.leads where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'limite de envios atingido, tente novamente mais tarde' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.leads where lower(contact) = lower(new.contact) and created_at > now() - interval '1 minute') then
    raise exception 'envio repetido' using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function privado.limitar_leads() from public, anon, authenticated;
drop trigger if exists limitar_leads on public.leads;
create trigger limitar_leads before insert on public.leads for each row execute function privado.limitar_leads();
create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- 5) Versões e backups do site: tabela de registro (só a chave secreta acessa) e pasta privada.
create table if not exists public.site_versoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in ('site', 'contatos')),
  versao text not null,
  commit_sha text,
  descricao text,
  arquivo text not null,
  tamanho_bytes bigint,
  execucao_url text
);
alter table public.site_versoes enable row level security;
revoke all on public.site_versoes from anon, authenticated;
create index if not exists site_versoes_criado_em_idx on public.site_versoes (criado_em desc);
insert into storage.buckets (id, name, public) values ('site-versoes', 'site-versoes', false)
on conflict (id) do update set public = false;
