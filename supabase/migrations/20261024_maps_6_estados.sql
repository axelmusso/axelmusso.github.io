-- Correção (24/10/2026): a regra do dono é Brasil todo, com foco em RS, SC, PR, SP, MG e RJ (15/10/2026).
-- As buscas do Maps estavam só no RS (+ São João Batista/SC). Agora os polos industriais dos 6 estados, alternando
-- os estados para a cobertura andar junto; as cidades do RS já buscadas não repetem (a busca só volta depois de 90 dias).
-- Segmentos: os 4 prioritários do dono (23/10/2026) primeiro.
update public.config set valor = '[
  "metalização a vácuo de peças plásticas",
  "revestimento PET PVC",
  "embalagens plásticas para cosméticos",
  "pintura industrial de peças plásticas",
  "cromagem de plástico",
  "fita de borda PVC",
  "pés e puxadores para móveis",
  "fábrica de saltos e solados"
]'::jsonb where chave = 'maps_segmentos';

update public.config set valor = '[
  "São Paulo SP", "Joinville SC", "Curitiba PR", "Belo Horizonte MG", "Rio de Janeiro RJ", "Bento Gonçalves RS",
  "Guarulhos SP", "Blumenau SC", "São José dos Pinhais PR", "Contagem MG", "Duque de Caxias RJ", "Farroupilha RS",
  "Diadema SP", "Jaraguá do Sul SC", "Arapongas PR", "Borda da Mata MG", "Nova Iguaçu RJ", "Caxias do Sul RS",
  "São Bernardo do Campo SP", "Caçador SC", "Maringá PR", "Pouso Alegre MG", "Resende RJ", "Novo Hamburgo RS",
  "Sorocaba SP", "Brusque SC", "Londrina PR", "Nova Serrana MG", "São Gonçalo RJ", "Campo Bom RS",
  "Itaquaquecetuba SP", "Rodeio SC", "Ponta Grossa PR", "Ubá MG", "Sapiranga RS",
  "Campinas SP", "Criciúma SC", "Igrejinha RS", "Jundiaí SP", "São João Batista SC", "Estância Velha RS",
  "Carapicuíba SP", "Birigui SP", "Franca SP", "Santo André SP", "Barueri SP", "Três Coroas RS", "Parobé RS",
  "Dois Irmãos RS", "São Leopoldo RS", "Porto Alegre RS"
]'::jsonb where chave = 'maps_cidades';
