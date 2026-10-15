-- Fase 1: login e base da área logada (/app).
-- Perfis de usuário, papel de cada um e a função usada nas regras (RLS) de todas as tabelas do CRM.
-- Aplicada no Supabase em 15/10/2026.

-- 1) Perfis: um por usuário do Supabase Auth.
--    papel nulo = conta sem acesso (alguém que se cadastrou sem ser autorizado).
create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text,
  email text not null,
  papel text check (papel in ('dono', 'operador', 'leitura')),
  criado_em timestamptz not null default now()
);
alter table public.perfis enable row level security;
revoke all on public.perfis from anon, authenticated;

-- 2) Papel de quem está logado. Usada nas regras de todas as tabelas.
--    security definer: lê perfis sem depender das regras de perfis (evita laço).
create or replace function public.papel_do_usuario()
returns text
language sql stable security definer set search_path = ''
as $$ select papel from public.perfis where id = auth.uid() $$;
revoke all on function public.papel_do_usuario() from public, anon;
grant execute on function public.papel_do_usuario() to authenticated;

-- 3) Regras de perfis: cada um vê o próprio perfil; o dono vê e altera todos. Ninguém muda o próprio papel.
drop policy if exists "ve_o_proprio_perfil" on public.perfis;
create policy "ve_o_proprio_perfil" on public.perfis for select to authenticated
  using (id = auth.uid() or public.papel_do_usuario() = 'dono');
drop policy if exists "dono_altera_perfis" on public.perfis;
create policy "dono_altera_perfis" on public.perfis for update to authenticated
  using (public.papel_do_usuario() = 'dono') with check (public.papel_do_usuario() = 'dono');
grant select, update (nome, papel) on public.perfis to authenticated;

-- 4) Perfil criado sozinho quando nasce um usuário.
--    O primeiro usuário vira 'dono'. Os seguintes nascem sem papel e só entram se o dono liberar.
create or replace function privado.criar_perfil()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('criar_perfil'));  -- dois cadastros ao mesmo tempo não viram dois donos
  insert into public.perfis (id, email, nome, papel)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.perfis) then null else 'dono' end
  );
  return new;
end $$;
revoke all on function privado.criar_perfil() from public, anon, authenticated;
drop trigger if exists criar_perfil on auth.users;
create trigger criar_perfil after insert on auth.users
  for each row execute function privado.criar_perfil();

-- 5) Regra padrão das tabelas do CRM: veja supabase/migrations/20261015_fase2_ajustes.sql
--    (lê quem tem papel; insere, altera e apaga 'dono' e 'operador'; anônimo nada).
