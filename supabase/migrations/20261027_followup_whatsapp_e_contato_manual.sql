-- Pedido do dono (27/10/2026):
--   1) Negócio em "Com Áxel" (a conversa foi para o WhatsApp) ganha tarefas de follow-up no mesmo ritmo dos e-mails:
--      3 follow-ups (3 dias úteis, dia 7, dia 14) e 3 retomadas a cada 60 dias. Cada tarefa concluída cria a próxima.
--      Enquanto o negócio está com o Áxel, a cadência de e-mail da empresa fica pausada (volta se o negócio voltar).
--   2) E-mail de um responsável que o dono cadastra à mão (origem "manual") entra na cadência de e-mails na hora:
--      empresa ainda sem e-mail ganha o 1º rascunho (fila com prioridade); empresa que já recebeu e-mails troca a
--      cadência para o novo contato. Vale quando o contato é cadastrado ou quando o negócio volta para "Qualificado".
--      Negócio em "Com Áxel" ou "Telefone obtido" não recebe e-mail automático.

alter table public.tarefas add column if not exists tipo text, add column if not exists passo int;

-- Soma dias úteis (sábado e domingo não contam).
create or replace function privado.somar_dias_uteis(d date, n int) returns date
language plpgsql immutable set search_path to '' as $$
begin
  while n > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n - 1; end if;
  end loop;
  return d;
end $$;

-- Cria a tarefa de follow-up "passo" (1 a 3 = sequência; 4 a 6 = retomadas) do negócio.
create or replace function privado.tarefa_followup(p_negocio uuid, p_passo int, p_vence date) returns void
language plpgsql security definer set search_path to '' as $$
declare n record; e record; c record; quem text; fone text; titulo text; o_que text;
begin
  select * into n from public.negocios where id = p_negocio;
  select * into e from public.empresas where id = n.empresa_id;
  select * into c from public.contatos where empresa_id = e.id and telefone is not null and pode_contatar
    order by (origem in ('manual', 'resposta', 'indicado')) desc, coletado_em desc nulls last limit 1;
  fone := coalesce(c.telefone, e.whatsapp, 'sem número no cadastro');
  quem := coalesce(c.nome || ' (' || fone || ')', fone);
  if p_passo <= 3 then
    titulo := 'Follow-up ' || p_passo || '/3 WhatsApp: ' || e.nome || ' – ' || quem;
    o_que := case p_passo
      when 1 then 'Retomar a conversa com outro ângulo (o acabamento que eles fazem hoje, o segmento deles).'
      when 2 then 'Oferecer uma conversa rápida ou uma amostra para teste prático.'
      else 'Mensagem curta: avisar que vai dar um tempo e deixar a porta aberta.' end;
  else
    titulo := 'Retomada ' || (p_passo - 3) || '/3 WhatsApp: ' || e.nome || ' – ' || quem;
    o_que := 'Cerca de 2 meses depois: trazer um motivo novo para voltar a falar.';
  end if;
  insert into public.tarefas (titulo, descricao, vence_em, negocio_id, responsavel, tipo, passo)
  values (left(titulo, 200),
          o_que || ' Ao concluir esta tarefa, a próxima é criada sozinha; para parar, tire o negócio de "Com Áxel" (ganho, perdido ou outra etapa).',
          p_vence, p_negocio, n.responsavel, 'followup_whatsapp', p_passo);
end $$;

-- E-mail cadastrado à mão pelo dono: põe o contato na cadência (1º e-mail ou troca de contato).
create or replace function privado.cadencia_contato_manual(p_empresa uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare e record; c record;
begin
  select * into e from public.empresas where id = p_empresa;
  if not found or e.relacao not in ('prospect', 'ex_cliente') then return; end if;
  -- A conversa está com o Áxel (ou fechou): nada automático.
  if exists (select 1 from public.negocios where empresa_id = e.id and etapa in ('com_axel', 'telefone', 'ganho')) then return; end if;
  if exists (select 1 from public.emails where empresa_id = e.id and status in ('rascunho', 'aprovado')) then return; end if;
  -- O contato manual mais recente com e-mail que ainda não recebeu nada e não está na lista de não contatar.
  select * into c from public.contatos k
  where k.empresa_id = e.id and k.origem = 'manual' and k.pode_contatar and k.email is not null
    and not exists (select 1 from public.emails m where m.empresa_id = e.id and m.status = 'enviado' and lower(m.para) = lower(k.email))
    and not exists (select 1 from public.lista_supressao s where lower(s.email) = lower(k.email)
                    or (s.email is null and lower(s.dominio) = lower(split_part(k.email, '@', 2))))
  order by k.coletado_em desc nulls last limit 1;
  if not found then return; end if;
  if not exists (select 1 from public.emails where empresa_id = e.id and status = 'enviado')
     and not exists (select 1 from public.cadencias where empresa_id = e.id) then
    -- Nunca recebeu e-mail: 1º rascunho, na frente da fila normal (aguarda aprovação como todos).
    perform public.enfileirar('primeiro_email', jsonb_build_object('empresa_id', e.id), 7, 'primeiro_email:' || e.id);
    return;
  end if;
  if exists (select 1 from public.cadencias where empresa_id = e.id and status = 'ativa' and contato_id = c.id) then return; end if;
  -- Já recebeu e-mails: a cadência passa para o contato novo, começando do 1º e-mail (o rascunho sai na próxima rodada).
  update public.cadencias set status = 'encerrada', motivo_fim = 'novo contato cadastrado pelo dono', proximo_em = null
  where empresa_id = e.id and status in ('ativa', 'pausada', 'respondeu');
  insert into public.cadencias (empresa_id, contato_id, tipo, passo, proximo_em, iniciada_em)
  values (e.id, c.id, case when e.relacao = 'ex_cliente' then 'retomada' else 'prospeccao' end, 0, now(), now());
  insert into public.interacoes (empresa_id, contato_id, tipo, direcao, assunto, conteudo, agente_id)
  values (e.id, c.id, 'nota', 'interna', 'Novo contato na cadência', 'Contato cadastrado pelo dono: a cadência segue com ' || c.email || '.', 'cadencia');
end $$;

create or replace function privado.etapa_mudou() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.etapa = 'com_axel' then
    update public.cadencias set status = 'pausada', motivo_fim = 'com_axel' where empresa_id = new.empresa_id and status = 'ativa';
    if not exists (select 1 from public.tarefas where negocio_id = new.id and tipo = 'followup_whatsapp' and not concluida) then
      perform privado.tarefa_followup(new.id, 1, privado.somar_dias_uteis((now() at time zone 'America/Sao_Paulo')::date, 3));
    end if;
  elsif old.etapa = 'com_axel' then
    delete from public.tarefas where negocio_id = new.id and tipo = 'followup_whatsapp' and not concluida;
    if new.etapa not in ('ganho', 'perdido') then
      update public.cadencias set status = 'ativa', motivo_fim = null, proximo_em = greatest(proximo_em, now())
      where empresa_id = new.empresa_id and status = 'pausada' and motivo_fim = 'com_axel';
    end if;
  end if;
  if new.etapa in ('novo', 'qualificado') then perform privado.cadencia_contato_manual(new.empresa_id); end if;
  return null;
end $$;
drop trigger if exists etapa_mudou on public.negocios;
create trigger etapa_mudou after update of etapa on public.negocios
  for each row when (old.etapa is distinct from new.etapa) execute function privado.etapa_mudou();

create or replace function privado.contato_manual() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.origem = 'manual' and new.email is not null and new.pode_contatar then perform privado.cadencia_contato_manual(new.empresa_id); end if;
  return null;
end $$;
drop trigger if exists contato_manual on public.contatos;
create trigger contato_manual after insert or update of email, pode_contatar on public.contatos
  for each row execute function privado.contato_manual();

-- Follow-up concluído: cria o próximo, se o negócio ainda está com o Áxel.
create or replace function privado.followup_concluido() returns trigger
language plpgsql security definer set search_path to '' as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; prox date;
begin
  if new.tipo is distinct from 'followup_whatsapp' or coalesce(new.passo, 6) >= 6 then return null; end if;
  if not exists (select 1 from public.negocios where id = new.negocio_id and etapa = 'com_axel') then return null; end if;
  if exists (select 1 from public.tarefas where negocio_id = new.negocio_id and tipo = 'followup_whatsapp' and not concluida) then return null; end if;
  prox := coalesce(new.vence_em, hoje) + case new.passo when 1 then 4 when 2 then 7 else 60 end;
  prox := privado.somar_dias_uteis(prox - 1, 1); -- caiu no fim de semana: vai para segunda
  perform privado.tarefa_followup(new.negocio_id, new.passo + 1, greatest(prox, privado.somar_dias_uteis(hoje, 1)));
  return null;
end $$;
drop trigger if exists followup_concluido on public.tarefas;
create trigger followup_concluido after update of concluida on public.tarefas
  for each row when (new.concluida and not old.concluida) execute function privado.followup_concluido();

-- Rotina do 1º e-mail: negócio que está com o Áxel ou com telefone obtido não recebe e-mail automático.
create or replace function public.candidatas_primeiro_email(p_limite int)
returns setof uuid language sql stable security definer set search_path to '' as $$
  select e.id from public.empresas e
  where e.relacao in ('prospect', 'ex_cliente')
    and coalesce(e.status, '') not in ('descartada', 'cliente')
    and coalesce(e.situacao_cadastral, '') not in ('BAIXADA', 'INAPTA', 'SUSPENSA', 'NULA')
    and (e.relacao = 'ex_cliente' or (e.icp_score >= (select (valor ->> 'nota_minima')::int from public.config where chave = 'icp') and not coalesce(e.sem_gancho, false)))
    and (e.primeiro_email_tentado_em is null or e.primeiro_email_tentado_em < now() - interval '30 days')
    and not exists (select 1 from public.emails m where m.empresa_id = e.id and m.status in ('rascunho', 'aprovado', 'enviado', 'descartado'))
    and not exists (select 1 from public.cadencias c where c.empresa_id = e.id)
    and not exists (select 1 from public.negocios n where n.empresa_id = e.id and n.etapa in ('com_axel', 'telefone', 'ganho'))
    and exists (select 1 from public.contatos c where c.empresa_id = e.id and c.pode_contatar and c.email is not null)
    and not exists (select 1 from public.empresas a where a.relacao = 'cliente_ativo' and a.id <> e.id
      and length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14
      and left(regexp_replace(a.cnpj, '\D', '', 'g'), 8) = left(regexp_replace(e.cnpj, '\D', '', 'g'), 8))
  order by e.icp_score desc nulls last, e.ultima_compra desc nulls last, e.criado_em
  limit greatest(p_limite, 0)
$$;
revoke all on function public.candidatas_primeiro_email(int) from public, anon, authenticated;

revoke all on function privado.somar_dias_uteis(date, int), privado.tarefa_followup(uuid, int, date), privado.cadencia_contato_manual(uuid),
  privado.etapa_mudou(), privado.contato_manual(), privado.followup_concluido() from public, anon, authenticated;
