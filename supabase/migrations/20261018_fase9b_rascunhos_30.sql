-- Fase 9, complemento (18/10/2026, pedido do Áxel)
-- Também: Filial Passa Passo e LRB Tecidos marcadas como clientes ativos (o Áxel informou; a planilha corrigida ainda não foi reimportada).: manter sempre 30 e-mails esperando aprovação.
-- De hora em hora (junto com a cadência, seg a sex), se houver menos que config.rascunhos_alvo rascunhos,
-- o worker escreve o 1º e-mail das melhores empresas ainda não contatadas, só a diferença. Nada sai sem aprovação.

insert into public.config (chave, valor) values ('rascunhos_alvo', '30'::jsonb) on conflict (chave) do nothing;

-- Empresa já tentada (sem e-mail liberado, sem gancho...): não volta à lista por 30 dias.
alter table public.empresas add column if not exists primeiro_email_tentado_em timestamptz;

-- Candidatas ao 1º e-mail, da maior nota para a menor (ex-clientes sem nota vêm depois dos prospects).
-- Mesmas regras do botão "Escrever 1º e-mail": nota mínima, com gancho, CNPJ ativo, sem rascunho, sem cadência,
-- nunca contatada e com pelo menos um e-mail liberado.
create or replace function public.candidatas_primeiro_email(p_limite int)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select e.id from public.empresas e
  where e.relacao in ('prospect', 'ex_cliente')
    and coalesce(e.status, '') not in ('descartada', 'cliente')
    and coalesce(e.situacao_cadastral, '') not in ('BAIXADA', 'INAPTA', 'SUSPENSA', 'NULA')
    and (e.relacao = 'ex_cliente' or (e.icp_score >= (select (valor ->> 'nota_minima')::int from public.config where chave = 'icp') and not coalesce(e.sem_gancho, false)))
    and (e.primeiro_email_tentado_em is null or e.primeiro_email_tentado_em < now() - interval '30 days')
    and not exists (select 1 from public.emails m where m.empresa_id = e.id and m.status in ('rascunho', 'aprovado', 'enviado'))
    and not exists (select 1 from public.cadencias c where c.empresa_id = e.id)
    and exists (select 1 from public.contatos c where c.empresa_id = e.id and c.pode_contatar and c.email is not null)
    -- Filial de cliente ativo (mesma raiz do CNPJ) não recebe e-mail de prospecção nem de retomada.
    and not exists (select 1 from public.empresas a where a.relacao = 'cliente_ativo' and a.id <> e.id
      and length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14
      and left(regexp_replace(a.cnpj, '\D', '', 'g'), 8) = left(regexp_replace(e.cnpj, '\D', '', 'g'), 8))
  order by e.icp_score desc nulls last, e.ultima_compra desc nulls last, e.criado_em
  limit greatest(p_limite, 0)
$$;
revoke all on function public.candidatas_primeiro_email(int) from public, anon, authenticated;
grant execute on function public.candidatas_primeiro_email(int) to service_role;
