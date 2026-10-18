-- Ciclo autônomo (19/10/2026, pedido do Áxel): a plataforma questiona o próprio desempenho, propõe ações,
-- mede o resultado e aprende sozinha, sem depender de alguém abrir o Conselho ou gravar memória.
--   1. Descarte com motivo: ao descartar um rascunho, o dono diz se a EMPRESA não serve (sai de todas as rotinas)
--      ou se o TEXTO precisa ser refeito (o robô reescreve com o motivo). O mesmo para propostas de conteúdo.
--   2. indicadores(): os números que a sentinela compara semana a semana e que medem cada ação.
--   3. acoes_propostas: o que o Conselho propõe, em tipos fechados que a plataforma sabe aplicar sozinha
--      depois da aprovação do dono (nota de segmento, nota mínima, regra de qualificação, regra de redação,
--      conteúdo, tarefa). Cada ação guarda o número de antes e é medida depois.
--   4. revisoes: registro de cada revisão semanal (sinais, sessão aberta ou por que pulou).
-- Orçamento: a reflexão tem teto mensal próprio (config.teto_reflexao_mensal_usd) e só roda com o dia abaixo
-- da metade do teto diário; a rotina (e-mails, respostas) sempre vem primeiro.

-- ---------- 1. descarte com motivo ----------
alter table public.emails
  add column if not exists descarte_tipo text check (descarte_tipo in ('empresa', 'refazer')),
  add column if not exists descarte_motivo text,
  add column if not exists descartado_em timestamptz,
  add column if not exists refeito_de uuid references public.emails(id) on delete set null;
create index if not exists emails_refazer on public.emails (descartado_em desc) where descarte_tipo = 'refazer';
create index if not exists emails_refeito_de on public.emails (refeito_de) where refeito_de is not null;

alter table public.empresas
  add column if not exists descarte_motivo text,
  add column if not exists descartada_em timestamptz;

alter table public.propostas_conteudo
  add column if not exists descarte_motivo text,
  add column if not exists ajustes jsonb not null default '[]';   -- [{em, motivo}] pedidos de "refazer" do dono

-- Descarta um rascunho de e-mail com o motivo.
--   empresa → a empresa sai de todas as rotinas (descartada, cadências suprimidas, negócio perdido)
--   refazer → o rascunho sai da fila e o robô escreve outro levando o motivo em conta
create or replace function public.descartar_email(p_email uuid, p_tipo text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare m public.emails; mot text := left(trim(coalesce(p_motivo, '')), 500);
begin
  if (select public.papel_do_usuario()) is distinct from 'dono' and (select public.papel_do_usuario()) is distinct from 'operador' then
    raise exception 'Seu papel não pode descartar rascunhos.';
  end if;
  if p_tipo not in ('empresa', 'refazer') then raise exception 'Escolha se a empresa não serve ou se o e-mail deve ser refeito.'; end if;
  if length(mot) < 3 then raise exception 'Escreva brevemente o motivo.'; end if;
  select * into m from public.emails where id = p_email for update;
  if not found or m.status not in ('rascunho', 'aprovado') then raise exception 'Rascunho não encontrado ou já enviado.'; end if;

  update public.emails set status = 'descartado', descarte_tipo = p_tipo, descarte_motivo = mot, descartado_em = now() where id = p_email;
  if p_tipo = 'empresa' then
    update public.empresas set status = 'descartada', descarte_motivo = mot, descartada_em = now() where id = m.empresa_id;
    update public.emails set status = 'descartado', erro = 'Empresa descartada pelo dono.', descartado_em = now()
      where empresa_id = m.empresa_id and status in ('rascunho', 'aprovado') and id <> p_email;
    update public.cadencias set status = 'suprimida', motivo_fim = 'empresa descartada pelo dono' where empresa_id = m.empresa_id and status in ('ativa', 'pausada');
    update public.negocios set etapa = 'perdido', motivo_perda = left('Descartada pelo dono: ' || mot, 500) where empresa_id = m.empresa_id and etapa not in ('ganho', 'perdido');
  end if;
  insert into public.interacoes (empresa_id, contato_id, tipo, direcao, assunto, conteudo, agente_id)
  values (m.empresa_id, m.contato_id, 'email', 'interna',
          case when p_tipo = 'empresa' then 'Empresa descartada pelo dono' else 'Rascunho reprovado: refazer' end, mot, 'dono');
  return jsonb_build_object('email_id', m.id, 'empresa_id', m.empresa_id, 'tipo', p_tipo);
end $$;
revoke all on function public.descartar_email(uuid, text, text) from public, anon;
grant execute on function public.descartar_email(uuid, text, text) to authenticated;

-- Descarta uma proposta de conteúdo (tema não serve) ou pede para refazer o rascunho com o motivo.
create or replace function public.descartar_proposta(p_id uuid, p_tipo text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p public.propostas_conteudo; mot text := left(trim(coalesce(p_motivo, '')), 500);
begin
  if (select public.papel_do_usuario()) is distinct from 'dono' and (select public.papel_do_usuario()) is distinct from 'operador' then
    raise exception 'Seu papel não pode alterar propostas.';
  end if;
  if p_tipo not in ('tema', 'refazer') then raise exception 'Escolha se o tema não serve ou se o rascunho deve ser refeito.'; end if;
  if length(mot) < 3 then raise exception 'Escreva brevemente o motivo.'; end if;
  select * into p from public.propostas_conteudo where id = p_id for update;
  if not found or p.status in ('publicada', 'descartada') then raise exception 'Proposta não encontrada ou já fechada.'; end if;
  if p_tipo = 'tema' then
    update public.propostas_conteudo set status = 'descartada', descarte_motivo = mot, atualizado_em = now() where id = p_id;
  else
    update public.propostas_conteudo set ajustes = ajustes || jsonb_build_array(jsonb_build_object('em', now(), 'motivo', mot)),
      status = case when status = 'aprovada' then 'rascunho' else status end, atualizado_em = now() where id = p_id;
  end if;
  return jsonb_build_object('id', p_id, 'tipo', p_tipo);
end $$;
revoke all on function public.descartar_proposta(uuid, text, text) from public, anon;
grant execute on function public.descartar_proposta(uuid, text, text) to authenticated;

-- ---------- 2. indicadores ----------
-- Números de uma janela (p_dias até p_ate). Cada um: valor, amostra, o que é melhor (maior/menor) e a descrição.
-- A sentinela compara a janela atual com a anterior; cada ação aprovada guarda o valor de antes e é medida depois.
create or replace function public.indicadores(p_dias int default 28, p_ate timestamptz default now())
returns jsonb language sql stable security definer set search_path = ''
as $$
  with j as (select p_ate - make_interval(days => p_dias) de, p_ate ate),
  env as (select m.* from public.emails m, j where m.enviado_em > j.de and m.enviado_em <= j.ate),
  resp as (select r.* from public.respostas r, j where r.recebido_em > j.de and r.recebido_em <= j.ate and coalesce(r.classificacao, '') <> 'automatica'),
  -- descarte feito por pessoa: com motivo (novo) ou sem erro gravado (antes do motivo existir)
  desc_ as (select m.* from public.emails m, j where m.status = 'descartado' and (m.descarte_tipo is not null or m.erro is null)
            and coalesce(m.descartado_em, m.criado_em) > j.de and coalesce(m.descartado_em, m.criado_em) <= j.ate),
  apr as (select m.* from public.emails m, j where m.aprovado_em > j.de and m.aprovado_em <= j.ate),
  qual as (select e.* from public.empresas e, j where e.relacao = 'prospect' and e.qualificado_em > j.de and e.qualificado_em <= j.ate),
  vis as (select v.* from public.visitas v, j where v.caminho ~ '/$' and v.criado_em > j.de and v.criado_em <= j.ate),
  nm as (select (valor ->> 'nota_minima')::int n from public.config where chave = 'icp'),
  n as (
    select
      (select count(*) from env) env,
      (select count(*) from resp) resp,
      (select count(*) from resp where classificacao in ('interessado', 'pergunta')) interesse,
      (select count(*) from env m where jsonb_typeof(m.eventos) = 'array' and exists (select 1 from jsonb_array_elements(m.eventos) e where e->>'tipo' = 'bounced')) bounce,
      (select count(*) from desc_) descartes,
      (select count(*) from desc_ where descarte_tipo = 'empresa') descartes_empresa,
      (select count(*) from apr) aprovados,
      (select count(*) from qual) qualificadas,
      (select count(*) from qual, nm where qual.icp_score >= nm.n and not coalesce(qual.sem_gancho, false)) qualificadas_boas,
      (select count(*) from public.empresas e, j where e.descartada_em > j.de and e.descartada_em <= j.ate) empresas_descartadas,
      (select count(*) from vis) visitas,
      (select count(*) from vis where canal = 'ia') visitas_ia,
      (select count(*) from vis where canal = 'busca') visitas_busca,
      (select count(*) from public.leads l, j where l.created_at > j.de and l.created_at <= j.ate) leads,
      (select count(*) from public.interacoes i, j where i.assunto = 'Telefone obtido' and i.ocorrido_em > j.de and i.ocorrido_em <= j.ate) telefones,
      (select count(*) from public.propostas_conteudo p, j where p.status in ('proposta', 'rascunho') and p.criado_em < j.ate - interval '14 days') conteudo_parado,
      (select count(*) from public.coletas_concorrente c, j where c.mudou and c.coletado_em > j.de and c.coletado_em <= j.ate) concorrente_mudou
  )
  select jsonb_build_object(
    'janela_dias', p_dias, 'ate', p_ate,
    'resposta', jsonb_build_object('valor', round(n.resp::numeric / nullif(n.env, 0), 4), 'amostra', n.env, 'melhor', 'maior', 'descricao', 'respostas (sem automáticas) ÷ e-mails enviados'),
    'interesse', jsonb_build_object('valor', round(n.interesse::numeric / nullif(n.env, 0), 4), 'amostra', n.env, 'melhor', 'maior', 'descricao', 'respostas interessado ou pergunta ÷ e-mails enviados'),
    'bounce', jsonb_build_object('valor', round(n.bounce::numeric / nullif(n.env, 0), 4), 'amostra', n.env, 'melhor', 'menor', 'descricao', 'e-mails que voltaram ÷ enviados'),
    'descarte_rascunhos', jsonb_build_object('valor', round(n.descartes::numeric / nullif(n.descartes + n.aprovados, 0), 4), 'amostra', n.descartes + n.aprovados, 'melhor', 'menor', 'descricao', 'rascunhos descartados pelo dono ÷ (descartados + aprovados)'),
    'descarte_por_empresa', jsonb_build_object('valor', round(n.descartes_empresa::numeric / nullif(n.descartes + n.aprovados, 0), 4), 'amostra', n.descartes + n.aprovados, 'melhor', 'menor', 'descricao', 'rascunhos descartados porque a empresa não serve ÷ (descartados + aprovados)'),
    'entrada_qualificada', jsonb_build_object('valor', round(n.qualificadas_boas::numeric / nullif(n.qualificadas, 0), 4), 'amostra', n.qualificadas, 'melhor', 'maior', 'descricao', 'prospects qualificados com nota ≥ mínima e com gancho ÷ prospects qualificados'),
    'empresas_descartadas', jsonb_build_object('valor', n.empresas_descartadas, 'amostra', n.qualificadas, 'melhor', 'menor', 'descricao', 'empresas descartadas pelo dono na janela'),
    'visitas', jsonb_build_object('valor', n.visitas, 'amostra', n.visitas, 'melhor', 'maior', 'descricao', 'visitas em páginas do site'),
    'visitas_ia', jsonb_build_object('valor', n.visitas_ia, 'amostra', n.visitas, 'melhor', 'maior', 'descricao', 'visitas vindas de assistentes de IA'),
    'visitas_busca', jsonb_build_object('valor', n.visitas_busca, 'amostra', n.visitas, 'melhor', 'maior', 'descricao', 'visitas vindas de buscadores'),
    'leads_site', jsonb_build_object('valor', n.leads, 'amostra', n.visitas, 'melhor', 'maior', 'descricao', 'contatos pelo formulário do site'),
    'telefones', jsonb_build_object('valor', n.telefones, 'amostra', n.env, 'melhor', 'maior', 'descricao', 'telefones de responsáveis obtidos'),
    'conteudo_parado', jsonb_build_object('valor', n.conteudo_parado, 'amostra', n.conteudo_parado, 'melhor', 'menor', 'descricao', 'propostas de conteúdo abertas há mais de 14 dias (no fim da janela)'),
    'concorrente_mudou', jsonb_build_object('valor', n.concorrente_mudou, 'amostra', n.concorrente_mudou, 'melhor', 'maior', 'descricao', 'páginas de concorrentes que mudaram na janela')
  ) from n
$$;
revoke all on function public.indicadores(int, timestamptz) from public, anon, authenticated;
grant execute on function public.indicadores(int, timestamptz) to service_role;

-- ---------- 3. ações propostas ----------
create table if not exists public.acoes_propostas (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid references public.conselho_sessoes(id) on delete set null,
  tipo text not null check (tipo in ('icp_nota_segmento', 'icp_nota_minima', 'regra_qualificacao', 'regra_redacao', 'conteudo', 'tarefa')),
  titulo text not null,
  parametros jsonb not null default '{}',
  por_que text,
  metrica text,                            -- chave de indicadores() que a ação deve mover
  meta text,
  medir_em_dias int not null default 28 check (medir_em_dias between 14 and 90),
  status text not null default 'proposta' check (status in ('proposta', 'aplicada', 'recusada', 'medida', 'erro')),
  motivo_recusa text,
  erro text,
  valor_antes numeric, amostra_antes int,
  valor_depois numeric, amostra_depois int,
  resultado text,
  aprendizado_id uuid,
  medir_em date,
  adiamentos int not null default 0,
  decidido_por uuid, decidido_em timestamptz, aplicada_em timestamptz, medida_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists acoes_status on public.acoes_propostas (status, criado_em desc);
alter table public.acoes_propostas enable row level security;
revoke all on public.acoes_propostas from anon, authenticated;
grant select on public.acoes_propostas to authenticated;
drop policy if exists "le_quem_tem_papel" on public.acoes_propostas;
create policy "le_quem_tem_papel" on public.acoes_propostas for select to authenticated using ((select public.papel_do_usuario()) is not null);

-- Regras aprendidas que entram nas instruções dos robôs (só por ação aprovada).
insert into public.config (chave, valor) values ('redacao_regras', '[]'), ('teto_reflexao_mensal_usd', '6')
on conflict (chave) do nothing;
update public.config set valor = valor || '{"regras_extras": []}'::jsonb where chave = 'icp' and not valor ? 'regras_extras';

-- Aplica uma ação aprovada. Cada tipo muda uma coisa só e guarda o número de antes para a medição.
create or replace function public.aplicar_acao(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.acoes_propostas; icp jsonb; segs jsonb; ind jsonb; txt text; nota int;
begin
  select * into a from public.acoes_propostas where id = p_id for update;
  select valor into icp from public.config where chave = 'icp';
  txt := left(trim(coalesce(a.parametros ->> 'texto', '')), 400);
  if a.tipo = 'icp_nota_segmento' then
    nota := (a.parametros ->> 'nota')::int;
    if nota is null or nota < 0 or nota > 100 then raise exception 'Nota do segmento fora de 0 a 100.'; end if;
    if not exists (select 1 from jsonb_array_elements(icp -> 'segmentos') s where s ->> 'id' = a.parametros ->> 'segmento') then
      raise exception 'Segmento "%" não existe.', a.parametros ->> 'segmento';
    end if;
    select jsonb_agg(case when s ->> 'id' = a.parametros ->> 'segmento' then s || jsonb_build_object('nota', nota) else s end) into segs
      from jsonb_array_elements(icp -> 'segmentos') s;
    update public.config set valor = jsonb_set(valor, '{segmentos}', segs) where chave = 'icp';
    -- recalcula a nota das empresas do segmento (o gatilho lê a tabela nova)
    update public.empresas set segmento_icp = segmento_icp where segmento_icp = a.parametros ->> 'segmento';
  elsif a.tipo = 'icp_nota_minima' then
    nota := (a.parametros ->> 'nota')::int;
    if nota is null or nota < 30 or nota > 90 then raise exception 'Nota mínima fora de 30 a 90.'; end if;
    update public.config set valor = jsonb_set(valor, '{nota_minima}', to_jsonb(nota)) where chave = 'icp';
  elsif a.tipo = 'regra_qualificacao' then
    if length(txt) < 10 then raise exception 'Regra de qualificação vazia.'; end if;
    if jsonb_array_length(coalesce(icp -> 'regras_extras', '[]')) >= 15 then raise exception 'Já há 15 regras de qualificação; recuse uma antes.'; end if;
    update public.config set valor = jsonb_set(valor, '{regras_extras}', coalesce(valor -> 'regras_extras', '[]') || jsonb_build_array(jsonb_build_object('texto', txt, 'acao_id', a.id, 'em', current_date))) where chave = 'icp';
  elsif a.tipo = 'regra_redacao' then
    if length(txt) < 10 then raise exception 'Regra de redação vazia.'; end if;
    if (select jsonb_array_length(valor) from public.config where chave = 'redacao_regras') >= 15 then raise exception 'Já há 15 regras de redação; recuse uma antes.'; end if;
    update public.config set valor = valor || jsonb_build_array(jsonb_build_object('texto', txt, 'acao_id', a.id, 'em', current_date)) where chave = 'redacao_regras';
  elsif a.tipo = 'conteudo' then
    if length(coalesce(a.parametros ->> 'titulo', '')) < 5 then raise exception 'Conteúdo sem título.'; end if;
    insert into public.propostas_conteudo (titulo, tipo, url_sugerida, por_que, esboco, lacuna)
    values (left(a.parametros ->> 'titulo', 200), 'pagina', left(a.parametros ->> 'url_sugerida', 200), coalesce(a.por_que, a.parametros ->> 'por_que'),
            case when jsonb_typeof(a.parametros -> 'esboco') = 'array' then a.parametros -> 'esboco' else '[]'::jsonb end, 'Proposta pelo Conselho: ' || a.titulo);
  elsif a.tipo = 'tarefa' then
    insert into public.tarefas (titulo, descricao, vence_em, responsavel)
    values (left(coalesce(a.parametros ->> 'titulo', a.titulo), 200), coalesce(a.parametros ->> 'descricao', a.por_que), current_date + 7, a.decidido_por);
  end if;
  ind := public.indicadores(28) -> a.metrica;
  update public.acoes_propostas set status = 'aplicada', aplicada_em = now(), erro = null,
    valor_antes = (ind ->> 'valor')::numeric, amostra_antes = (ind ->> 'amostra')::int,
    medir_em = current_date + medir_em_dias
  where id = p_id;
end $$;
revoke all on function public.aplicar_acao(uuid) from public, anon, authenticated;

-- O dono aprova (a ação é aplicada na hora) ou recusa com o motivo (o próximo Conselho lê e não repete).
create or replace function public.decidir_acao(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare a public.acoes_propostas;
begin
  if (select public.papel_do_usuario()) is distinct from 'dono' then raise exception 'Só o dono decide as ações propostas.'; end if;
  select * into a from public.acoes_propostas where id = p_id for update;
  if not found or a.status <> 'proposta' then raise exception 'Ação não encontrada ou já decidida.'; end if;
  if not p_aprovar then
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva brevemente por que recusa (o Conselho lê e não repete).'; end if;
    update public.acoes_propostas set status = 'recusada', motivo_recusa = left(trim(p_motivo), 500), decidido_por = (select auth.uid()), decidido_em = now() where id = p_id;
    return jsonb_build_object('status', 'recusada');
  end if;
  update public.acoes_propostas set decidido_por = (select auth.uid()), decidido_em = now() where id = p_id;
  begin
    perform public.aplicar_acao(p_id);
  exception when others then
    update public.acoes_propostas set status = 'erro', erro = left(sqlerrm, 500) where id = p_id;
    return jsonb_build_object('status', 'erro', 'erro', sqlerrm);
  end;
  return jsonb_build_object('status', 'aplicada');
end $$;
revoke all on function public.decidir_acao(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_acao(uuid, boolean, text) to authenticated;

-- Mede as ações aplicadas que chegaram na data. Amostra pequena: adia 14 dias (até 2 vezes) antes de fechar.
-- Devolve as medidas agora, para o worker gravar o aprendizado na memória.
create or replace function public.medir_acoes()
returns setof public.acoes_propostas language plpgsql security definer set search_path = ''
as $$
declare a public.acoes_propostas; ind jsonb; dias int; minimo int;
begin
  for a in select * from public.acoes_propostas where status = 'aplicada' and medir_em <= current_date for update skip locked loop
    if a.metrica is null then
      update public.acoes_propostas set status = 'medida', medida_em = now(), resultado = 'Sem métrica definida: não dá para medir.' where id = a.id;
      continue;
    end if;
    dias := least(greatest(current_date - a.aplicada_em::date, 14), 90);
    ind := public.indicadores(dias) -> a.metrica;
    minimo := case when a.metrica in ('resposta', 'interesse', 'bounce', 'telefones') then 30 when a.metrica in ('descarte_rascunhos', 'descarte_por_empresa', 'entrada_qualificada', 'empresas_descartadas') then 10 else 1 end;
    if coalesce((ind ->> 'amostra')::int, 0) < minimo and a.adiamentos < 2 then
      update public.acoes_propostas set medir_em = current_date + 14, adiamentos = adiamentos + 1 where id = a.id;
      continue;
    end if;
    update public.acoes_propostas set status = 'medida', medida_em = now(),
      valor_depois = (ind ->> 'valor')::numeric, amostra_depois = (ind ->> 'amostra')::int,
      resultado = case
        when (ind ->> 'valor') is null or a.valor_antes is null or coalesce((ind ->> 'amostra')::int, 0) < minimo then 'inconclusivo (amostra pequena)'
        when (ind ->> 'valor')::numeric = a.valor_antes then 'igual'
        when ((ind ->> 'valor')::numeric > a.valor_antes) = ((ind ->> 'melhor') = 'maior') then 'melhorou'
        else 'piorou' end
    where id = a.id returning * into a;
    return next a;
  end loop;
end $$;
revoke all on function public.medir_acoes() from public, anon, authenticated;
grant execute on function public.medir_acoes() to service_role;

-- ---------- 4. revisões semanais ----------
create table if not exists public.revisoes (
  id uuid primary key default gen_random_uuid(),
  sinais jsonb not null default '[]',
  sessao_id uuid references public.conselho_sessoes(id) on delete set null,
  pulou_motivo text,
  aprendizados jsonb not null default '[]',   -- o que entrou na memória nesta revisão (descartes e padrões)
  padroes_gravados boolean not null default false,
  custo_usd numeric not null default 0,
  criado_em timestamptz not null default now()
);
alter table public.revisoes enable row level security;
revoke all on public.revisoes from anon, authenticated;
grant select on public.revisoes to authenticated;
drop policy if exists "le_quem_tem_papel" on public.revisoes;
create policy "le_quem_tem_papel" on public.revisoes for select to authenticated using ((select public.papel_do_usuario()) is not null);

-- Gasto da reflexão no mês (Conselho, aprendizado com descartes e consolidação da memória).
create or replace function public.gasto_reflexao_mes()
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(custo_usd), 0) from public.execucoes_agente
  where criado_em > now() - interval '32 days'
    and date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', now() at time zone 'America/Sao_Paulo')
    and (papel like 'conselho_%' or papel in ('reflexao_descartes', 'memoria_consolidar'))
$$;
revoke all on function public.gasto_reflexao_mes() from public, anon, authenticated;
grant execute on function public.gasto_reflexao_mes() to service_role;

-- Taxa de resposta por segmento e por passo (janela de 28 dias), base dos padrões gravados na memória.
create or replace function public.resposta_por_grupo(p_dias int default 28)
returns table (grupo text, valor text, enviados bigint, respostas bigint) language sql stable security definer set search_path = ''
as $$
  with env as (
    select m.id, m.passo, coalesce(e.segmento_icp, '(sem segmento)') seg from public.emails m join public.empresas e on e.id = m.empresa_id
    where m.enviado_em > now() - make_interval(days => p_dias)
  ),
  r as (select distinct email_id from public.respostas where email_id is not null and coalesce(classificacao, '') <> 'automatica')
  select 'segmento', seg, count(*), count(r.email_id) from env left join r on r.email_id = env.id group by seg
  union all
  select 'passo', passo::text, count(*), count(r.email_id) from env left join r on r.email_id = env.id group by passo
$$;
revoke all on function public.resposta_por_grupo(int) from public, anon, authenticated;
grant execute on function public.resposta_por_grupo(int) to service_role;

-- ---------- dossiê do Conselho: indicadores, descartes do dono, entrada de empresas, regras e ações ----------
do $$
declare d text; novo text;
begin
  d := pg_get_functiondef('public.dossie_conselho()'::regprocedure);
  if position('''indicadores''' in d) > 0 then return; end if;   -- já aplicado
  novo := $blk$'indicadores', jsonb_build_object(
    'fonte', 'indicadores(28) agora e na janela de 28 dias anterior (valor, amostra, o que é melhor)',
    'atual', public.indicadores(28),
    'anterior', public.indicadores(28, now() - interval '28 days')),
  'descartes_do_dono', jsonb_build_object(
    'fonte', 'motivos escritos pelo dono ao descartar (últimos 45 dias): e-mails (empresa não serve ou refazer), empresas e conteúdo',
    'emails', coalesce((select jsonb_agg(jsonb_build_object('tipo', m.descarte_tipo, 'motivo', m.descarte_motivo, 'segmento', e.segmento_icp, 'passo', m.passo, 'quando', m.descartado_em::date) order by m.descartado_em desc)
      from (select * from public.emails where descarte_tipo is not null and descartado_em > now() - interval '45 days' order by descartado_em desc limit 20) m join public.empresas e on e.id = m.empresa_id), '[]'),
    'conteudo', coalesce((select jsonb_agg(jsonb_build_object('titulo', titulo, 'motivo', coalesce(descarte_motivo, ajustes -> -1 ->> 'motivo'), 'tipo', case when status = 'descartada' then 'tema' else 'refazer' end))
      from public.propostas_conteudo where (descarte_motivo is not null or jsonb_array_length(ajustes) > 0) and atualizado_em > now() - interval '45 days'), '[]')),
  'entrada_empresas', jsonb_build_object(
    'fonte', 'empresas criadas nos últimos 30 dias por origem: qualificadas, com nota ≥ mínima e gancho, descartadas pelo dono',
    'por_origem', coalesce((select jsonb_agg(jsonb_build_object('origem', o, 'novas', n, 'qualificadas', q, 'boas', b, 'descartadas_pelo_dono', d) order by n desc) from (
      select split_part(origem, ':', 1) o, count(*) n, count(qualificado_em) q,
             count(*) filter (where icp_score >= (select (valor ->> 'nota_minima')::int from public.config where chave = 'icp') and not coalesce(sem_gancho, false)) b,
             count(descartada_em) d
      from public.empresas where criado_em > now() - interval '30 days' group by 1) x), '[]')),
  'regras_atuais', jsonb_build_object(
    'fonte', 'config.icp (segmentos, nota mínima, regras extras de qualificação) e config.redacao_regras',
    'nota_minima', (select valor -> 'nota_minima' from public.config where chave = 'icp'),
    'segmentos', (select jsonb_agg(jsonb_build_object('id', s ->> 'id', 'nota', s -> 'nota')) from public.config c, jsonb_array_elements(c.valor -> 'segmentos') s where c.chave = 'icp'),
    'regras_qualificacao', (select valor -> 'regras_extras' from public.config where chave = 'icp'),
    'regras_redacao', (select valor from public.config where chave = 'redacao_regras')),
  'acoes_recentes', jsonb_build_object(
    'fonte', 'acoes_propostas (últimas 15): o que já foi proposto, o que o dono recusou e por quê, e o resultado medido',
    'itens', coalesce((select jsonb_agg(jsonb_build_object('titulo', titulo, 'tipo', tipo, 'status', status, 'motivo_recusa', motivo_recusa, 'metrica', metrica, 'antes', valor_antes, 'depois', valor_depois, 'resultado', resultado, 'quando', criado_em::date) order by criado_em desc)
      from (select * from public.acoes_propostas order by criado_em desc limit 15) x), '[]')),
  'memoria', jsonb_build_object($blk$;
  d := replace(d, '''memoria'', jsonb_build_object(', novo);
  if position('''indicadores''' in d) = 0 then raise exception 'troca no dossiê não bateu'; end if;
  execute d;
end $$;
revoke all on function public.dossie_conselho() from public, anon, authenticated;
grant execute on function public.dossie_conselho() to service_role;

-- Painel da Operação: ações esperando o dono.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.painel_operacao(int)'::regprocedure);
  if position('''acoes''' in d) > 0 then return; end if;
  d := replace(d, '''conteudo'', (select count(*) from public.propostas_conteudo where status = ''rascunho'')',
                  '''conteudo'', (select count(*) from public.propostas_conteudo where status = ''rascunho''),' || chr(10) ||
                  '      ''acoes'', (select count(*) from public.acoes_propostas where status = ''proposta'')');
  if position('''acoes''' in d) = 0 then raise exception 'troca no painel não bateu'; end if;
  execute d;
end $$;
revoke all on function public.painel_operacao(int) from public, anon;
grant execute on function public.painel_operacao(int) to authenticated;

-- ---------- correção da fila (achada nesta revisão) ----------
-- O índice que evita job duplicado valia também para o job RODANDO: a continuação que um job põe na fila com a
-- mesma chave (analise_avancar, envio_preparar, envio_enviar, conselho_avancar) era descartada sem erro, e a
-- cadeia parava no 1º passo. Agora a trava vale só entre jobs ESPERANDO: no máximo um pendente por chave.
drop index if exists public.jobs_chave_aberta;
create unique index if not exists jobs_chave_pendente on public.jobs (chave) where chave is not null and status = 'pendente';
create or replace function public.enfileirar(p_tipo text, p_payload jsonb default '{}', p_prioridade int default 5, p_chave text default null, p_rodar_em timestamptz default now(), p_origem text default 'rotina')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare novo uuid;
begin
  if p_origem = 'rotina' and (select valor from public.config where chave = 'sistema_ativo') is distinct from 'true'::jsonb then return null; end if;
  insert into public.jobs (tipo, payload, prioridade, chave, rodar_em, origem)
  values (p_tipo, coalesce(p_payload, '{}'), p_prioridade, p_chave, coalesce(p_rodar_em, now()), p_origem)
  on conflict (chave) where chave is not null and status = 'pendente' do nothing
  returning id into novo;
  return novo;
end $$;
revoke all on function public.enfileirar(text, jsonb, integer, text, timestamp with time zone, text) from public, anon, authenticated;
grant execute on function public.enfileirar(text, jsonb, integer, text, timestamp with time zone, text) to service_role;

-- ---------- ajuste do dossiê (achado na 1ª revisão automática, 18/10) ----------
-- entrada_empresas contava como "boa" empresa que nunca foi qualificada (base de clientes: 88 "boas" para 1 qualificada)
-- e usava 30 dias, enquanto indicadores() usa 28. O Conselho apontou a divergência; agora os dois batem.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.dossie_conselho()'::regprocedure);
  if position('count(*) filter (where qualificado_em is not null and icp_score' in d) > 0 then return; end if;
  d := replace(d, 'count(*) filter (where icp_score >= (select (valor ->> ''nota_minima'')::int from public.config where chave = ''icp'') and not coalesce(sem_gancho, false)) b,',
                  'count(*) filter (where qualificado_em is not null and icp_score >= (select (valor ->> ''nota_minima'')::int from public.config where chave = ''icp'') and not coalesce(sem_gancho, false)) b,');
  d := replace(d, 'from public.empresas where criado_em > now() - interval ''30 days'' group by 1) x)', 'from public.empresas where criado_em > now() - interval ''28 days'' group by 1) x)');
  d := replace(d, 'empresas criadas nos últimos 30 dias por origem: qualificadas, com nota ≥ mínima e gancho, descartadas pelo dono',
                  'empresas criadas nos últimos 28 dias por origem (mesma janela de indicadores): novas, qualificadas, qualificadas com nota ≥ mínima e gancho (boas), descartadas pelo dono');
  if position('qualificado_em is not null and icp_score' in d) = 0 or position('últimos 28 dias por origem' in d) = 0 then raise exception 'ajuste do dossiê não bateu'; end if;
  execute d;
end $$;
revoke all on function public.dossie_conselho() from public, anon, authenticated;
grant execute on function public.dossie_conselho() to service_role;
