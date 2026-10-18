-- Dossiê do Conselho completo (18/10/2026, pedido do Áxel): além do funil, entram a concorrência (Fase 7),
-- o site e o canal de IA (Fase 8) e a prospecção (e-mails, respostas e segmentos qualificados).
-- Continua só com números do banco, cada bloco com a sua fonte. O bloco "memoria" é preenchido pela função conselho.
create or replace function public.dossie_conselho()
returns jsonb language sql stable security definer set search_path = ''
as $$
with ultima as (
  select empresa_id, max(ocorrido_em) as em from public.interacoes group by empresa_id
),
abertos as (
  select n.*, e.nome as empresa, e.setor,
         floor(extract(epoch from now() - coalesce(u.em, e.criado_em)) / 86400)::int as dias_sem_interacao
  from public.negocios n join public.empresas e on e.id = n.empresa_id left join ultima u on u.empresa_id = n.empresa_id
  where n.etapa not in ('ganho', 'perdido')
),
analise as (
  select * from public.analises_mercado where status = 'fechada' order by criado_em desc limit 1
)
select jsonb_build_object(
  'gerado_em', now(),
  'funil', jsonb_build_object(
    'fonte', 'negocios agrupados por etapa (todos)',
    'etapas', coalesce((select jsonb_agg(jsonb_build_object('etapa', etapa, 'negocios', n, 'valor_estimado', v) order by ordem)
      from (select etapa, count(*) n, coalesce(sum(valor_estimado), 0) v,
                   array_position(array['novo','qualificado','contatado','respondeu','telefone','com_axel','ganho','perdido'], etapa) ordem
            from public.negocios group by etapa) x), '[]')),
  'parados', jsonb_build_object(
    'fonte', 'negocios abertos x última interacoes.ocorrido_em da empresa; parado = 14+ dias sem interação',
    'por_etapa', coalesce((select jsonb_agg(jsonb_build_object('etapa', etapa, 'abertos', n, 'parados_14d', p, 'media_dias_sem_interacao', m))
      from (select etapa, count(*) n, count(*) filter (where dias_sem_interacao >= 14) p, round(avg(dias_sem_interacao)) m from abertos group by etapa) x), '[]'),
    'exemplos', coalesce((select jsonb_agg(jsonb_build_object('empresa', empresa, 'setor', setor, 'negocio', titulo, 'etapa', etapa, 'dias_sem_interacao', dias_sem_interacao))
      from (select * from abertos order by dias_sem_interacao desc limit 15) x), '[]')),
  'interacoes_90d', jsonb_build_object(
    'fonte', 'interacoes com ocorrido_em nos últimos 90 dias, por tipo e direção (sem mudança de etapa)',
    'contagem', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'direcao', direcao, 'n', n))
      from (select tipo, direcao, count(*) n from public.interacoes
            where ocorrido_em > now() - interval '90 days' and tipo <> 'mudanca_etapa' group by tipo, direcao) x), '[]')),
  'emails_90d', jsonb_build_object(
    'fonte', 'interacoes tipo email, últimos 90 dias: saida = enviados, entrada = respostas',
    'enviados', (select count(*) from public.interacoes where tipo = 'email' and direcao = 'saida' and ocorrido_em > now() - interval '90 days'),
    'respostas', (select count(*) from public.interacoes where tipo = 'email' and direcao = 'entrada' and ocorrido_em > now() - interval '90 days')),
  'movimentos_etapa_90d', jsonb_build_object(
    'fonte', 'interacoes tipo mudanca_etapa nos últimos 90 dias (conteudo = "de → para")',
    'contagem', coalesce((select jsonb_agg(jsonb_build_object('movimento', conteudo, 'n', n))
      from (select conteudo, count(*) n from public.interacoes where tipo = 'mudanca_etapa' and ocorrido_em > now() - interval '90 days'
            group by conteudo order by n desc limit 20) x), '[]')),
  'perdas', jsonb_build_object(
    'fonte', 'negocios etapa perdido, agrupados por motivo_perda',
    'motivos', coalesce((select jsonb_agg(jsonb_build_object('motivo', coalesce(motivo_perda, '(sem motivo)'), 'n', n))
      from (select motivo_perda, count(*) n from public.negocios where etapa = 'perdido' group by motivo_perda order by n desc) x), '[]')),
  'tarefas', jsonb_build_object(
    'fonte', 'tarefas não concluídas; atrasadas = vence_em antes de hoje',
    'abertas', (select count(*) from public.tarefas where not concluida),
    'atrasadas', (select count(*) from public.tarefas where not concluida and vence_em < (now() at time zone 'America/Sao_Paulo')::date)),
  'empresas', jsonb_build_object(
    'fonte', 'empresas por status e por setor (10 maiores)',
    'total', (select count(*) from public.empresas),
    'por_status', coalesce((select jsonb_object_agg(coalesce(status, '(sem status)'), n) from (select status, count(*) n from public.empresas group by status) x), '{}'),
    'por_setor', coalesce((select jsonb_agg(jsonb_build_object('setor', coalesce(setor, '(sem setor)'), 'n', n))
      from (select setor, count(*) n from public.empresas group by setor order by n desc limit 10) x), '[]')),
  'prospeccao', jsonb_build_object(
    'fonte', 'emails por status; respostas por classificacao; empresas prospect/ex-cliente qualificadas por segmento_icp (nota do segmento) e por relação',
    'emails_por_status', coalesce((select jsonb_object_agg(coalesce(status, '(sem status)'), n) from (select status, count(*) n from public.emails group by status) x), '{}'),
    'emails_enviados_por_passo', coalesce((select jsonb_object_agg('passo_' || coalesce(passo::text, '?'), n) from (select passo, count(*) n from public.emails where status = 'enviado' group by passo) x), '{}'),
    'respostas_por_classificacao', coalesce((select jsonb_object_agg(coalesce(classificacao, 'sem_classificacao'), n) from (select classificacao, count(*) n from public.respostas group by classificacao) x), '{}'),
    'qualificadas_por_segmento', coalesce((select jsonb_agg(jsonb_build_object('segmento', coalesce(segmento_icp, '(sem segmento)'), 'nota', nota, 'empresas', n, 'com_gancho', g) order by nota desc, n desc)
      from (select segmento_icp, max(icp_score) nota, count(*) n, count(*) filter (where not coalesce(sem_gancho, false)) g
            from public.empresas where qualificado_em is not null and relacao in ('prospect', 'ex_cliente') and status <> 'descartada' group by segmento_icp) x), '[]'),
    'por_relacao', coalesce((select jsonb_object_agg(coalesce(relacao, '(sem relação)'), n) from (select relacao, count(*) n from public.empresas group by relacao) x), '{}')),
  'concorrentes', jsonb_build_object(
    'fonte', 'concorrentes + coletas_concorrente (páginas públicas lidas) + última analises_mercado fechada (Claude propõe, ChatGPT confere, Claude fecha)',
    'coleta', coalesce((select jsonb_agg(jsonb_build_object('concorrente', c.nome, 'ultima_coleta', c.ultima_coleta_em, 'paginas', (select count(distinct k.url) from public.coletas_concorrente k where k.concorrente_id = c.id), 'sem_dados_motivo', c.ultimo_erro) order by c.nome)
      from public.concorrentes c where c.ativo), '[]'),
    'ultima_analise_em', (select criado_em from analise),
    'matriz', coalesce((select jsonb_agg(jsonb_build_object('concorrente', m->>'concorrente', 'promete', left(m->>'promete', 300), 'prova', left(m->>'prova', 200), 'fortes', m->'fortes', 'fracos', m->'fracos'))
      from analise, jsonb_array_elements(coalesce(analise.matriz, '[]'::jsonb)) m), '[]'),
    'lacunas', coalesce((select jsonb_agg(jsonb_build_object('prioridade', l->'prioridade', 'tema', l->>'tema', 'pergunta_do_comprador', l->>'pergunta_do_comprador', 'demanda', l->>'demanda', 'facilidade', l->>'facilidade'))
      from analise, jsonb_array_elements(coalesce(analise.lacunas, '[]'::jsonb)) l), '[]'),
    'propostas_de_conteudo', coalesce((select jsonb_agg(jsonb_build_object('titulo', titulo, 'situacao', status) order by criado_em) from public.propostas_conteudo), '[]')),
  'site', jsonb_build_object(
    'fonte', 'visitas (contagem própria, sem cookie) dos últimos 30 dias por canal, só páginas do site (caminho termina em /); leads do formulário do site nos últimos 30 dias',
    'visitas_por_canal', coalesce((select jsonb_object_agg(coalesce(canal, '(sem canal)'), n) from (select canal, count(*) n from public.visitas where caminho ~ '/$' and dia > (now() at time zone 'America/Sao_Paulo')::date - 30 group by canal) x), '{}'),
    'ia_por_origem', coalesce((select jsonb_object_agg(coalesce(origem, '(utm)'), n) from (select origem, count(*) n from public.visitas where canal = 'ia' and caminho ~ '/$' and dia > (now() at time zone 'America/Sao_Paulo')::date - 30 group by origem) x), '{}'),
    'paginas_mais_vistas', coalesce((select jsonb_agg(jsonb_build_object('caminho', caminho, 'n', n)) from (select caminho, count(*) n from public.visitas where caminho ~ '/$' and dia > (now() at time zone 'America/Sao_Paulo')::date - 30 group by caminho order by n desc limit 8) x), '[]'),
    'leads_formulario_30d', (select count(*) from public.leads where created_at > now() - interval '30 days')),
  'memoria', jsonb_build_object('fonte', 'memoria_aprendizados (Fase 5)', 'itens', '[]'::jsonb, 'observacao', 'preenchido pela função conselho com os aprendizados parecidos com o tema')
)
$$;
revoke all on function public.dossie_conselho() from public, anon, authenticated;
grant execute on function public.dossie_conselho() to service_role;

-- Robôs que testam endereços (ex.: /account.php, /sitemap348.xml) caem na página 404, que também conta visita.
-- A partir de agora só contam caminhos de página (terminam em "/"); o resto é ignorado.
create or replace function public.registrar_visita(p_caminho text, p_origem text default null, p_utm text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  o text := lower(nullif(trim(coalesce(p_origem, '')), ''));
  u text := lower(nullif(trim(coalesce(p_utm, '')), ''));
  c text;
begin
  if p_caminho is null or p_caminho !~ '^/[A-Za-z0-9/_.-]{0,200}$' or p_caminho !~ '/$' or p_caminho like '/app/%' then return; end if;
  if o is not null and o !~ '^[a-z0-9.-]{3,100}$' then o := null; end if;
  if o like '%corquimica.com.br' then o := null; end if;   -- navegação dentro do site não é origem
  -- ChatGPT costuma mandar utm_source=chatgpt.com mesmo quando o navegador esconde a origem.
  if coalesce(o, '') ~ '(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|claude\.ai|you\.com|poe\.com|deepseek\.com|meta\.ai|grok\.com|mistral\.ai)$'
     or coalesce(u, '') ~ '(chatgpt|openai|perplexity|gemini|copilot|claude)' then c := 'ia';
  elsif coalesce(o, '') ~ '(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+)$' then c := 'busca';
  elsif coalesce(o, '') ~ '(^|\.)(facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|t\.co|x\.com|youtube\.com|tiktok\.com|pinterest\.com|wa\.me|whatsapp\.com)$' then c := 'social';
  elsif coalesce(u, '') ~ '(email|newsletter|resend)' then c := 'email';
  elsif o is null then c := 'direto';
  else c := 'outro';
  end if;
  insert into public.visitas (caminho, canal, origem) values (left(p_caminho, 200), c, o);
end $$;
revoke all on function public.registrar_visita(text, text, text) from public;
grant execute on function public.registrar_visita(text, text, text) to anon, authenticated;
