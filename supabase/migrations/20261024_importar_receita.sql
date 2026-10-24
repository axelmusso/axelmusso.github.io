-- Importação de empresas dos dados abertos da Receita (CNPJ), em ondas por CNAE (pedido do dono, 24/10/2026).
-- Os dados nunca passam pelo git: o arquivo filtrado fica fora do repositório e é enviado pela tela, logado como dono.
-- Cada item de "dados": [cnpj, nome, cnaes_secundarios (códigos separados por vírgula), cidade, uf, porte, email, dominio].
-- Não duplica: pula quem já existe pelo CNPJ, pelo nome (nome_chave) ou pelo domínio, e quem está na lista de não contatar.
-- O domínio só vem preenchido quando o e-mail é da própria empresa (não gratuito, não do contador): vira o site.
create or replace function public.importar_receita(dados jsonb, p_cnae text, p_setor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fonte constant text := 'https://arquivos.receitafederal.gov.br (dados abertos CNPJ 2026-10)';
  v_importadas int;
  v_contatos int;
begin
  -- Pela tela, só o dono; direto no banco (painel ou ferramenta de administração), a sessão do usuário postgres (current_user aqui é sempre o dono da função).
  if session_user <> 'postgres' and not exists (select 1 from perfis where id = auth.uid() and papel = 'dono') then
    raise exception 'Só o dono importa dados da Receita.';
  end if;

  create temp table _novas on commit drop as
  with r as (
    select a->>0 cnpj, a->>1 nome, a->>2 sec, a->>3 cidade, a->>4 uf, nullif(a->>5, '') porte, nullif(a->>6, '') email, nullif(a->>7, '') dom
    from jsonb_array_elements(dados) a
  )
  select r.* from r
  where not exists (select 1 from empresas e where e.cnpj = r.cnpj
          or e.nome_chave = regexp_replace(lower(translate(r.nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]', '', 'g')
          or (r.dom is not null and e.dominio = r.dom))
    and not exists (select 1 from lista_supressao s where (r.dom is not null and s.dominio ilike r.dom) or (r.email is not null and s.email ilike r.email));

  with ins as (
    insert into empresas (nome, cnpj, cnae, cnaes_secundarios, cidade, uf, porte, site, dominio, setor, situacao_cadastral, origem, fonte_url, coletado_em, status, relacao)
    select nome, cnpj, p_cnae,
      array(select substr(c, 1, 4) || '-' || substr(c, 5, 1) || '/' || substr(c, 6, 2) from unnest(string_to_array(nullif(sec, ''), ',')) c where length(c) = 7),
      cidade, uf, porte, case when dom is not null then 'https://' || dom end, dom,
      p_setor, 'ATIVA', 'receita:cnae', fonte, now(), 'prospect', 'prospect'
    from _novas
    returning id, cnpj
  ), cont as (
    insert into contatos (empresa_id, email, origem, fonte_url, coletado_em, base_legal, pode_contatar)
    select ins.id, n.email, 'receita_federal', fonte, now(), 'Dado público do cadastro CNPJ (Receita Federal)', true
    from ins join _novas n using (cnpj)
    where n.email ~ '^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' and n.email !~ '(contab|contador|escritorio|assessoria|consultoria)'
    returning 1
  )
  select (select count(*) from ins), (select count(*) from cont) into v_importadas, v_contatos;

  return jsonb_build_object('no_lote', jsonb_array_length(dados), 'importadas', v_importadas, 'contatos', v_contatos);
end;
$$;

revoke all on function public.importar_receita(jsonb, text, text) from public, anon;
grant execute on function public.importar_receita(jsonb, text, text) to authenticated;
