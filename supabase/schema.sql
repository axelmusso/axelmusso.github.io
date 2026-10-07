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
