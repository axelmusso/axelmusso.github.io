-- Busca diária com IA (24/10/2026): a IA pesquisa na web empresas dos 4 segmentos prioritários do dono (23/10/2026)
-- nos 6 estados de foco, começando pelos que a Receita e o Maps não cobriam. Cada empresa achada entra sem nota e passa
-- pela qualificação de sempre. Gasto: teto próprio de US$ 0,45 por dia, dentro do teto geral de US$ 1,30.
insert into public.config (chave, valor) values ('busca_ia', '{
  "ativo": true,
  "por_dia": 3,
  "teto_dia_usd": 0.45,
  "buscas_por_vez": 5,
  "empresas_por_vez": 10,
  "repetir_dias": 30,
  "ufs": ["SP", "SC", "PR", "MG", "RJ", "RS"],
  "segmentos": [
    {"id": "metalizacao", "nome": "Metalizadoras a vácuo de peças plásticas",
     "termos": ["metalização a vácuo", "metalização de peças plásticas", "cromagem de plástico", "metalizadora"]},
    {"id": "revestimento_pet_pvc", "nome": "Fabricantes de revestimentos, painéis e laminados de PET ou PVC",
     "termos": ["revestimento PET", "revestimento vinílico PVC", "painel PVC decorativo", "laminado PET para móveis"]},
    {"id": "embalagem_cosmetica", "nome": "Fabricantes de embalagens plásticas para cosméticos (frascos, tampas, potes)",
     "termos": ["embalagens plásticas para cosméticos", "tampas para cosméticos", "frascos plásticos para cosméticos", "decoração de embalagens plásticas"]},
    {"id": "plastico_acabamento", "nome": "Injetoras que pintam ou metalizam as peças na própria linha",
     "termos": ["injeção plástica e pintura", "pintura de peças plásticas injetadas", "injeção e metalização de plásticos", "acabamento em peças injetadas"]}
  ]
}'::jsonb)
on conflict (chave) do update set valor = excluded.valor;

-- Todo dia às 6h (Brasília), antes das outras rotinas.
select cron.schedule('cq-busca-ia', '0 9 * * *', $$select public.enfileirar('busca_ia', '{}', 4, 'busca_ia')$$);
