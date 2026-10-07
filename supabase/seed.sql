-- Artigos iniciais como RASCUNHO. Para publicar: marque published = true e preencha published_at.
insert into public.articles (slug,title,description,body_md,category,category_label,faq,published,published_at) values ('verniz-uv-base-e-top-coat-para-que-serve-cada-um','Verniz UV Base e Top Coat: para que serve cada um','Entenda a função do verniz UV Base e do Top Coat no acabamento metalizado de peças plásticas e quando usar cada um.','O acabamento metalizado em plástico costuma usar dois vernizes UV com funções diferentes. O **verniz UV Base** vai antes da metalização. O **verniz UV Top Coat** vai depois.

## O que faz o Verniz UV Base

A Base nivela a superfície da peça e prepara o plástico para receber o metal. Uma base bem aplicada ajuda a metalização a ficar uniforme e com brilho.

## O que faz o Verniz UV Top Coat

O Top Coat protege a camada metalizada, que é muito fina. Ele também define o acabamento final, em brilho ou fosco, e pode receber corante para dar cor ao efeito metálico.

## Em resumo

- Base: antes da metalização, prepara e nivela.
- Top Coat: depois da metalização, protege e dá o acabamento.
- Cada substrato (ABS, PS, PP, Zamac, TPU) pede uma versão adequada do verniz.

Veja as páginas de [Verniz UV Base](/produtos/verniz-uv-base/) e [Verniz UV Top Coat](/produtos/verniz-uv-top-coat/).','verniz-uv-base','Verniz UV','[{"q":"Posso usar só o Top Coat, sem a Base?","a":"Depende da peça e do substrato. Em muitos casos a Base é necessária para um bom resultado. Teste na sua peça com a equipe técnica da Corquímica."},{"q":"Top Coat serve para peças sem metalização?","a":"Sim, ele também pode ser usado como acabamento de proteção. Fale com o comercial para indicar a versão certa."}]'::jsonb,false,null) on conflict (slug) do nothing;
insert into public.articles (slug,title,description,body_md,category,category_label,faq,published,published_at) values ('metalizacao-a-vacuo-em-plastico-etapas-do-processo','Metalização a vácuo em plástico: etapas do processo','Veja as etapas da metalização a vácuo em plástico, do preparo da peça ao verniz de proteção, e onde entra cada produto.','A metalização a vácuo deposita uma camada fina de metal sobre a peça dentro de uma câmara. O resultado depende de todas as etapas antes e depois dela.

## Etapas

1. Limpeza da peça.
2. Tinta ou primer, quando o substrato exige.
3. Verniz UV Base, para nivelar a superfície.
4. Metalização a vácuo.
5. Verniz UV Top Coat, para proteger a camada metalizada.

## Por que o Top Coat importa

A camada de metal é muito fina e se danifica com facilidade. O Top Coat protege contra riscos e dá o acabamento final.

Conheça os [vernizes UV da Corquímica](/produtos/) para cada etapa.','verniz-uv-top-coat','Metalização','[{"q":"Todo plástico precisa de primer?","a":"Não. O primer entra apenas em alguns substratos. O teste na peça define."}]'::jsonb,false,null) on conflict (slug) do nothing;
insert into public.articles (slug,title,description,body_md,category,category_label,faq,published,published_at) values ('laca-ou-verniz-uv-como-escolher','Laca ou verniz UV: como escolher para a sua peça','Compare laca e verniz UV em secagem, acabamento e processo para escolher a opção certa para a sua peça plástica.','Laca e verniz UV são acabamentos diferentes e atendem processos diferentes.

## Diferenças principais

- A **laca** seca por evaporação do solvente e não precisa de equipamento de cura UV.
- O **verniz UV** cura sob luz ultravioleta e exige o equipamento de cura.

## Como decidir

Considere o material da peça, o acabamento desejado, o volume de produção e o equipamento que você já tem. A equipe da Corquímica indica o sistema e a formulação, inclusive o solvente adequado.

Veja a página de [Lacas](/produtos/lacas/) e de [Verniz UV Top Coat](/produtos/verniz-uv-top-coat/).','lacas','Lacas','[{"q":"Preciso de estufa UV para usar laca?","a":"Não. A laca seca por evaporação do solvente."}]'::jsonb,false,null) on conflict (slug) do nothing;
