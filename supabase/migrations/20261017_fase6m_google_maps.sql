-- Fase 6, parte M (17/10/2026): busca de empresas no Google Maps (Places API New, Text Search).
-- Cada consulta fica em execucoes_agente (provedor 'google_maps', custo 0: está na cota grátis ou no crédito do teste)
-- e o limite diário fica em config.maps_limite_dia. O Google não deixou travar a cota nesta conta; a trava é a nossa.
insert into public.config (chave, valor) values ('maps_limite_dia', '150'::jsonb)
on conflict (chave) do nothing;

-- Id do lugar no Google: evita importar a mesma empresa duas vezes.
alter table public.empresas add column if not exists google_place_id text;
create unique index if not exists empresas_google_place_id on public.empresas (google_place_id) where google_place_id is not null;

-- As consultas ao Google Maps entram no mesmo registro de execuções (custo 0, só para contar o teto diário).
alter table public.execucoes_agente drop constraint if exists execucoes_agente_provedor_check;
alter table public.execucoes_agente add constraint execucoes_agente_provedor_check
  check (provedor = any (array['anthropic', 'openai', 'google_maps']));
