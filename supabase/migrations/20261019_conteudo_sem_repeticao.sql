-- Conteúdo sem repetição (19/10/2026): a análise de concorrência de 19/10 repropôs temas que já estavam na lista
-- (homologação, metalização, cosméticos, guia de verniz). Duas travas:
--   1. a análise recebe as propostas existentes no dossiê (função concorrencia) e só propõe tema novo;
--   2. aqui, na entrada: proposta com a mesma URL, ou com a maioria das palavras-chave da lacuna ou do título
--      em comum com uma existente (inclusive descartada), não entra.

-- Palavras-chave: minúsculas, sem acento, 5 letras ou mais.
create or replace function public.palavras_chave(t text)
returns text[] language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(distinct w), '{}') from unnest(regexp_split_to_array(
    translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z0-9]+')) w
  where length(w) >= 5
$$;

-- Parecidos: metade ou mais das palavras-chave do texto menor aparecem no outro (mínimo de 3 palavras no menor).
create or replace function public.textos_parecidos(a text, b text)
returns boolean language sql immutable set search_path = ''
as $$
  with x as (select public.palavras_chave(a) pa, public.palavras_chave(b) pb)
  select least(cardinality(pa), cardinality(pb)) >= 3
     and (select count(*) from unnest(pa) w where w = any(pb))::numeric / least(cardinality(pa), cardinality(pb)) >= 0.5
  from x
$$;

create or replace function public.propostas_da_analise()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'fechada' and old.status is distinct from 'fechada' and jsonb_typeof(new.propostas) = 'array' then
    insert into public.propostas_conteudo (analise_id, lacuna, tipo, titulo, url_sugerida, esboco, dados_que_faltam, por_que)
    select new.id, p->>'lacuna', p->>'tipo', coalesce(p->>'titulo', '(sem título)'), p->>'url_sugerida',
           coalesce(p->'esboco', '[]'), coalesce(p->'dados_que_faltam', '[]'), p->>'por_que'
    from jsonb_array_elements(new.propostas) p
    where not exists (select 1 from public.propostas_conteudo x where x.analise_id = new.id)
      -- tema já proposto (em qualquer situação, inclusive descartado): não repete
      and not exists (
        select 1 from public.propostas_conteudo x
        where (p->>'url_sugerida' is not null and x.url_sugerida = p->>'url_sugerida')
           or public.textos_parecidos(x.lacuna, p->>'lacuna')
           or public.textos_parecidos(x.titulo, p->>'titulo'));
  end if;
  return new;
end $$;
revoke all on function public.propostas_da_analise() from public, anon, authenticated;
