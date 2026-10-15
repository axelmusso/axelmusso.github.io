# Site Corquímica (multi-página, com Supabase)

Site estático: **cada página é um arquivo HTML próprio** (19 páginas + 66 redirecionamentos do site antigo). Sem dependências, só Node 20+.

## O que o site já tem para Google e IA
- Um arquivo por URL, `title`, `description`, canonical, `lang="pt-BR"` e Open Graph em todas as páginas.
- Dados estruturados (JSON-LD): Organization, WebSite, BreadcrumbList, FAQPage, Article.
- `sitemap.xml`, `robots.txt` (libera Googlebot e os robôs de IA), `llms.txt` e `llms-full.txt`.
- Definição direta no começo de cada página, FAQ por família e segmento, links internos e migalhas de pão.
- Redirecionamentos das URLs antigas do WordPress.
- Testes automáticos (`npm test`): títulos únicos, h1 único, links quebrados, JSON-LD válido, sitemap completo.

## O que ninguém consegue garantir
Posição no Google e citação em respostas de IA dependem também de conteúdo de qualidade, fotos reais, links de outros sites, Google Meu Negócio, Search Console e tempo. Este projeto entrega a base técnica correta. O FAQ no Google hoje raramente vira resultado destacado, mas o markup ajuda buscadores e IAs a entender o conteúdo.

## Modo rascunho x produção
Textos com `[VALIDAR]` e fotos que faltam deixam o build em **rascunho**: `noindex`, `robots.txt` bloqueando tudo e marcas amarelas visíveis. Isso evita publicar algo não validado. A lista está em `docs/PENDENCIAS.md` e `docs/FOTOS.md`.
Quando tudo estiver validado **e** a variável `CUSTOM_DOMAIN` for igual ao domínio de `src/data/site.json` (passo 4 abaixo), o build vira produção sozinho. Antes disso o site segue em rascunho, mesmo sem pendências, para não ser indexado fora do domínio oficial. Para publicar antes, crie a variável `FORCE_PRODUCTION = 1` no GitHub (os marcadores são removidos).

## Contas que você precisa criar
1. **GitHub** (grátis): guarda o código e publica o site (GitHub Pages).
2. **Supabase** (plano grátis serve): guarda os contatos do formulário e os artigos.

Mais nada. Contas e senhas são sempre feitas por você.

## Passo a passo
1. GitHub: crie um repositório (ex.: `site-corquimica`) e envie estes arquivos. No Cowork, conecte o GitHub em Conectores para o envio ser feito por aqui.
2. Supabase: já configurado (tabelas `leads` e `articles`, regras RLS e 3 artigos em rascunho). A URL e a chave pública (anon) ficam em `src/data/supabase.public.json`. A chave *service_role* **nunca** vai para o site.
3. GitHub, **Settings > Pages**: Source = GitHub Actions. Rode o workflow "Publicar site".
4. Domínio: crie a variável `CUSTOM_DOMAIN = corquimica.com.br`, aponte o DNS no Registro.br como o GitHub Pages indicar e ative HTTPS.
5. Search Console: adicione o domínio, envie `https://corquimica.com.br/sitemap.xml` e peça indexação da home.

## Artigos
Table Editor do Supabase > `articles`: marque `published = true` e preencha `published_at`. O site republica todo dia às 06h, ou rode o workflow na hora.

## Fotos
Salve em `src/assets/photos/<slot>.webp` (lista em `docs/FOTOS.md`).

## Comandos
`npm run build`, `npm test`, `npm start` (http://localhost:4173).

## Decisões em aberto
- Endereço canônico sem www (`corquimica.com.br`), igual ao site antigo.
- Linhas antigas fora da nova estrutura (couro e calçadista auxiliares, galvânica, epóxi industrial, betoneira): redirecionam para Produtos ou Moda.
- Palavras-chave: baseadas em concorrentes e pesquisas. Google Trends não foi consultado. Veja `docs/PALAVRAS-CHAVE.md`.

## Versões e backups
Cada publicação gera uma **versão** guardada em dois lugares:
1. **GitHub**: o histórico de commits (aba *Commits*). Cada commit tem data, hora e descrição.
2. **Supabase**: um `.zip` com o código-fonte (`fonte/`) e o site pronto (`site/`) na pasta privada `site-versoes`, registrado na tabela `site_versoes` (data e hora de Brasília, código da versão, descrição, tamanho). Os contatos do formulário também são copiados para `site-versoes/contatos/` todo dia às 6h e a cada publicação manual.

Como nada muda no ar sem uma publicação, a última versão guardada é sempre o estado anterior à próxima mudança.

**Ver as versões:** Supabase → *Table Editor* → `site_versoes` (ordene por `criado_em`).

**Voltar para uma versão:** GitHub → aba *Actions* → **Restaurar versão** → *Run workflow*, informe o código da versão (ex.: `90167e6`) e a origem (`github`; use `supabase` só se o GitHub não tiver a versão). O workflow cria um novo commit com os arquivos daquela versão e republica. O histórico não é apagado: para desfazer, restaure a versão seguinte. As ferramentas de publicação e backup atuais são mantidas mesmo ao voltar para uma versão antiga.

**Chave usada:** o segredo `SUPABASE_SECRET_KEY` do GitHub (Settings → Secrets → Actions) deve ser a chave **service_role** (Supabase → Project Settings → API Keys → Legacy API Keys). Ela só existe no GitHub, nunca no site. Se faltar, a publicação continua e o backup só emite um aviso.

**Espaço:** cada versão ocupa cerca de 4 MB. O plano gratuito do Supabase tem 1 GB de armazenamento (cerca de 200 versões). Apague versões antigas pela pasta `site-versoes` quando necessário.

## Área interna (/app)
Login com e-mail e senha ou link de acesso por e-mail, feito direto na API do Supabase (sem biblioteca). Código em `src/app/`, regras do banco em `supabase/migrations/`.
- A página `/app/` é pública mas vazia: os dados só saem do banco para quem entrou **e** tem papel em `perfis` (`dono`, `operador` ou `leitura`). Quem bate na URL sem login vê só a tela de entrada.
- O primeiro usuário criado vira `dono`. Os seguintes nascem sem papel (sem acesso) até o dono liberar em `perfis`.
- Fica fora do Google: `noindex` e `Disallow: /app/` no robots.txt.
- CRM (Fase 2): empresas, contatos, negócios no funil (8 etapas), linha do tempo de interações e tarefas. Mudar a etapa de um negócio grava sozinho na linha do tempo da empresa. Tabela `config` guarda o botão de parada (`sistema_ativo`, começa desligado) e os tetos de gasto (US$ 1,30/dia, US$ 40/mês).
- Configuração no painel do Supabase (Authentication → URL Configuration): *Site URL* `https://corquimica.com.br/app/` e, em *Redirect URLs*, `https://corquimica.com.br/app/` e `http://localhost:4173/app/`. Depois de criar a conta do dono, desligue *Allow new users to sign up* (Authentication → Sign In / Providers).

## Camada de IA (Fase 3)
- Toda chamada a Claude ou ChatGPT passa por `chamarIA()` em `supabase/functions/_shared/ia.ts`. Nenhum outro arquivo fala com as APIs.
- Modelos: Claude Haiku 5.5 (barato), Sonnet 5.5 (rotina), Opus 5.5 (difícil); OpenAI gpt-6-luna (barato) e gpt-6.1-sol (rotina e difícil). Preços na tabela `PRECOS` do mesmo arquivo; revise quando os fornecedores mudarem.
- Antes de cada chamada: confere `sistema_ativo` (exceto testes manuais do dono) e o gasto do dia e do mês contra os tetos em `config`. Acima do teto, não chama e grava o motivo.
- Cada chamada (ou recusa) vira uma linha em `execucoes_agente` com tokens, custo, duração e erro. Veja na tela Operação do /app.
- Chaves: segredos `ANTHROPIC_API_KEY` e `OPENAI_API_KEY` em Supabase → Edge Functions → Secrets. Nunca no código.
- Publicar uma função: `supabase functions deploy ia-teste` (ou pelo Claude Code, que usa a integração do Supabase).

## Conselho (Fase 4)
- Aba Conselho do /app: Claude (estrategista) propõe, ChatGPT (cético) ataca, e Claude (relator) fecha com decisão, três riscos, próximo passo com número e o que precisa de aprovação humana.
- Os dois recebem o mesmo dossiê, montado por `dossie_conselho()` só com dados do banco; cada bloco traz a fonte. Afirmação sem `[fonte: ...]` tem de vir como HIPÓTESE.
- Máximo de 3 rodadas; se o cético concordar na primeira, fecha ali. Teto de tokens por sessão em `config.teto_tokens_conselho` (60 mil) força o fechamento.
- Edge Function `conselho` roda um passo por chamada; entre passos o dono pode mandar uma orientação, que os dois passam a seguir.
- Cada decisão fechada vira memória com status "proposta" (Fase 5).

## Memória (Fase 5)
- `memoria_aprendizados` guarda padrões com o número que os sustenta e um embedding (pgvector, `text-embedding-3-small`). `memoria_fatos` guarda fatos com fonte e validade.
- Gravação recusa aprendizado sem número ("personalizar funciona melhor") e qualquer coisa parecida com e-mail, telefone, CPF ou CNPJ. Quase igual (semelhança ≥ 0,92) é fundido no existente, somando a amostra.
- Confiança pela amostra somada: 30 envios ≈ 0,38; 150 ou mais ≈ 0,70; +0,05 cada vez que se repete; −0,2 quando um resultado contraria.
- Antes de agir, os agentes leem os parecidos com a tarefa com confiança > 0,6 e não refutados; o id usado fica em `execucoes_agente.memorias` (visível na tela Operação).
- Consolidação (botão na tela Memória; semanal automática na Fase 9): apaga refutados, funde duplicados, confirma o que se repetiu 3 vezes e resume o que mudou em `memoria_consolidacoes`.

## Prospecção (Fase 6)
**Parte A (pronta):** aba Prospecção do /app.
- **Base de clientes:** o dono importa a planilha (.xlsx) na própria tela. Ela é lida no navegador e vai direto para o banco (nunca para o GitHub; `*.xlsx` e `*.csv` estão no `.gitignore`). Compra a partir de 01/06/2026 = cliente ativo, que nunca recebe e-mail (e-mails e domínio entram na `lista_supressao`, motivo `cliente`); os demais viram ex-clientes para retomada. Reimportar atualiza pelo CNPJ, sem duplicar.
- **Descoberta:** cole o endereço de uma página pública (expositores de feira, associados). O robô lê respeitando o robots.txt, ignora a Corquímica e o dono da página, e não duplica empresas.
- **Qualificação:** lê o site público, dá a nota de 0 a 100 pelos critérios em `config.icp`, escreve o motivo e procura um gancho (fato específico). Abaixo de 50, ou sem gancho, não contata. E-mails profissionais publicados no site viram contatos com fonte e data.
- **Redação:** 1º e-mail (ou retomada para ex-cliente) como rascunho, usando a memória. Uma pergunta só no fim, pedindo o celular para seguir pelo WhatsApp. Sem gancho honesto, não escreve.
- **Aprovação:** todo e-mail espera "Aprovar" na tela. A assinatura de Fernando Gutierrez e o link de descadastro entram no envio.

**Parte B (próxima):** envio pelo Resend (`comercial.corquimica.com.br`, já verificado), aquecimento, horário comercial, cadência de 14 dias com retomadas, webhook de entrega/bounce/reclamação, descadastro em um clique, caixa de respostas e medição.

## Segurança
- Site estático, sem servidor nem login. Nenhuma dependência npm e nenhum script de terceiros.
- Política de segurança (CSP) em todas as páginas: só scripts do próprio site, fontes do Google e conexão com o Supabase do formulário.
- Supabase com RLS: visitantes só **inserem** contatos e **leem** artigos publicados. Backups, versões e contatos só são acessíveis com a chave secreta.
- Limite no banco contra spam do formulário: até 20 contatos por hora e nenhum contato repetido em menos de 1 minuto (`privado.limitar_leads`).
- Ações do GitHub fixadas pelo código exato; o Dependabot abre um pull request mensal quando há atualização.
- Branch `main` protegida contra apagamento e reescrita do histórico.
- Recomendado: verificação em duas etapas no GitHub e no Supabase, e *Enforce HTTPS* no GitHub Pages ao configurar o domínio.
