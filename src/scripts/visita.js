// Contagem de visitas sem cookie e sem identificar ninguém: só a página e o domínio de onde a pessoa veio.
// Serve para separar quem chega por assistente de IA (ChatGPT, Perplexity, Gemini...) de quem vem do Google.
(function () {
  if (location.hostname !== 'corquimica.com.br') return; // só o site oficial conta (prévia e testes não)
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ''; };
  var url = meta('cq-supabase-url'), chave = meta('cq-supabase-key');
  if (!url || !chave) return;
  var origem = '';
  try { if (document.referrer) origem = new URL(document.referrer).hostname; } catch (_) {}
  var utm = new URLSearchParams(location.search).get('utm_source') || '';
  fetch(url + '/rest/v1/rpc/registrar_visita', {
    method: 'POST', keepalive: true,
    headers: { apikey: chave, Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_caminho: location.pathname, p_origem: origem || null, p_utm: utm.slice(0, 60) || null })
  }).catch(function () {});
})();
