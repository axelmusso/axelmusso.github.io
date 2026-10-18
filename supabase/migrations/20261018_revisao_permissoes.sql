-- Revisão antes de ligar os robôs (18/10/2026): arrumação de permissões apontadas pelo Supabase.
-- feiras: o visitante anônimo não tinha regra que liberasse nada (RLS já bloqueava); tira a permissão para não deixar dúvida.
revoke all on public.feiras from anon;
-- Funções de gatilho: só rodam dentro do gatilho; fecha a chamada direta pela API.
revoke all on function public.aplicar_segmento_icp() from public, anon, authenticated;
revoke all on function public.propostas_da_analise() from public, anon, authenticated;

-- Rotina dos 30 rascunhos: empresa com e-mail descartado (por você ou pelo sistema: resposta, descadastro,
-- telefone obtido) não volta para a fila de 1º e-mail. Achado na revisão: a Chaveiros Mania, descartada, tinha voltado.
create or replace function public.candidatas_primeiro_email(p_limite int)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select e.id from public.empresas e
  where e.relacao in ('prospect', 'ex_cliente')
    and coalesce(e.status, '') not in ('descartada', 'cliente')
    and coalesce(e.situacao_cadastral, '') not in ('BAIXADA', 'INAPTA', 'SUSPENSA', 'NULA')
    and (e.relacao = 'ex_cliente' or (e.icp_score >= (select (valor ->> 'nota_minima')::int from public.config where chave = 'icp') and not coalesce(e.sem_gancho, false)))
    and (e.primeiro_email_tentado_em is null or e.primeiro_email_tentado_em < now() - interval '30 days')
    and not exists (select 1 from public.emails m where m.empresa_id = e.id and m.status in ('rascunho', 'aprovado', 'enviado', 'descartado'))
    and not exists (select 1 from public.cadencias c where c.empresa_id = e.id)
    and exists (select 1 from public.contatos c where c.empresa_id = e.id and c.pode_contatar and c.email is not null)
    and not exists (select 1 from public.empresas a where a.relacao = 'cliente_ativo' and a.id <> e.id
      and length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14
      and left(regexp_replace(a.cnpj, '\D', '', 'g'), 8) = left(regexp_replace(e.cnpj, '\D', '', 'g'), 8))
  order by e.icp_score desc nulls last, e.ultima_compra desc nulls last, e.criado_em
  limit greatest(p_limite, 0)
$$;
