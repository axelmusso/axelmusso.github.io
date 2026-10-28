-- Pedido do dono (28/10/2026): só 2 rascunhos novos no dia. A lista de candidatas ao 1º e-mail estava vazia, mas 29 empresas
-- boas (nota e gancho, com site) nunca entraram porque ainda não tinham e-mail cadastrado; a busca de e-mail no site e no CNPJ
-- só acontece na hora de escrever (melhorContato). Agora entra também quem tem site e ainda não teve os contatos buscados
-- (ou buscou há mais de 30 dias). Sem e-mail achado, a empresa sai da lista por 30 dias (primeiro_email_tentado_em), sem gastar IA.
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
    and (exists (select 1 from public.contatos c where c.empresa_id = e.id and c.pode_contatar and c.email is not null)
      or (e.site is not null and (e.contatos_buscados_em is null or e.contatos_buscados_em < now() - interval '30 days')))
    and not exists (select 1 from public.empresas a where a.relacao = 'cliente_ativo' and a.id <> e.id
      and length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14
      and left(regexp_replace(a.cnpj, '\D', '', 'g'), 8) = left(regexp_replace(e.cnpj, '\D', '', 'g'), 8))
  order by e.icp_score desc nulls last, e.ultima_compra desc nulls last, e.criado_em
  limit greatest(p_limite, 0)
$$;
revoke all on function public.candidatas_primeiro_email(int) from public, anon, authenticated;
