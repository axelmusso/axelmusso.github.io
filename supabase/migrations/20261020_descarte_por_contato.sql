-- Descarte por contato (20/10/2026, pedido do Áxel): "a empresa serve, mas o e-mail não". Até aqui só havia
-- "a empresa não serve" (sai de tudo) e "refazer o texto" (mesmo endereço). Agora há a 3ª opção:
--   contato → o endereço deixa de ser usado, a empresa segue e o robô procura outro e-mail (site, CNPJ) e reescreve.
-- E-mail escrito pelo dono no motivo (ex.: "o certo é compras@vitesse.ind.br") vira contato confirmado da empresa.

alter table public.emails drop constraint if exists emails_descarte_tipo_check;
alter table public.emails add constraint emails_descarte_tipo_check check (descarte_tipo in ('empresa', 'refazer', 'contato'));
drop index if exists public.emails_refazer;
create index if not exists emails_refazer on public.emails (descartado_em desc) where descarte_tipo in ('refazer', 'contato');

create or replace function public.descartar_email(p_email uuid, p_tipo text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare m public.emails; mot text := left(trim(coalesce(p_motivo, '')), 500); novo text; novos int := 0;
begin
  if (select public.papel_do_usuario()) is distinct from 'dono' and (select public.papel_do_usuario()) is distinct from 'operador' then
    raise exception 'Seu papel não pode descartar rascunhos.';
  end if;
  if p_tipo not in ('empresa', 'refazer', 'contato') then raise exception 'Escolha o motivo do descarte: texto, endereço de e-mail ou empresa.'; end if;
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
  elsif p_tipo = 'contato' then
    -- o endereço não serve: não recebe mais nada; a cadência dele termina e a próxima começa com o novo contato
    update public.contatos set pode_contatar = false where empresa_id = m.empresa_id and lower(email) = lower(m.para) and origem not in ('manual');
    update public.cadencias set status = 'encerrada', motivo_fim = 'endereço reprovado pelo dono', proximo_em = null
      where id = m.cadencia_id and status in ('ativa', 'pausada');
    -- e-mail que o dono escreveu no motivo vira contato confirmado (origem manual, fonte: o próprio dono)
    for novo in select distinct lower(x[1]) from regexp_matches(mot, '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') x loop
      if lower(novo) <> lower(m.para) and not exists (select 1 from public.contatos c where c.empresa_id = m.empresa_id and lower(c.email) = lower(novo)) then
        insert into public.contatos (empresa_id, email, origem, coletado_em, base_legal, pode_contatar)
        values (m.empresa_id, lower(novo), 'manual', now(), 'Informado pelo dono ao revisar o rascunho', true);
        novos := novos + 1;
      else
        update public.contatos set pode_contatar = true where empresa_id = m.empresa_id and lower(email) = lower(novo);
      end if;
    end loop;
  end if;
  insert into public.interacoes (empresa_id, contato_id, tipo, direcao, assunto, conteudo, agente_id)
  values (m.empresa_id, m.contato_id, 'email', 'interna',
          case p_tipo when 'empresa' then 'Empresa descartada pelo dono' when 'contato' then 'Endereço de e-mail reprovado pelo dono' else 'Rascunho reprovado: refazer' end, mot, 'dono');
  return jsonb_build_object('email_id', m.id, 'empresa_id', m.empresa_id, 'tipo', p_tipo, 'contatos_novos', novos);
end $$;
revoke all on function public.descartar_email(uuid, text, text) from public, anon;
grant execute on function public.descartar_email(uuid, text, text) to authenticated;

-- Correção dos descartes de 19 e 20/10 em que o dono marcou "a empresa não serve", mas o motivo diz que
-- a empresa serve e o problema era o endereço (Golden Pinturas, Vitesse, Ramarim): voltam como "contato".
do $$
declare r record; novo text;
begin
  for r in select m.id, m.empresa_id, m.para, m.descarte_motivo from public.emails m join public.empresas e on e.id = m.empresa_id
           where m.descarte_tipo = 'empresa' and e.status = 'descartada'
             and (m.descarte_motivo ilike '%empresa serve%' or m.descarte_motivo ilike '%endereço do email não faz sentido%')
  loop
    update public.emails set descarte_tipo = 'contato' where id = r.id;
    update public.empresas set status = 'prospect', descarte_motivo = null, descartada_em = null where id = r.empresa_id;
    update public.contatos set pode_contatar = false where empresa_id = r.empresa_id and lower(email) = lower(r.para) and origem not in ('manual');
    for novo in select distinct lower(x[1]) from regexp_matches(r.descarte_motivo, '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') x loop
      if not exists (select 1 from public.contatos c where c.empresa_id = r.empresa_id and lower(c.email) = novo) then
        insert into public.contatos (empresa_id, email, origem, coletado_em, base_legal, pode_contatar)
        values (r.empresa_id, novo, 'manual', now(), 'Informado pelo dono ao revisar o rascunho', true);
      end if;
    end loop;
    insert into public.interacoes (empresa_id, tipo, direcao, assunto, conteudo, agente_id)
    values (r.empresa_id, 'nota', 'interna', 'Empresa reativada', 'O motivo do descarte dizia que a empresa serve e o problema era o endereço de e-mail: volta para a prospecção com outro contato.', 'sistema');
  end loop;
end $$;
