-- Fase 6, parte G (16/10/2026): cadastro de feiras (fonte constante de leads) e escopo de cliente mais estreito.

-- Feiras do setor: onde está a lista pública de expositores e quando foi lida pela última vez.
create table if not exists public.feiras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text,
  uf text,
  segmento text,                       -- calçados, moveleiro, plástico, cosméticos...
  site text,
  url_expositores text,                -- página pública com a lista (vazia se a feira não publica)
  situacao text not null default 'a_verificar' check (situacao in ('com_lista', 'sem_lista', 'a_verificar', 'fora_do_escopo')),
  proxima_edicao text,                 -- texto livre: "março de 2027"
  observacao text,
  ultima_leitura timestamptz,
  expositores_importados int not null default 0,
  criado_em timestamptz not null default now(),
  unique (nome)
);
alter table public.feiras enable row level security;
drop policy if exists "le_quem_tem_papel" on public.feiras;
create policy "le_quem_tem_papel" on public.feiras for select to authenticated using ((select public.papel_do_usuario()) is not null);
drop policy if exists "insere_dono_operador" on public.feiras;
create policy "insere_dono_operador" on public.feiras for insert to authenticated with check ((select public.papel_do_usuario()) = any (array['dono', 'operador']));
drop policy if exists "altera_dono_operador" on public.feiras;
create policy "altera_dono_operador" on public.feiras for update to authenticated using ((select public.papel_do_usuario()) = any (array['dono', 'operador'])) with check ((select public.papel_do_usuario()) = any (array['dono', 'operador']));
drop policy if exists "apaga_dono_operador" on public.feiras;
create policy "apaga_dono_operador" on public.feiras for delete to authenticated using ((select public.papel_do_usuario()) = any (array['dono', 'operador']));

-- Escopo (pedido do Áxel em 16/10): o cliente trabalha com PLÁSTICO. Ferragens, aço, alumínio, madeira e lojas não são cliente.
update public.config set valor = jsonb_set(jsonb_set(jsonb_set(valor,
  '{escopo}', to_jsonb('Indústria que fabrica, metaliza, pinta, enverniza ou dá acabamento em peças de PLÁSTICO (injeção, sopro, extrusão, termoformagem, metalização a vácuo ou galvanoplastia em plástico, pintura de plástico), ou que imprime em 3D com resina. Inclui componentes plásticos para calçados e moda (saltos, solados, enfeites), embalagens plásticas de cosméticos, peças plásticas automotivas e de linha branca, puxadores e componentes plásticos para móveis.'::text)),
  '{fora_do_escopo}', '["ferragens, metalurgia, peças de aço, alumínio ou zamac sem plástico", "madeira, MDF, compensados, lâminas e painéis de madeira", "lojas e revendas que vendem ao consumidor final", "fabricantes de móveis de madeira", "tecidos, couros, espumas e colchões", "fabricantes de tintas, vernizes, adesivos e produtos químicos (concorrentes)", "máquinas, ferramentas, softwares e serviços"]'::jsonb),
  '{criterios}', (select jsonb_agg(case when c->>'id' = 'processo' then jsonb_set(c, '{descricao}', '"Injeta, sopra, extruda, metaliza, pinta, enverniza ou dá acabamento em peças PLÁSTICAS, ou imprime em 3D com resina"') else c end) from jsonb_array_elements(valor->'criterios') c))
where chave = 'icp';
