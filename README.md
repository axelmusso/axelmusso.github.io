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
- CRM (Fase 2): empresas, contatos, negócios no funil (9 etapas: Novo, Qualificado, Contatado, Follow-up, Respondeu, Telefone obtido, Com o Áxel, Cliente, Perdido; Follow-up desde 22/10/2026: recebeu um e-mail seguinte da cadência sem responder; respondendo ao 1º e-mail ou a um follow-up, vai para Respondeu), linha do tempo de interações e tarefas. Mudar a etapa de um negócio grava sozinho na linha do tempo da empresa. Tabela `config` guarda o botão de parada (`sistema_ativo`, começa desligado) e os tetos de gasto (US$ 1,30/dia, US$ 40/mês).
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
- O dossiê traz: funil, negócios parados, interações e e-mails (90 dias), perdas, tarefas, empresas por status e setor; prospecção (e-mails por status e passo, respostas por classificação, qualificadas por segmento); concorrência (coleta de cada concorrente, matriz e lacunas da última análise fechada, propostas de conteúdo); site (visitas de 30 dias por canal, origem das visitas de IA, páginas mais vistas, leads do formulário); e os aprendizados da memória parecidos com o tema. Assim dá para perguntar, por exemplo, "como nos posicionar contra a Next Coatings?".
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

**Parte B (envio):** pelo Resend, de `Fernando - Corquímica <fernando@comercial.corquimica.com.br>`. Só sai e-mail aprovado na tela, em dia útil das 8h às 18h (Brasília), dentro do aquecimento (10/dia, +20% ao dia, teto 50) e fora da lista de não contatar. Cadência: dia 0, +3 dias úteis, dia 7, dia 14 e até 3 retomadas a cada 60 dias; para quando a empresa responde.
- Função `envio`: status, enviar aprovados (com botão de teste fora do horário, só para o dono, que não inicia o aquecimento), enviar um só agora (botão "Aprovar e enviar agora" do rascunho: horário e limite valem; terça a quinta e cota de ex-clientes, não), preparar próximos passos, classificar e responder.
- Função `resend-webhook` (pública, assinada com `RESEND_WEBHOOK_SECRET`): entrega, bounce, spam e respostas recebidas. Resposta vira item na caixa de respostas e uma cópia vai para `email_copia_respostas`. Mensagens da própria caixa de cópias são ignoradas (evita loop).
- Função `descadastro` (pública): link de cada e-mail e o botão "cancelar inscrição" do Gmail/Outlook; grava na hora.
- Segredos no Supabase: `RESEND_API_KEY` (acesso completo, para ler as respostas recebidas) e `RESEND_WEBHOOK_SECRET`.
- Testado de ponta a ponta em 15/10/2026 com um endereço interno (dados de teste apagados).

**Parte E (outros contatos):** a empresa, prospect ou ex-cliente, só sai da tentativa quando alguém responde ou acabam os e-mails dela.
- Ordem de tentativa (`tipoEmail` em `_shared/redacao.ts`): área de decisão (compras@, producao@, diretoria@...) → pessoas → caixas gerais (contato@...) → nota fiscal e financeiro (nfe@, xml@, financeiro@...). noreply@ e afins nunca recebem. Caixa geral ou fiscal recebe o pedido de encaminhar para quem cuida de compras ou produção.
- Depois do 4º e-mail sem resposta (+5 dias úteis), a cadência passa para o próximo e-mail ainda não tentado e recomeça do 1º e-mail. Bounce e resposta automática de "caixa não monitorada / só NF" trocam na hora.
- Sem e-mail novo, `_shared/contatos.ts` procura no site da empresa (pelo domínio do e-mail que já temos, respeitando o robots.txt) e no cadastro público do CNPJ (BrasilAPI), no máximo a cada 30 dias; cada contato achado guarda fonte e data. E-mail do CNPJ com cara de escritório de contabilidade é ignorado.
- Acabaram os e-mails: segue para as retomadas de 60 dias, como antes.

**Feiras (16/10/2026):** fonte constante de leads. A tabela `feiras` guarda cada feira do setor: onde está a lista pública de expositores, a situação (lista pública, sem lista on-line, a verificar, fora do escopo), a próxima edição e a última leitura. A aba Prospecção mostra a tabela, marca "reler" quando a lista foi lida há mais de 60 dias e tem o botão "Ler lista" (`descobrir_url` com `feira_id`, que grava a origem `feira:<nome>`).
- Já lidas: FIMMA Brasil 2025 e Inspiramais (janeiro de 2027, só materiais de enfeites, saltos e solados, metalização e embalagem). SEINCC e FIMEC não publicam a lista: pedir ao organizador.
- Quem já está no cadastro (cliente, ex-cliente) ou na lista de não contatar é pulado.

**Escopo e nota ICP por segmento (16/10/2026):** o cliente trabalha com PLÁSTICO. A IA não dá mais nota: ela só classifica a empresa num **segmento**, com a frase do site que prova, e o banco calcula a nota pela tabela `config.icp.segmentos` (gatilho `aplicar_segmento_icp`). Fora das UFs prioritárias, 10 pontos a menos.

| Grupo | Nota | Segmentos |
|---|---|---|
| Alvo | 100 | Metalização |
| Alvo | 95 | Fitas de borda (PVC, ABS, melamínica), saltos e solados, enfeites e bijuterias, pés de sofá, pés de cama e puxadores de móveis em plástico, zamac ou aço (ex. AKEO), embalagens de cosméticos, revestimentos de PET/PVC (ex. Lamiecco, Allparts, Plasbil), bebedouros, chuveiros elétricos e sifões de plástico (ex. Acquabios) |
| Bom | 80 | Gráficas com verniz UV, peças plásticas com acabamento, impressão 3D com resina, peças plásticas automotivas e de eletrodomésticos |
| Médio | 55 | Fábrica de calçados prontos, injeção ou sopro de peças plásticas visíveis, sem acabamento |
| Verificar | 40 | Sem informação suficiente |
| Fora | 0 | Vidro, madeira e móveis, lojas e revendas, ferragens e metalurgia, têxtil e couro, papel, químicos concorrentes, máquinas e serviços, plástico técnico ou oculto (tacos de salto, rodízios, sapatas, núcleos estruturais, painéis acrílicos) |

- Na ficha da empresa (CRM → Empresas), o seletor "Segmento" corrige a classificação; a escolha do Áxel (`icp_manual`) vale sobre a IA nas próximas qualificações.
- Segmentos com perfil de produto (metalização, fita de borda e gráfica → verniz, 3D → resina) passam esse perfil ao prospect.
- Clientes e ex-clientes da base que compram verniz para metalização ou resina 3D já entram com o segmento; os demais são qualificados pelo site.
- Duplicatas: `empresas.nome_chave` (nome sem acento nem pontuação) evita que um cliente da base volte como prospect de feira.
- Regras do prompt vindas das correções do Áxel: tacos de salto, núcleos estruturais e painéis acrílicos = plástico técnico (fora); pés de sofá, pés de cama e puxadores de móveis (plástico, zamac ou aço) = alvo prioritário, mas rodízios e sapatas não; impressão digital UV é tinta, não verniz; o setor informado pela feira vale como evidência; sem site, nome com alumínio/aço/metal/madeira/vidro já indica segmento fora.
- Metalização é só em plástico (vácuo ou galvanoplastia em plástico). Galvanização, zincagem, anodização e cromo em metal ficam fora (ferragens e metalurgia), regra do Áxel.
- Dados do CNPJ: a ação `dados_cnpj` da prospecção completa CNAE principal e secundários, situação cadastral, cidade, UF e porte (cadastro público via BrasilAPI). Empresa com CNPJ baixado, inapto, suspenso ou nulo não recebe rascunho.
- Google Maps (função `maps`, Places API New): `buscar` cadastra empresas de uma busca como "metalização em plástico Novo Hamburgo RS" (origem `maps:<termo>`); `achar_site` procura o site de quem não tem, pelo nome e cidade. Limite próprio de 150 consultas por dia (`config.maps_limite_dia`), contadas em `execucoes_agente` (provedor `google_maps`, custo 0), porque o Google não deixou travar a cota nesta conta. Instagram, Facebook e Linktree não contam como site. A chave fica no segredo `GOOGLE_MAPS_API_KEY`, restrita à Places API. Busca por segmento (21/10/2026): a rotina descoberta monta "<segmento> em <cidade>" com `config.maps_segmentos` e `config.maps_cidades` (editáveis), cidade por cidade, e a mesma busca só se repete depois de 90 dias (conta pelos jobs `maps_buscar_segmento`). As empresas novas passam pelo dedupe de sempre (id do Google, domínio, nome sem acento, lista de supressão) e entram como prospect para a qualificação; lojas, revendas e oficinas de carro (pelo tipo do lugar no Google) ficam de fora. O teste grátis do Google (US$ 300) vence 90 dias após 17/10/2026: antes de ativar a conta paga, revisar o limite.
- Busca de feiras: tarefa agendada no app (dias 1 e 15 de cada mês) procura feiras novas e listas de expositores, e atualiza a tabela `feiras`; a importação continua no botão "Ler lista".

**E-mail do site:** com domínio próprio, só entram e-mails do domínio da empresa (Gmail e afins no site costumam ser de representantes), e a qualificação também lê a página de contato.

## Concorrência (Fase 7)
Tela **Concorrência** e função `concorrencia`. Tabelas `concorrentes`, `coletas_concorrente` e `analises_mercado`, com RLS (lê quem tem papel; coletas e análises só a função grava).
- Coleta: home, até 5 páginas de produto, 2 de blog, 1 de preço, 1 institucional e o `llms.txt`, escolhidas pelo sitemap e pelos links da home, só dentro do caminho cadastrado (ex.: `weg.net/tintas/`). Guarda título, H1, descrição, texto e os tipos schema.org. O hash (SHA-256) é do conteúdo visível, não do HTML bruto, que muda a cada carga; só grava uma nova versão quando o hash muda, e marca `mudou`.
- Respeita robots.txt e se identifica como `CorquimicaBot`. Site que recusa robô fica com o motivo em `ultimo_erro`: não disfarçamos o robô de navegador. Em 18/10/2026, Lechler (HTTP 520 só para robôs) e WEG (HTTP 403 para tudo) bloqueiam.
- Site montado no navegador (ex.: Sayerlack) devolve a mesma casca em várias páginas: a coleta guarda só uma.
- Análise: Claude (estrategista) monta matriz, lacunas e propostas; ChatGPT (cético) confere contra o dossiê; Claude (relator) fecha em JSON. Cada passo é uma chamada, como no Conselho. Toda afirmação cita a URL; sem fonte vira "HIPÓTESE:"; o que a Corquímica precisa informar (pedido mínimo, prazo, certificações) vai em "dados que faltam".
- O dossiê traz também o nosso site (`llms-full.txt`, só português), para a lacuna ser algo que nem nós respondemos.
- Rascunho de página (regra do dono, 19/10/2026): sai pronto, sem `[PREENCHER]`.
  - Fato da Corquímica vem só do site; a explicação técnica vem do conhecimento geral do setor, sem números.
  - O que é particular da empresa e não está no site fica no nível geral, para não expor detalhe interno.
  - No rodapé, "Para o técnico conferir" lista as afirmações técnicas que valem uma olhada.
- A análise recebe as propostas já feitas (`ja_propostas`) e só propõe tema novo; o banco barra repetição de URL ou de tema.
- Frequência: mensal e quando alguma página mudar. Até a Fase 9, pelos botões da tela, que mostra quantas páginas mudaram desde a última análise.

## Google e IAs (Fase 8)
O site já nasceu com a base técnica (veja o topo deste README). A Fase 8 acrescentou:
- **LocalBusiness:** a Organization também é LocalBusiness, com o endereço da fábrica.
- **Sem marcação Product:** as páginas de produto não usam `Product`, porque o Google exige preço, avaliação ou oferta e a Corquímica não publica preço. O teste da publicação recusa `Product` sem isso.
- **Teste de página órfã:** a publicação falha se alguma página não receber link de outra.
- **IndexNow:** a chave fica em `site.json` e no arquivo `<chave>.txt` na raiz; é pública por definição. Depois de cada publicação, o job `indexnow` avisa o Bing das páginas com `lastmod` dos últimos 2 dias. Na publicação manual, avisa todas.
- **Medição própria:** `assets/visita.js` grava visitas pela função `registrar_visita`, sem cookie, sem IP e sem dados do aparelho. Guarda só página, dia, canal e o domínio de origem, e só conta em corquimica.com.br.
  - O canal `ia` separa ChatGPT (inclusive pelo `utm_source=chatgpt.com`), Perplexity, Gemini, Copilot, Claude e afins.
  - A política de privacidade foi atualizada nos 3 idiomas.
  - O canal "AI Assistant" do Google Analytics não foi ligado: exige conta do Áxel e aviso de cookies. A medição própria cobre isso desde o primeiro dia.
- **Fila de conteúdo:** tabela `propostas_conteudo`. Cada análise fechada da Fase 7 entra na fila por gatilho no banco.
  - A função `conteudo` (`rascunhar`) escreve a página em Markdown só com fatos do `llms-full.txt`. O que falta vira `[PREENCHER: ...]`.
  - Na tela **Conteúdo e SEO**, aprovar ou descartar é humano. Aprovado vira página por PR, nunca direto no ar.
- **Search Console e Perfil da Empresa no Google:** o Áxel faz com a conta dele (passo 5 acima). Nome, endereço e telefone devem ser iguais aos de `site.json`.

## Rodar 24 horas (Fase 9)
- **Fila:** tabela `jobs` (pendente, rodando, feito, erro, cancelado).
  - `pegar_job()` trava a linha com `FOR UPDATE SKIP LOCKED`.
  - `terminar_job()` devolve à fila com espera de 5, 10 e 20 min; na 3ª falha, o job vira erro.
  - Job rodando há mais de 20 min é dado como perdido.
- **Agenda:** pg_cron chama a função `worker` a cada 5 min, via pg_net, com um segredo guardado no Vault (`worker_segredo`). O worker confere o segredo no banco; a chave secreta nunca vai para o cron.
- **Como o worker chama as outras funções:** com a chave do servidor. `usuario()` em `_shared/http.ts` reconhece essa chave como papel `sistema`, aceito por envio, prospecção, Maps, memória e concorrência.
- **Rotinas fixas** (o cron só põe o job na fila; horários de Brasília):

  | Quando | Rotina | O que faz |
  |---|---|---|
  | Diária, 6h | busca com IA | pesquisa na web empresas dos 4 segmentos prioritários (metalizadoras a vácuo, revestimentos PET/PVC, embalagens de cosméticos, injetoras que pintam ou metalizam), 3 combinações de segmento e estado por dia nos 6 estados de foco (`config.busca_ia`); cada empresa achada entra sem nota e vai para a qualificação. Teto próprio de US$ 0,45/dia, dentro do teto geral. **Desligada desde 24/10/2026** (`config.busca_ia.ativo = false`): em 4 testes custou US$ 0,94 e achou 1 empresa; a pesquisa da API traz diretórios e empresas de fora, e a lista de memória da IA (`acao: 'sugerir_ia'`) inventa nomes. Para nicho industrial a fonte é a Receita por CNAE (`importar_receita`, em ondas) |
  | Diária, 7h | descoberta | site pelo Maps de até 100 empresas da Receita sem site; o que sobra do limite do dia (até 30) vai para buscas por segmento e cidade |
  | Seg a sex, 8h às 17h, de hora em hora | cadência | rascunha os próximos e-mails, envia os aprovados, classifica respostas sem classificação e completa a fila até 30 rascunhos para aprovar (`config.rascunhos_alvo`) |
  | Diária, 21h | enriquecimento | qualifica até 120 empresas com site ainda sem nota |
  | Segunda, 6h | concorrência | coleta dos concorrentes; meia hora depois, análise nova se algo mudou ou se a última tem mais de 28 dias |
  | Segunda, 6h | memória | consolidação |
  | Diária, 8h | relatório | e-mail para o dono com enviados, respostas, telefones, aprovações pendentes, gasto e erros |

- **Regiões da prospecção** (regra do dono, 15/10/2026): Brasil todo, com foco em RS, SC, PR, SP, MG e RJ. Receita, Maps (`config.maps_cidades`, 51 polos alternando os estados desde 24/10/2026) cobrem os 6 estados. 1ª onda da Receita em 24/10/2026: 1.405 metalizadoras (CNAE 2539-0/02, sem os nomes de serviço só em metal).
- **Sempre 30 rascunhos para aprovar:** a cadência conta os e-mails esperando aprovação e escreve só a diferença.
  - Usa o 1º e-mail das melhores empresas ainda não contatadas, da maior nota para a menor, pela função `candidatas_primeiro_email`.
  - Segue as regras do botão "Escrever 1º e-mail": nota mínima, gancho e CNPJ ativo; filial de cliente ativo fica de fora.
  - Empresa que não der certo (sem e-mail liberado ou sem gancho) sai da lista por 30 dias (`primeiro_email_tentado_em`).
- **Tipo de cada rascunho:** a tela Prospecção mostra se é 1º contato, continuação da cadência, retomada de ex-cliente ou pessoa indicada. As respostas a quem escreveu ficam separadas, no topo da tela (Respostas de clientes).
- **O que a Corquímica faz, em uma frase** (21/10/2026): todo 1º e-mail diz o que a Corquímica fabrica ligado ao segmento do cliente (ex.: "vernizes UV, lacas e tintas para o acabamento de saltos e solados"), sem listar os outros segmentos; nunca só "indústria química". Na tela, os e-mails para aprovar têm o filtro Não aprovados / Aprovados / Todos, com a contagem.
- **Só injeta não é cliente** (20/10/2026): a qualificação diz se a empresa dá acabamento na peça (`empresas.acabamento`: sim, nao, incerto), pela leitura do site. Quem só injeta, sopra ou extruda e não pinta, não enverniza nem metaliza vai para o segmento `injecao_plastica`, agora com nota 0. Só imprimir (serigrafia, tampografia, impressão UV, adesivo, hot stamping) não conta como acabamento. Peça plástica genérica (automotiva, eletrodoméstico, injetada com acabamento) sem prova de acabamento vira `sem_informacao`, abaixo da nota mínima. Empresa que cai abaixo da nota mínima perde os rascunhos que esperavam aprovação, e a cadência dela para; e-mail já aprovado e não enviado volta para aprovação, com aviso.
- **Respostas de clientes vêm primeiro** (20/10/2026): a cada 5 minutos o worker põe na frente da fila a classificação das respostas que chegaram e o envio das que o dono aprovou. Aprovada de segunda a sexta, das 8h às 18h, a resposta sai na hora (ou em até 5 minutos); fora disso, sai às 8h do próximo dia útil, antes de qualquer outro e-mail. Respostas não contam no limite do aquecimento. Enquanto houver resposta esperando rascunho, nenhum rascunho novo é escrito, e os rascunhos novos param em 85% do teto de IA do dia para sobrar para as respostas. O relatório das 8h abre com as respostas esperando aprovação.
- **Ordem dos e-mails** (22/10/2026), nos rascunhos e nos envios: 1) respostas a clientes; 2) follow-ups da cadência; 3) 1º contato com empresas novas, da maior nota ICP para a menor; 4) 1º contato com ex-clientes, no máximo 15% (dos 30 rascunhos e do limite de envio do dia, com mínimo de 1 envio). Ex-cliente aprovado que passa dos 15% espera o dia seguinte, sem precisar aprovar de novo. Follow-ups saem de segunda a sexta, como as respostas; só o 1º e-mail espera de terça a quinta (desde 22/10/2026).
- **Nada sai sem aprovação:** o envio só manda e-mails aprovados, no horário e no limite do aquecimento (regras da função `envio`).
- **Botão de parada:** `config.sistema_ativo`. Desligado, o cron não chama o worker, as rotinas não entram na fila, o worker para antes do próximo job e a IA recusa chamadas automáticas. O botão fica na tela **Operação**, junto com a fila.
- **Diagnóstico:** o worker chamado com `{"diagnostico": true}` e o segredo testa o acesso como sistema (status do Maps e do envio), mesmo parado. Para testar pelo banco, use `net.http_post` com o segredo do Vault.

## Operação à vista (Fase 10)
- **Tela Operação:**
  - robôs ligados ou parados, com o botão;
  - alertas ativos;
  - e-mails dos últimos 30 dias: enviados, entregues, respondidos, telefones obtidos, reclamações de spam, bounces;
  - aprovações pendentes e aprovados esperando o envio;
  - empresas novas por origem (inclui o formulário do site);
  - gasto de IA contra o teto;
  - fila de trabalhos;
  - alertas enviados;
  - últimas 50 execuções de agente com custo e duração.

  Os números vêm de `painel_operacao()`.
- **Alertas por e-mail ao dono** (`condicoes_alerta()`):
  - gasto de IA a partir de 80% do teto (dia ou mês);
  - reclamação de spam acima de 0,1% dos entregues em 30 dias;
  - mais de 50 jobs em erro em 24 h;
  - qualquer agente com 5 falhas seguidas.
- **Como os alertas saem:** o worker confere a cada execução (sem agendamento novo). Cada alerta fica em `alertas` com chave tipo + alvo + dia, então sai no máximo 1 e-mail por dia para cada um.
- **Limite dos alertas:** com os robôs parados, o cron não chama o worker, então os alertas também não saem. A tela mostra os alertas ativos de qualquer forma.

## Ciclo autônomo (19/10/2026)
A plataforma questiona o próprio desempenho, propõe ações, mede o resultado e aprende sozinha. Nada novo sai para fora sem aprovação.
- **Descarte com motivo.** Ao descartar um rascunho, o dono escolhe e escreve o motivo:
  - "a empresa não serve": a empresa sai de todas as rotinas (descartada, cadências suprimidas, negócio perdido);
  - "o e-mail não está bom": o robô reescreve na hora, levando o motivo em conta, e o novo rascunho volta para aprovação, marcado "Refeito com o seu motivo".
  - Propostas de conteúdo funcionam igual: "o tema não serve" ou "refazer com ajuste".
- **O que o dono ensina vale na hora.** Os motivos recentes de "refazer" entram nas instruções do redator. As empresas descartadas, com o motivo, entram nas instruções de quem qualifica.
- **Indicadores.** `indicadores(dias)` calcula:
  - resposta, interesse e bounce;
  - descarte de rascunhos;
  - qualidade das empresas que entram (nota ≥ mínima e com gancho);
  - visitas (total, IA, busca) e leads;
  - conteúdo parado e páginas de concorrentes que mudaram.
- **Revisão semanal** (segunda, 3 h depois da coleta dos concorrentes, por volta das 9h):
  - aprende com os motivos de descarte: padrões que se repetem viram memória com confiança 0,65;
  - a cada 4 semanas, grava na memória o segmento ou passo com resposta muito fora da média;
  - compara os indicadores com as 4 semanas anteriores; havendo sinal, abre o Conselho sozinha (`gatilho = revisao_semanal`). O Conselho também critica a qualidade das empresas que entram e a rota de prospecção;
  - com 3 ações esperando decisão, não abre outra sessão.
- **Ações propostas** (`acoes_propostas`): o relator fecha com até 3 ações de tipos fechados, que a plataforma aplica sozinha quando o dono aprova:
  - nota de segmento ou nota mínima: recalcula as empresas;
  - regra de qualificação (`config.icp.regras_extras`) ou de redação (`config.redacao_regras`);
  - nova proposta de conteúdo;
  - tarefa para uma pessoa.
  - Recusar exige motivo, que o próximo Conselho lê para não repetir.
- **Medição.** Toda ação guarda o número de antes. Na data (14 a 90 dias), `medir_acoes()` mede de novo; com amostra pequena, adia até 2 vezes. O resultado (melhorou, piorou, igual) vira memória.
- **Orçamento.** A reflexão (Conselho, descartes, consolidação) tem teto próprio (`config.teto_reflexao_mensal_usd`, US$ 6/mês). Só roda com o gasto do dia abaixo da metade do teto diário; a rotina vem primeiro.
- **Telas:** Conselho (ações para aprovar, histórico, revisões semanais), Prospecção e Conteúdo (descarte com motivo) e Operação (contagem de ações esperando). O relatório das 8h traz as ações pendentes e as medidas.
- **Correção da fila.** A trava contra job duplicado passou a valer só para jobs esperando. Antes, a continuação que um job põe na fila (análise de concorrência, preparo e envio em lotes, Conselho) era descartada sem erro.

## Segurança
- Site estático, sem servidor nem login. Nenhuma dependência npm e nenhum script de terceiros.
- Política de segurança (CSP) em todas as páginas: só scripts do próprio site, fontes do Google e conexão com o Supabase do formulário.
- Supabase com RLS: visitantes só **inserem** contatos e **leem** artigos publicados. Backups, versões e contatos só são acessíveis com a chave secreta.
- Limite no banco contra spam do formulário: até 20 contatos por hora e nenhum contato repetido em menos de 1 minuto (`privado.limitar_leads`).
- Ações do GitHub fixadas pelo código exato; o Dependabot abre um pull request mensal quando há atualização.
- Branch `main` protegida contra apagamento e reescrita do histórico.
- Recomendado: verificação em duas etapas no GitHub e no Supabase, e *Enforce HTTPS* no GitHub Pages ao configurar o domínio.
