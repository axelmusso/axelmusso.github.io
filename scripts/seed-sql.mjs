// Gera supabase/seed.sql a partir de src/data/articles.seed.json (todos entram como rascunho).
import fs from 'node:fs';
const a = JSON.parse(fs.readFileSync('src/data/articles.seed.json', 'utf8'));
const q = (s) => "'" + String(s ?? '').replace(/'/g, "''") + "'";
const sql = a.map((x) => `insert into public.articles (slug,title,description,body_md,category,category_label,faq,published,published_at) values (${q(x.slug)},${q(x.title)},${q(x.description)},${q(x.body_md)},${q(x.category)},${q(x.category_label)},${q(JSON.stringify(x.faq || []))}::jsonb,false,null) on conflict (slug) do nothing;`).join('\n');
fs.writeFileSync('supabase/seed.sql', '-- Artigos iniciais como RASCUNHO. Para publicar: marque published = true e preencha published_at.\n' + sql + '\n');
console.log('supabase/seed.sql gerado com', a.length, 'artigos');
