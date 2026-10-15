-- Fase 6, parte A: base da prospecção. Campos de qualificação nas empresas, base de clientes importada,
-- cadências, e-mails (rascunho → aprovado → enviado) e respostas. O envio pelo Resend vem na parte B.
-- Aplicada no Supabase em 15/10/2026.

-- Empresas: relação com a Corquímica, qualificação e o "gancho" (o fato específico que justifica o contato).
alter table public.empresas
  add column if not exists relacao text not null default 'prospect' check (relacao in ('prospect', 'cliente_ativo', 'ex_cliente')),
  add column if not exists ultima_compra date,
  add column if not exists grupo text,               -- grupo do cadastro interno (planilha de clientes)
  add column if not exists cnae text,
  add column if not exists fonte_url text,           -- LGPD: onde a empresa foi encontrada
  add column if not exists coletado_em timestamptz,  -- LGPD: quando
  add column if not exists icp_motivo text,          -- por que o agente deu a nota
  add column if not exists icp_criterios jsonb,      -- pontos por critério
  add column if not exists gancho text,              -- algo verdadeiro e específico da empresa
  add column if not exists gancho_fonte text,
  add column if not exists sem_gancho bool not null default false,
  add column if not exists qualificado_em timestamptz;
-- CNPJ só com dígitos e único: permite reimportar a planilha sem duplicar.
create unique index if not exists empresas_cnpj_unico on public.empresas (cnpj);

-- Base legal para quem já foi cliente.
-- (o texto é livre; a tela oferece as opções)

create table if not exists public.cadencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  contato_id uuid references public.contatos (id) on delete set null,
  tipo text not null check (tipo in ('prospeccao', 'retomada')),
  passo int not null default 0,                       -- último e-mail enviado (0 = nenhum)
  proximo_em timestamptz,                             -- quando o próximo passo vence
  retomadas int not null default 0,                   -- quantas retomadas de 60 dias já houve (máx. 3)
  status text not null default 'ativa' check (status in ('ativa', 'pausada', 'respondeu', 'encerrada', 'suprimida')),
  iniciada_em timestamptz not null default now()
);
create index if not exists cadencias_empresa on public.cadencias (empresa_id);
create index if not exists cadencias_vencidas on public.cadencias (proximo_em) where status = 'ativa';
-- Uma cadência ativa por empresa.
create unique index if not exists cadencias_uma_ativa on public.cadencias (empresa_id) where status in ('ativa', 'pausada');

create table if not exists public.emails (
  id uuid primary key default gen_random_uuid(),       -- também serve de token do link de descadastro
  cadencia_id uuid references public.cadencias (id) on delete set null,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  contato_id uuid references public.contatos (id) on delete set null,
  para text not null,
  passo int not null,                                  -- 1 a 4; 5+ = retomada
  angulo text,                                         -- abordagem usada (vira métrica)
  assunto text not null,
  corpo text not null,                                 -- texto sem assinatura; a assinatura entra no envio
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovado', 'enviado', 'descartado', 'falhou')),
  aprovado_por uuid references public.perfis (id) on delete set null,
  aprovado_em timestamptz,
  enviado_em timestamptz,
  resend_id text,
  eventos jsonb not null default '[]',                 -- entregue, bounce, reclamação... (webhook)
  memorias uuid[],
  erro text,
  criado_em timestamptz not null default now()
);
create index if not exists emails_status on public.emails (status, criado_em desc);
create index if not exists emails_empresa on public.emails (empresa_id);
create index if not exists emails_cadencia on public.emails (cadencia_id);
create index if not exists emails_contato on public.emails (contato_id);
create index if not exists emails_aprovado_por on public.emails (aprovado_por);
create index if not exists cadencias_contato on public.cadencias (contato_id);

create table if not exists public.respostas (
  id uuid primary key default gen_random_uuid(),
  email_id uuid references public.emails (id) on delete set null,
  empresa_id uuid references public.empresas (id) on delete cascade,
  de text not null,
  assunto text,
  texto text not null,
  recebido_em timestamptz not null default now(),
  classificacao text check (classificacao in ('interessado', 'pergunta', 'nao_agora', 'nao', 'descadastro', 'automatica')),
  rascunho text,                                       -- resposta sugerida pelo agente
  status text not null default 'nova' check (status in ('nova', 'aprovada', 'enviada', 'descartada')),
  resend_id text unique
);
create index if not exists respostas_status on public.respostas (status, recebido_em desc);
create index if not exists respostas_email on public.respostas (email_id);
create index if not exists respostas_empresa on public.respostas (empresa_id);

-- Regras. Leitura para quem tem papel. Na tela, dono e operador só podem editar, aprovar e descartar rascunhos;
-- "enviado" e "falhou" só o servidor marca.
do $$
declare t text;
begin
  foreach t in array array['cadencias', 'emails', 'respostas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists "le_quem_tem_papel" on public.%I', t);
    execute format('create policy "le_quem_tem_papel" on public.%I for select to authenticated using ((select public.papel_do_usuario()) is not null)', t);
  end loop;
end $$;
grant update (assunto, corpo, status, aprovado_por, aprovado_em) on public.emails to authenticated;
drop policy if exists "aprova_rascunho" on public.emails;
create policy "aprova_rascunho" on public.emails for update to authenticated
  using ((select public.papel_do_usuario()) in ('dono', 'operador') and status in ('rascunho', 'aprovado'))
  with check ((select public.papel_do_usuario()) in ('dono', 'operador') and status in ('rascunho', 'aprovado', 'descartado'));
grant update (rascunho, status) on public.respostas to authenticated;
drop policy if exists "aprova_resposta" on public.respostas;
create policy "aprova_resposta" on public.respostas for update to authenticated
  using ((select public.papel_do_usuario()) in ('dono', 'operador') and status in ('nova', 'aprovada'))
  with check ((select public.papel_do_usuario()) in ('dono', 'operador') and status in ('nova', 'aprovada', 'descartada'));
grant update (status) on public.cadencias to authenticated;
drop policy if exists "pausa_cadencia" on public.cadencias;
create policy "pausa_cadencia" on public.cadencias for update to authenticated
  using ((select public.papel_do_usuario()) in ('dono', 'operador'))
  with check ((select public.papel_do_usuario()) in ('dono', 'operador') and status in ('ativa', 'pausada', 'encerrada'));

-- Configuração do e-mail e da qualificação (editável pelo dono).
insert into public.config (chave, valor) values
  ('email_remetente', '"Fernando - Corquímica <fernando@comercial.corquimica.com.br>"'),
  ('email_copia_respostas', '"fernando@corquimica.com.br"'),
  ('email_assinatura', to_jsonb(E'Fernando Gutierrez - Executivo Comercial\n\nCorquímica Ind. e Com Ltda\ncorquimica.com.br\nAv Walter Klein, 1442 – Lago Azul\nEstância Velha - RS CEP: 93.612-280'::text)),
  ('email_teto_dia', '50'),
  ('email_aquecimento', '{"inicio": 10, "crescimento": 0.2, "primeiro_envio": null}'),
  ('icp', '{
    "produtos_foco": ["Verniz UV Base", "Verniz UV Top Coat", "Lacas", "Corantes UV", "Resinas 3D", "Solventes"],
    "segmentos": ["Moda e calçados", "Moveleiro", "Automotivo", "Cosméticos", "Linha branca", "Plástico em geral"],
    "ufs_prioritarias": ["RS", "SC", "PR", "SP", "MG", "RJ"],
    "decisores": ["Dono", "Produção (gerente, supervisor, encarregado)", "Compras", "Financeiro"],
    "gatilhos": ["problema de qualidade no acabamento", "homologação de novo fornecedor"],
    "criterios": [
      {"id": "setor", "pontos": 30, "descricao": "Atua em um dos segmentos alvo"},
      {"id": "processo", "pontos": 25, "descricao": "Pinta, envernizou ou dá acabamento em peças plásticas, metálicas, de madeira ou impressas em 3D"},
      {"id": "regiao", "pontos": 15, "descricao": "Fica em UF prioritária (RS, SC, PR, SP, MG, RJ); outras UFs valem 5"},
      {"id": "porte", "pontos": 15, "descricao": "Indiferente: toda empresa industrial ganha os 15 pontos; revenda ou serviço sem produção, 0"},
      {"id": "momento", "pontos": 15, "descricao": "Sinal de momento: lançamento, expansão, nova linha, vaga em pintura/acabamento, feira recente"}
    ],
    "nota_minima": 50
  }')
on conflict (chave) do nothing;
