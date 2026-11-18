-- 18/11/2026, pedido do dono: empresa sem gancho não é mais pulada; o 1º e-mail apresenta a Corquímica de forma geral.
-- E as empresas da Receita sem site, com e-mail, que mostram plástico ou metalização no nome passam a ter nota (pelo CNAE e nome).

-- 1) "Sem gancho" deixa de tirar a empresa da lista do 1º e-mail.
create or replace function public.candidatas_primeiro_email(p_limite integer)
 returns setof uuid language sql stable security definer set search_path to ''
as $function$
  select e.id from public.empresas e
  where e.relacao in ('prospect', 'ex_cliente')
    and coalesce(e.status, '') not in ('descartada', 'cliente')
    and coalesce(e.situacao_cadastral, '') not in ('BAIXADA', 'INAPTA', 'SUSPENSA', 'NULA')
    and (e.relacao = 'ex_cliente' or e.icp_score >= (select (valor ->> 'nota_minima')::int from public.config where chave = 'icp'))
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
$function$;

-- 2) Quem foi pulado por "sem gancho" (nota boa, nunca recebeu e-mail) volta para a fila agora, sem esperar os 30 dias.
update public.empresas e set primeiro_email_tentado_em = null
 where e.sem_gancho and e.icp_score >= 50 and e.relacao = 'prospect'
   and not exists (select 1 from public.emails m where m.empresa_id = e.id);

-- 3) Segmento para quem só tem CNAE e nome (sem site): nota mínima, e-mail de apresentação geral.
update public.config set valor = jsonb_set(valor, '{segmentos}', (valor -> 'segmentos') || jsonb_build_array(jsonb_build_object(
  'id', 'acabamento_pelo_cnae', 'nome', 'Acabamento e metalização de peças (pelo CNAE e pelo nome, sem site)', 'nota', 50, 'grupo', 'medio')))
 where chave = 'icp' and not (valor -> 'segmentos') @> '[{"id":"acabamento_pelo_cnae"}]';

-- 4) As 16 empresas da Receita (CNAE 2539-0/02) sem site, com e-mail, com plástico ou metalização no nome.
--    "Galvanoplastia" sozinha não conta: é banho em metal (regra do dono). As outras ~716 seguem na fila do Maps.
update public.empresas e set
  segmento_icp = 'acabamento_pelo_cnae', acabamento = 'incerto', perfil_produto = 'geral',
  perfil_fonte = 'CNAE 2539-0/02 e nome (sem site)', sem_gancho = false, gancho = null,
  icp_motivo = 'Pelo CNAE 2539-0/02 (revestimento) e pelo nome, que cita plástico ou metalização; sem site: 1º e-mail de apresentação geral.',
  setor = coalesce(nullif(e.setor, 'CNAE: metalizacao/revestimento'), 'Acabamento e metalização de peças'),
  qualificado_em = now()
 where e.relacao = 'prospect' and e.icp_score is null and e.site is null and e.origem = 'receita:cnae' and e.cnae like '2539-0/02%'
   and coalesce(e.status, '') not in ('descartada', 'cliente')
   and exists (select 1 from public.contatos c where c.empresa_id = e.id and c.pode_contatar and c.email is not null)
   and (translate(lower(e.nome), 'áàâãéêíóôõúç', 'aaaaeeiooouc') ~ 'metaliz|vacuo|vacum|vacuum|polim'
        or regexp_replace(translate(lower(e.nome), 'áàâãéêíóôõúç', 'aaaaeeiooouc'), 'galvanoplast\w*', '', 'g') ~ 'plast');
