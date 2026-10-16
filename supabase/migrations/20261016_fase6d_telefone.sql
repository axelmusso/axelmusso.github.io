-- Fase 6, parte D (16/10/2026): o sucesso da prospecção é o TELEFONE do responsável (compras, produção ou dono).
-- Funil: Novo → Qualificado → Contatado → Respondeu → Telefone obtido → Com o Áxel → Cliente (ganho) / Perdido.
-- Saem "reunião" e "proposta": a negociação acontece por telefone, fora do e-mail.
alter table public.negocios drop constraint if exists negocios_etapa_check;
alter table public.negocios add constraint negocios_etapa_check
  check (etapa in ('novo', 'qualificado', 'contatado', 'respondeu', 'telefone', 'com_axel', 'ganho', 'perdido'));

-- O dossiê do Conselho ordena as etapas pelo funil novo.
do $$
declare def text;
begin
  select pg_get_functiondef('public.dossie_conselho()'::regprocedure) into def;
  def := replace(def, $a$array['novo','qualificado','contatado','respondeu','reuniao','proposta','ganho','perdido']$a$,
                      $a$array['novo','qualificado','contatado','respondeu','telefone','com_axel','ganho','perdido']$a$);
  execute def;
end $$;

-- Link da apresentação em PDF, que vai no 1º e-mail de empresas novas.
insert into public.config (chave, valor) values ('apresentacao_url', '"https://corquimica.com.br/apresentacao-corquimica.pdf"')
on conflict (chave) do nothing;
