-- Pedido do dono (22/10/2026): etapa "Follow-up" no funil, entre Contatado e Respondeu.
-- Contatado = recebeu o 1º e-mail; Follow-up = recebeu um e-mail seguinte da cadência sem ter respondido.
-- Se responder (ao 1º e-mail ou a um follow-up), o negócio vai para Respondeu.
alter table public.negocios drop constraint if exists negocios_etapa_check;
alter table public.negocios add constraint negocios_etapa_check
  check (etapa in ('novo', 'qualificado', 'contatado', 'follow_up', 'respondeu', 'telefone', 'com_axel', 'ganho', 'perdido'));

-- O dossiê do Conselho ordena as etapas pelo funil.
do $$
declare def text;
begin
  select pg_get_functiondef('public.dossie_conselho()'::regprocedure) into def;
  def := replace(def, $a$array['novo','qualificado','contatado','respondeu','telefone','com_axel','ganho','perdido']$a$,
                      $a$array['novo','qualificado','contatado','follow_up','respondeu','telefone','com_axel','ganho','perdido']$a$);
  execute def;
end $$;

-- Quem já recebeu follow-up e segue sem responder passa para a etapa nova.
update public.negocios n set etapa = 'follow_up'
where n.etapa = 'contatado'
  and exists (select 1 from public.emails m where m.empresa_id = n.empresa_id and m.status = 'enviado' and m.passo >= 2);
