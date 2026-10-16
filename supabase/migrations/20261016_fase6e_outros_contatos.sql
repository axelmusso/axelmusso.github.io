-- Fase 6, parte E (16/10/2026): a empresa só para de ser tentada quando acabam os e-mails dela.
-- Depois dos 14 dias (4 e-mails) sem resposta, a cadência passa para o próximo e-mail da empresa;
-- bounce ou caixa não monitorada trocam na hora. Sem outro e-mail, busca no site e no CNPJ antes das retomadas.

-- Quando a empresa teve os contatos procurados no site e no CNPJ (no máximo uma busca a cada 30 dias).
alter table public.empresas add column if not exists contatos_buscados_em timestamptz;

-- Fim da sequência de 14 dias já tratado (trocou de contato ou seguiu para as retomadas) e por que a cadência acabou.
alter table public.cadencias
  add column if not exists fim_sequencia_em timestamptz,
  add column if not exists motivo_fim text;
