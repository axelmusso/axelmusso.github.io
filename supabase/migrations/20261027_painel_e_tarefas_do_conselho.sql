-- Pedido do dono (27/10/2026): "como eu sei as atividades que estão ocorrendo, em andamento, pendentes?"
--   1) Tarefa criada pelo Conselho fica ligada à ação. Ao concluir, o dono escreve o resultado (ou marca "não feita");
--      o resultado aparece na ação e entra no dossiê do próximo Conselho. Ação com tarefa não feita não é medida
--      como se tivesse acontecido.
--   2) painel_agora(): o que os robôs estão fazendo, o que espera o dono, o que foi feito hoje e as próximas medições.

alter table public.tarefas
  add column if not exists acao_id uuid references public.acoes_propostas(id) on delete set null,
  add column if not exists resultado text,
  add column if not exists nao_feita boolean not null default false;
alter table public.acoes_propostas add column if not exists tarefa_resultado text;
alter table public.acoes_propostas drop constraint if exists acoes_propostas_status_check;
alter table public.acoes_propostas add constraint acoes_propostas_status_check
  check (status in ('proposta', 'aplicada', 'recusada', 'medida', 'erro', 'nao_feita'));

-- A tarefa do Conselho nasce ligada à ação.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.aplicar_acao(uuid)'::regprocedure);
  if position('acao_id' in d) > 0 then return; end if;
  d := replace(d,
    $a$insert into public.tarefas (titulo, descricao, vence_em, responsavel)
    values (left(coalesce(a.parametros ->> 'titulo', a.titulo), 200), coalesce(a.parametros ->> 'descricao', a.por_que), current_date + 7, a.decidido_por);$a$,
    $b$insert into public.tarefas (titulo, descricao, vence_em, responsavel, acao_id, tipo)
    values (left(coalesce(a.parametros ->> 'titulo', a.titulo), 200), coalesce(a.parametros ->> 'descricao', a.por_que), current_date + 7, a.decidido_por, a.id, 'conselho');$b$);
  if position('acao_id' in d) = 0 then raise exception 'troca em aplicar_acao não bateu'; end if;
  execute d;
end $$;

-- Concluir tarefa do Conselho: com o resultado (feita) ou marcada como não feita.
create or replace function public.concluir_tarefa(p_id uuid, p_resultado text, p_feita boolean)
returns void language plpgsql security definer set search_path to '' as $$
declare t public.tarefas;
begin
  if public.papel_do_usuario() not in ('dono', 'operador') then raise exception 'Seu papel não pode concluir tarefas.'; end if;
  select * into t from public.tarefas where id = p_id for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if p_feita and length(trim(coalesce(p_resultado, ''))) < 3 then raise exception 'Escreva em uma linha o que foi feito ou o que você achou.'; end if;
  update public.tarefas set concluida = true, nao_feita = not p_feita, resultado = nullif(left(trim(coalesce(p_resultado, '')), 1000), '') where id = p_id;
  if t.acao_id is not null then
    update public.acoes_propostas
    set tarefa_resultado = case when p_feita then left(trim(p_resultado), 1000) else 'Não feita' || coalesce(': ' || nullif(left(trim(coalesce(p_resultado, '')), 1000), ''), '') end,
        status = case when not p_feita and status = 'aplicada' then 'nao_feita' else status end
    where id = t.acao_id;
  end if;
end $$;
revoke all on function public.concluir_tarefa(uuid, text, boolean) from public, anon;
grant execute on function public.concluir_tarefa(uuid, text, boolean) to authenticated;

-- Dossiê do Conselho: cada ação recente leva o que a pessoa fez na tarefa.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.dossie_conselho()'::regprocedure);
  if position('tarefa_resultado' in d) > 0 then return; end if;
  d := replace(d, '''resultado'', resultado,', '''resultado'', resultado, ''tarefa_resultado'', tarefa_resultado,');
  if position('tarefa_resultado' in d) = 0 then raise exception 'troca no dossiê não bateu'; end if;
  execute d;
end $$;

-- Painel do Dashboard, em português simples. Datas no fuso de Brasília.
create or replace function public.painel_agora()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; ini timestamptz; r jsonb;
begin
  if public.papel_do_usuario() is null then raise exception 'Sem acesso.'; end if;
  ini := (hoje::timestamp at time zone 'America/Sao_Paulo');
  select jsonb_build_object(
    'andamento', coalesce((select jsonb_agg(x order by x.rodando desc, x.n desc) from (
        select j.tipo, count(*) n, count(*) filter (where j.status = 'rodando') rodando, min(j.rodar_em) proximo,
               (select jsonb_agg(e.nome) from (select distinct e.nome from public.jobs k join public.empresas e on e.id::text = k.payload ->> 'empresa_id'
                  where k.tipo = j.tipo and k.status in ('pendente', 'rodando') limit 5) e) empresas
        from public.jobs j where j.status in ('pendente', 'rodando') group by j.tipo) x), '[]'),
    'esperando', jsonb_build_object(
      'rascunhos', (select count(*) from public.emails where status = 'rascunho'),
      'aprovados_na_fila', (select count(*) from public.emails where status = 'aprovado'),
      'respostas', (select count(*) from public.respostas where status = 'nova'),
      'acoes', (select count(*) from public.acoes_propostas where status = 'proposta'),
      'telefones', (select count(*) from public.negocios where etapa = 'telefone'),
      'tarefas_atrasadas', (select count(*) from public.tarefas where not concluida and vence_em < hoje),
      'tarefas_hoje', (select count(*) from public.tarefas where not concluida and vence_em = hoje),
      'followups_semana', (select count(*) from public.tarefas where not concluida and tipo = 'followup_whatsapp' and vence_em <= hoje + 7)),
    'hoje', jsonb_build_object(
      'enviados', (select count(*) from public.emails where status = 'enviado' and enviado_em >= ini),
      'respostas', (select count(*) from public.respostas where recebido_em >= ini),
      'telefones', (select count(*) from public.interacoes where assunto = 'Telefone obtido' and ocorrido_em >= ini),
      'rascunhos_escritos', (select count(*) from public.emails where criado_em >= ini),
      'qualificadas', (select count(*) from public.empresas where qualificado_em >= ini),
      'qualificadas_boas', (select count(*) from public.empresas where qualificado_em >= ini and icp_score >= (select (valor ->> 'nota_minima')::int from public.config where chave = 'icp')),
      'sites_achados', (select count(*) from public.jobs where tipo = 'maps_achar_site' and status = 'feito' and terminado_em >= ini),
      'erros', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'erro', left(erro, 200))) from (select tipo, erro from public.jobs where status = 'erro' and terminado_em >= ini order by terminado_em desc limit 5) z), '[]')),
    'medicoes', coalesce((select jsonb_agg(jsonb_build_object('titulo', titulo, 'medir_em', medir_em, 'metrica', metrica, 'tarefa_aberta',
        exists (select 1 from public.tarefas t where t.acao_id = a.id and not t.concluida)) order by medir_em)
      from (select * from public.acoes_propostas where status = 'aplicada' order by medir_em limit 6) a), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.painel_agora() from public, anon;
grant execute on function public.painel_agora() to authenticated;

-- Tarefas que o Conselho já tinha criado: ligadas às suas ações.
update public.tarefas t set acao_id = a.id, tipo = 'conselho'
from public.acoes_propostas a
where a.tipo = 'tarefa' and t.acao_id is null and t.titulo = left(coalesce(a.parametros ->> 'titulo', a.titulo), 200);
