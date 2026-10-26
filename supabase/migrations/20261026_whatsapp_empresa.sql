-- WhatsApp da empresa achado no site (pedido do dono, 26/10/2026): link wa.me ou celular publicado.
-- A qualificação e a busca de contatos preenchem; o contato por e-mail segue igual.
alter table public.empresas add column if not exists whatsapp text;
alter table public.empresas add column if not exists whatsapp_fonte text;
comment on column public.empresas.whatsapp is 'WhatsApp ou celular publicado no site da empresa, formato (DD) 9XXXX-XXXX';
comment on column public.empresas.whatsapp_fonte is 'Página do site onde o número foi achado';
