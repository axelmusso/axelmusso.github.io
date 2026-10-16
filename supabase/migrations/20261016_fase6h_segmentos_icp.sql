-- Fase 6, parte H (16/10/2026): a nota ICP vem do SEGMENTO, numa tabela que o Áxel define (config.icp.segmentos).
-- A IA só classifica a empresa num segmento, com a evidência; o banco calcula a nota. Correção manual na tela vale sobre a IA.

-- Nome normalizado para achar duplicatas sem tropeçar em acento ("METALIZACAO IGREJINHA" = "Metalização Igrejinha").
alter table public.empresas add column if not exists nome_chave text generated always as (
  regexp_replace(lower(translate(nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]', '', 'g')
) stored;
create index if not exists empresas_nome_chave on public.empresas (nome_chave);

alter table public.empresas
  add column if not exists segmento_icp text,
  add column if not exists icp_manual bool not null default false;   -- true: segmento escolhido pelo Áxel, a IA não troca

-- Tabela de segmentos (respostas do Áxel em 16/10): metalização 100, alvo 95, bom 80, médio 55, sem informação 40, fora 0.
update public.config set valor = jsonb_set(valor, '{segmentos}', '[
  {"id":"metalizacao","nome":"Metalização (vácuo ou galvanoplastia em plástico)","nota":100,"grupo":"alvo","perfil":"metalizacao"},
  {"id":"fita_borda","nome":"Fitas de borda e revestimentos decorativos (PVC, ABS, melamínico, papel)","nota":95,"grupo":"alvo","perfil":"verniz"},
  {"id":"saltos_solados","nome":"Saltos, solados e tacos (plástico, PU, TPU)","nota":95,"grupo":"alvo"},
  {"id":"enfeites_bijuterias","nome":"Enfeites e bijuterias (plástico ou metal)","nota":95,"grupo":"alvo"},
  {"id":"puxadores_acessorios","nome":"Puxadores, maçanetas e peças decorativas de plástico ou zamac com acabamento","nota":95,"grupo":"alvo"},
  {"id":"embalagem_cosmetica","nome":"Embalagens de cosméticos e perfumaria (frascos, tampas)","nota":95,"grupo":"alvo"},
  {"id":"grafica_uv","nome":"Gráficas com acabamento em verniz UV","nota":80,"grupo":"bom","perfil":"verniz"},
  {"id":"plastico_acabamento","nome":"Peças plásticas com pintura, verniz, hot stamping ou impressão","nota":80,"grupo":"bom"},
  {"id":"impressao_3d","nome":"Impressão 3D com resina","nota":80,"grupo":"bom","perfil":"resina3d"},
  {"id":"plastico_auto_linha_branca","nome":"Peças plásticas automotivas e de linha branca","nota":80,"grupo":"bom"},
  {"id":"calcados_fabricante","nome":"Fábrica de calçados prontos","nota":55,"grupo":"medio"},
  {"id":"injecao_plastica","nome":"Injeção ou extrusão de plástico sem acabamento visível","nota":55,"grupo":"medio"},
  {"id":"sem_informacao","nome":"Sem informação suficiente (verificar)","nota":40,"grupo":"verificar"},
  {"id":"vidro","nome":"Vidro","nota":0,"grupo":"fora"},
  {"id":"madeira_moveis","nome":"Madeira, MDF e móveis prontos","nota":0,"grupo":"fora"},
  {"id":"loja_revenda","nome":"Loja ou revenda ao consumidor","nota":0,"grupo":"fora"},
  {"id":"ferragens_metalurgia","nome":"Ferragens e metalurgia (aço, alumínio)","nota":0,"grupo":"fora"},
  {"id":"textil_couro","nome":"Tecidos, couro, espumas e aviamentos têxteis","nota":0,"grupo":"fora"},
  {"id":"papel_papelao","nome":"Papel e papelão (embalagens, displays)","nota":0,"grupo":"fora"},
  {"id":"quimico_concorrente","nome":"Tintas, vernizes, adesivos e químicos (concorrente)","nota":0,"grupo":"fora"},
  {"id":"maquinas_servicos","nome":"Máquinas, moldes, ferramentas, software e serviços","nota":0,"grupo":"fora"}
]'::jsonb) where chave = 'icp';

-- Nota = nota do segmento; fora das UFs prioritárias, 10 pontos a menos. Prospect ganha o perfil de produto do segmento, se houver.
create or replace function public.aplicar_segmento_icp() returns trigger
language plpgsql security definer set search_path = public as $$
declare icp jsonb; seg jsonb;
begin
  if new.segmento_icp is null then return new; end if;
  select valor into icp from config where chave = 'icp';
  select s into seg from jsonb_array_elements(icp->'segmentos') s where s->>'id' = new.segmento_icp;
  if seg is null then return new; end if;
  new.icp_score := greatest(0, (seg->>'nota')::int - case when new.uf is not null and not (icp->'ufs_prioritarias') ? new.uf and (seg->>'nota')::int > 0 then 10 else 0 end);
  if new.origem is distinct from 'base_clientes' and seg ? 'perfil' then new.perfil_produto := seg->>'perfil'; end if;
  return new;
end $$;
drop trigger if exists empresas_segmento_icp on public.empresas;
create trigger empresas_segmento_icp before insert or update of segmento_icp, uf on public.empresas
  for each row execute function public.aplicar_segmento_icp();

-- Clientes e ex-clientes da base: o segmento vem do que compram (metalização ou resina 3D). Os demais ficam para qualificar pelo site.
update public.empresas set segmento_icp = case perfil_produto when 'metalizacao' then 'metalizacao' else 'impressao_3d' end,
  icp_criterios = null, icp_motivo = 'Pela base de clientes: compra ' || case perfil_produto when 'metalizacao' then 'verniz UV para metalização' else 'resina 3D' end
where origem = 'base_clientes' and perfil_produto in ('metalizacao', 'resina3d') and segmento_icp is null;
