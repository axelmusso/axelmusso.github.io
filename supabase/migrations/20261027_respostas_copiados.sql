-- Pedido do dono (27/10/2026): a Proadec respondeu copiando a equipe responsável, mas a caixa de respostas só mostrava
-- quem escreveu e a resposta do Fernando saía só para essa pessoa.
-- copiados: quem mais recebeu a resposta (para e cópia), fora quem escreveu e a Corquímica. A nossa resposta vai com cópia para eles.
-- null = resposta anterior a esta mudança (ainda não lida no Resend); vazio = ninguém copiado.
alter table public.respostas add column if not exists copiados text[];
