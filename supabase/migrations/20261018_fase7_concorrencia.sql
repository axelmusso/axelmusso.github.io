-- Fase 7: inteligência de concorrência e de mercado.
-- Coleta pública dos sites dos concorrentes (home, produtos, blog, preço, llms.txt, dados estruturados),
-- com hash do conteúdo para saber quando algo mudou, e análises do Conselho (Claude propõe, ChatGPT confere).
-- Aplicada no Supabase em 18/10/2026.

create table if not exists public.concorrentes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 120),
  dominio text not null unique,
  site text not null,                         -- endereço de partida; só seguimos links dentro deste caminho
  observado_desde date not null default (now() at time zone 'America/Sao_Paulo')::date,
  ativo boolean not null default true,
  ultima_coleta_em timestamptz,
  ultimo_erro text,                           -- ex.: o site bloqueia robôs (não disfarçamos o robô de navegador)
  criado_em timestamptz not null default now()
);

-- Uma linha por versão de página: só grava de novo quando o hash muda (histórico de mudanças).
create table if not exists public.coletas_concorrente (
  id uuid primary key default gen_random_uuid(),
  concorrente_id uuid not null references public.concorrentes (id) on delete cascade,
  url text not null,
  tipo text not null check (tipo in ('home', 'produto', 'blog', 'preco', 'institucional', 'llms', 'outra')),
  html_hash text not null,                    -- SHA-256 do conteúdo visível (título, h1, descrição e texto)
  titulo text,
  h1 text,
  meta text,
  texto text,
  dados_estruturados jsonb not null default '[]',  -- tipos schema.org encontrados (Organization, Product...)
  mudou boolean not null default false,       -- já existia esta URL com outro hash
  coletado_em timestamptz not null default now()
);
create index if not exists coletas_concorrente_url on public.coletas_concorrente (concorrente_id, url, coletado_em desc);

create table if not exists public.analises_mercado (
  id uuid primary key default gen_random_uuid(),
  escopo text not null default 'todos',
  status text not null default 'em_andamento' check (status in ('em_andamento', 'fechada', 'erro')),
  dossie jsonb not null,                      -- o que os dois receberam (páginas coletadas + o nosso site)
  passos jsonb not null default '[]',         -- texto de cada passo: proposta, crítica, versão final
  matriz jsonb,                               -- por concorrente: promete, prova, vocabulário, fortes e fracos
  pontos_fortes jsonb,
  pontos_fracos jsonb,
  lacunas jsonb,                              -- o que ninguém responde, priorizado por demanda e facilidade
  vocabulario jsonb,
  propostas jsonb,                            -- página ou conteúdo para cada lacuna, com título e esboço
  custo_usd numeric(12, 6) not null default 0,
  tokens int not null default 0,
  erro text,
  criado_em timestamptz not null default now()
);
create index if not exists analises_mercado_criado on public.analises_mercado (criado_em desc);

-- Quem tem papel lê. Concorrentes: dono e operador cadastram pela tela. Coletas e análises: só a Edge Function grava.
do $$
declare t text;
begin
  foreach t in array array['concorrentes', 'coletas_concorrente', 'analises_mercado'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists "le_quem_tem_papel" on public.%I', t);
    execute format('create policy "le_quem_tem_papel" on public.%I for select to authenticated using ((select public.papel_do_usuario()) is not null)', t);
  end loop;
end $$;
grant insert, update on public.concorrentes to authenticated;
drop policy if exists "escreve_dono_operador" on public.concorrentes;
create policy "escreve_dono_operador" on public.concorrentes for all to authenticated
  using ((select public.papel_do_usuario()) in ('dono', 'operador'))
  with check ((select public.papel_do_usuario()) in ('dono', 'operador'));

-- Concorrentes informados pelo Áxel em 15/10/2026.
insert into public.concorrentes (nome, dominio, site) values
  ('Sayerlack', 'sayerlack.com.br', 'https://www.sayerlack.com.br/'),
  ('Farben', 'farben.com.br', 'https://www.farben.com.br/'),
  ('Lechler', 'lechler.eu', 'https://www.lechler.eu/pt/'),
  ('Duvon', 'duvon.com.br', 'https://www.duvon.com.br/'),
  ('WEG Tintas', 'weg.net', 'https://www.weg.net/tintas/'),
  ('Next Coatings', 'nextcoatings.com.br', 'https://nextcoatings.com.br/'),
  ('Liko', 'liko.com.br', 'https://www.liko.com.br/')
on conflict (dominio) do nothing;
