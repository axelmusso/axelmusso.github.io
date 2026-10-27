-- Pedido do dono (27/10/2026): "os robôs não estão entendendo o que estou escrevendo no descarte".
-- Caso da Jador: o dono reprovou o endereço pcp@ e escreveu no motivo "usar comercial@ (Luceneia, CEO)". Deu errado porque:
--   1) o endereço reprovado continuava liberado quando fora cadastrado à mão (origem manual), e o robô voltou a escolhê-lo;
--   2) liberar de novo o comercial@ (que já existia) disparou o gatilho de contato manual, que pôs a empresa na fila do
--      1º e-mail ao mesmo tempo que a tela pedia a reescrita: saiu um rascunho duplicado, outra vez para o pcp@.
-- Agora: endereço reprovado pelo dono fica bloqueado, venha de onde vier; e o descarte não dispara o gatilho
-- (quem reescreve é a reescrita, que usa o contato apontado no motivo).

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
  -- A reescrita é feita pela tela (prospeccao/refazer): o gatilho de contato manual não deve escrever outro rascunho junto.
  perform set_config('corquimica.descartando', 'sim', true);

  update public.emails set status = 'descartado', descarte_tipo = p_tipo, descarte_motivo = mot, descartado_em = now() where id = p_email;
  if p_tipo = 'empresa' then
    update public.empresas set status = 'descartada', descarte_motivo = mot, descartada_em = now() where id = m.empresa_id;
    update public.emails set status = 'descartado', erro = 'Empresa descartada pelo dono.', descartado_em = now()
      where empresa_id = m.empresa_id and status in ('rascunho', 'aprovado') and id <> p_email;
    update public.cadencias set status = 'suprimida', motivo_fim = 'empresa descartada pelo dono' where empresa_id = m.empresa_id and status in ('ativa', 'pausada');
    update public.negocios set etapa = 'perdido', motivo_perda = left('Descartada pelo dono: ' || mot, 500) where empresa_id = m.empresa_id and etapa not in ('ganho', 'perdido');
  elsif p_tipo = 'contato' then
    -- o endereço não serve: não recebe mais nada, mesmo que tenha sido cadastrado à mão (quem reprova agora é o dono)
    update public.contatos set pode_contatar = false where empresa_id = m.empresa_id and lower(email) = lower(m.para);
    update public.cadencias set status = 'encerrada', motivo_fim = 'endereço reprovado pelo dono', proximo_em = null
      where id = m.cadencia_id and status in ('ativa', 'pausada');
    -- e-mail que o dono escreveu no motivo vira contato confirmado (origem manual, fonte: o próprio dono)
    for novo in select distinct lower(x[1]) from regexp_matches(mot, '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') x loop
      if lower(novo) <> lower(m.para) and not exists (select 1 from public.contatos c where c.empresa_id = m.empresa_id and lower(c.email) = lower(novo)) then
        insert into public.contatos (empresa_id, email, origem, coletado_em, base_legal, pode_contatar)
        values (m.empresa_id, lower(novo), 'manual', now(), 'Informado pelo dono ao revisar o rascunho', true);
        novos := novos + 1;
      elsif lower(novo) <> lower(m.para) then
        update public.contatos set pode_contatar = true where empresa_id = m.empresa_id and lower(email) = lower(novo) and not pode_contatar;
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

-- Contato manual: só quando o e-mail é novo, muda ou volta a ser liberado; nunca durante um descarte.
create or replace function privado.contato_manual() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('corquimica.descartando', true), '') = 'sim' then return null; end if;
  if tg_op = 'UPDATE' and old.email is not distinct from new.email and (old.pode_contatar or not new.pode_contatar) then return null; end if;
  if new.origem = 'manual' and new.email is not null and new.pode_contatar then perform privado.cadencia_contato_manual(new.empresa_id); end if;
  return null;
end $$;
revoke all on function privado.contato_manual() from public, anon, authenticated;
