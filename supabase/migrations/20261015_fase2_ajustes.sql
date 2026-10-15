-- Fase 2, ajustes apontados pelo verificador do Supabase (desempenho; as permissões não mudam).
-- 1) Índices nas chaves estrangeiras que faltavam.
create index if not exists interacoes_contato on public.interacoes (contato_id);
create index if not exists negocios_responsavel on public.negocios (responsavel);
create index if not exists tarefas_negocio on public.tarefas (negocio_id);
create index if not exists tarefas_responsavel on public.tarefas (responsavel);

-- 2) Regras calculam o papel uma vez por consulta, não por linha: (select ...).
--    E a escrita vira três regras (insert, update, delete) em vez de "for all", que duplicava a de leitura.
drop policy if exists "ve_o_proprio_perfil" on public.perfis;
create policy "ve_o_proprio_perfil" on public.perfis for select to authenticated
  using (id = (select auth.uid()) or (select public.papel_do_usuario()) = 'dono');
drop policy if exists "dono_altera_perfis" on public.perfis;
create policy "dono_altera_perfis" on public.perfis for update to authenticated
  using ((select public.papel_do_usuario()) = 'dono') with check ((select public.papel_do_usuario()) = 'dono');

do $$
declare t text;
begin
  foreach t in array array['empresas', 'contatos', 'negocios', 'interacoes', 'tarefas', 'lista_supressao'] loop
    execute format('drop policy if exists "escreve_dono_operador" on public.%I', t);
    execute format('drop policy if exists "le_quem_tem_papel" on public.%I', t);
    execute format('create policy "le_quem_tem_papel" on public.%I for select to authenticated using ((select public.papel_do_usuario()) is not null)', t);
    execute format($p$create policy "insere_dono_operador" on public.%I for insert to authenticated with check ((select public.papel_do_usuario()) in ('dono', 'operador'))$p$, t);
    execute format($p$create policy "altera_dono_operador" on public.%I for update to authenticated using ((select public.papel_do_usuario()) in ('dono', 'operador')) with check ((select public.papel_do_usuario()) in ('dono', 'operador'))$p$, t);
    execute format($p$create policy "apaga_dono_operador" on public.%I for delete to authenticated using ((select public.papel_do_usuario()) in ('dono', 'operador'))$p$, t);
  end loop;
end $$;

drop policy if exists "le_quem_tem_papel" on public.config;
create policy "le_quem_tem_papel" on public.config for select to authenticated using ((select public.papel_do_usuario()) is not null);
drop policy if exists "dono_altera" on public.config;
create policy "dono_insere" on public.config for insert to authenticated with check ((select public.papel_do_usuario()) = 'dono');
create policy "dono_altera" on public.config for update to authenticated
  using ((select public.papel_do_usuario()) = 'dono') with check ((select public.papel_do_usuario()) = 'dono');
