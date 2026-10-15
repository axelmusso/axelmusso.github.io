-- Fase 2: o CRM. Empresas, contatos, negócios (funil), interações, tarefas, lista de supressão e configuração.
-- Regra de todas as tabelas: lê quem tem papel; escrevem 'dono' e 'operador'; anônimo não vê nada.
-- Aplicada no Supabase em 15/10/2026.

-- Atualiza atualizado_em em toda alteração.
create or replace function privado.marcar_atualizado()
returns trigger language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end $$;
revoke all on function privado.marcar_atualizado() from public, anon, authenticated;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 200),
  site text,
  dominio text,
  setor text,
  porte text,
  cidade text,
  uf text check (uf ~ '^[A-Z]{2}$'),
  cnpj text,
  telefone text,
  origem text,                       -- de onde veio: manual, formulário do site, prospecção...
  icp_score int check (icp_score between 0 and 100),
  status text not null default 'prospect' check (status in ('prospect', 'cliente', 'descartada')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists empresas_dominio_unico on public.empresas (lower(dominio)) where dominio is not null;
create index if not exists empresas_nome_busca on public.empresas (lower(nome));

create table if not exists public.contatos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete cascade,
  nome text,
  cargo text,
  email text,
  telefone text,
  linkedin text,
  origem text,
  fonte_url text,                    -- LGPD: onde o dado foi encontrado
  coletado_em timestamptz,           -- LGPD: quando
  base_legal text,                   -- LGPD: base usada (ex.: legítimo interesse, contato público profissional)
  pode_contatar bool not null default true
);
create index if not exists contatos_empresa on public.contatos (empresa_id);
create index if not exists contatos_email on public.contatos (lower(email));

create table if not exists public.negocios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  titulo text not null,
  valor_estimado numeric(14, 2),
  etapa text not null default 'novo'
    check (etapa in ('novo', 'qualificado', 'contatado', 'respondeu', 'reuniao', 'proposta', 'ganho', 'perdido')),
  probabilidade int check (probabilidade between 0 and 100),
  fechado_em timestamptz,
  motivo_perda text,
  responsavel uuid references public.perfis (id) on delete set null
);
create index if not exists negocios_empresa on public.negocios (empresa_id);
create index if not exists negocios_etapa on public.negocios (etapa);

create table if not exists public.interacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  contato_id uuid references public.contatos (id) on delete set null,
  tipo text not null,                -- nota, ligacao, email, reuniao, whatsapp, mudanca_etapa...
  direcao text check (direcao in ('entrada', 'saida', 'interna')),
  assunto text,
  conteudo text,
  canal text,
  ocorrido_em timestamptz not null default now(),
  agente_id text                     -- preenchido quando foi um agente de IA; nulo = pessoa
);
create index if not exists interacoes_empresa on public.interacoes (empresa_id, ocorrido_em desc);

create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  vence_em date,
  concluida bool not null default false,
  responsavel uuid references public.perfis (id) on delete set null,
  negocio_id uuid references public.negocios (id) on delete cascade
);
create index if not exists tarefas_abertas on public.tarefas (vence_em) where not concluida;

create table if not exists public.lista_supressao (
  id uuid primary key default gen_random_uuid(),
  email text,
  dominio text,
  motivo text not null check (motivo in ('descadastro', 'bounce', 'spam', 'exclusao_dono', 'cliente')),
  criado_em timestamptz not null default now(),
  check (email is not null or dominio is not null)
);
create unique index if not exists supressao_email on public.lista_supressao (lower(email)) where email is not null;
create unique index if not exists supressao_dominio on public.lista_supressao (lower(dominio)) where dominio is not null and email is null;

create table if not exists public.config (
  chave text primary key,
  valor jsonb not null
);

-- atualizado_em de empresas
drop trigger if exists marcar_atualizado on public.empresas;
create trigger marcar_atualizado before update on public.empresas for each row execute function privado.marcar_atualizado();

-- Mudança de etapa vira linha do tempo da empresa e marca a data de fechamento.
create or replace function privado.registrar_etapa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.etapa in ('ganho', 'perdido') and old.etapa not in ('ganho', 'perdido') then new.fechado_em := coalesce(new.fechado_em, now()); end if;
  if new.etapa not in ('ganho', 'perdido') then new.fechado_em := null; end if;
  insert into public.interacoes (empresa_id, tipo, direcao, assunto, conteudo)
  values (new.empresa_id, 'mudanca_etapa', 'interna', new.titulo, old.etapa || ' → ' || new.etapa
          || case when new.etapa = 'perdido' and new.motivo_perda is not null then ' (' || new.motivo_perda || ')' else '' end);
  return new;
end $$;
revoke all on function privado.registrar_etapa() from public, anon, authenticated;
drop trigger if exists registrar_etapa on public.negocios;
create trigger registrar_etapa before update of etapa on public.negocios
  for each row when (old.etapa is distinct from new.etapa) execute function privado.registrar_etapa();

-- Regras (RLS). Mesmo modelo em todas as tabelas do CRM.
do $$
declare t text;
begin
  foreach t in array array['empresas', 'contatos', 'negocios', 'interacoes', 'tarefas', 'lista_supressao'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "le_quem_tem_papel" on public.%I', t);
    execute format('create policy "le_quem_tem_papel" on public.%I for select to authenticated using (public.papel_do_usuario() is not null)', t);
    execute format('drop policy if exists "escreve_dono_operador" on public.%I', t);
    execute format($p$create policy "escreve_dono_operador" on public.%I for all to authenticated
      using (public.papel_do_usuario() in ('dono', 'operador')) with check (public.papel_do_usuario() in ('dono', 'operador'))$p$, t);
  end loop;
end $$;

-- config: todos com papel leem; só o dono altera (tetos de gasto e o botão de parada moram aqui).
alter table public.config enable row level security;
revoke all on public.config from anon, authenticated;
grant select, insert, update on public.config to authenticated;
drop policy if exists "le_quem_tem_papel" on public.config;
create policy "le_quem_tem_papel" on public.config for select to authenticated using (public.papel_do_usuario() is not null);
drop policy if exists "dono_altera" on public.config;
create policy "dono_altera" on public.config for all to authenticated
  using (public.papel_do_usuario() = 'dono') with check (public.papel_do_usuario() = 'dono');

-- Valores iniciais. sistema_ativo começa desligado: nenhum robô roda até ser ligado na tela de Operação.
insert into public.config (chave, valor) values
  ('sistema_ativo', 'false'),
  ('teto_diario_usd', '1.30'),
  ('teto_mensal_usd', '40')
on conflict (chave) do nothing;
