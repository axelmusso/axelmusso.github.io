-- Fase 6, parte B: envio pelo Resend. Guarda o message_id da resposta recebida, para responder na mesma conversa.
-- Aplicada no Supabase em 15/10/2026.
alter table public.respostas add column if not exists message_id text;
