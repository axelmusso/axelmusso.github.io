// Conteúdo e SEO (Fase 8): medição das visitas (com o canal de IA separado), situação técnica do site
// e a fila de propostas de conteúdo que vêm das lacunas da Concorrência.
// O agente escreve o rascunho; aprovar ou descartar é decisão humana, e o aprovado vira página por PR.
(function () {
  var api, perfil, tela;
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var q = encodeURIComponent;
  var dataHora = function (s) { return s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; };
  var podeEscrever = function () { return perfil.papel === 'dono' || perfil.papel === 'operador'; };
  var CANAL = { ia: 'Assistentes de IA', busca: 'Buscadores', social: 'Redes sociais', email: 'E-mail', direto: 'Direto', outro: 'Outros sites' };
  var STATUS = { proposta: 'Proposta', rascunho: 'Rascunho pronto', aprovada: 'Aprovada (vira PR)', publicada: 'Publicada', descartada: 'Descartada' };
  var escrevendo = {};
  var mensagem = null;

  function aviso(texto, ruim) {
    mensagem = texto ? [texto, ruim] : null;
    var a = document.getElementById('aviso-cont');
    if (!a) return;
    a.className = 'aviso' + (ruim ? ' ruim' : '');
    a.textContent = texto || '';
    a.hidden = !texto;
  }
  // Marcadores [PREENCHER: ...] ficam destacados: é o que a Corquímica precisa informar antes de publicar.
  var marcar = function (t) { return esc(t).replace(/\[PREENCHER:([^\]]*)\]/g, '<b class="hipotese">[PREENCHER:$1]</b>'); };
  var lista = function (itens) { return (itens || []).length ? '<ul>' + itens.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : ''; };

  function render() {
    return Promise.all([
      api('/rest/v1/rpc/resumo_visitas', { metodo: 'POST', corpo: { p_dias: 30 } }),
      api('/rest/v1/propostas_conteudo?select=*&order=criado_em.desc&limit=100'),
    ]).then(function (r) {
      var v = r[0] || {}, props = r[1];
      var canais = v.por_canal || {}, total = Object.keys(canais).reduce(function (s, k) { return s + canais[k]; }, 0);
      var abertas = props.filter(function (p) { return p.status !== 'descartada' && p.status !== 'publicada'; });
      var fechadas = props.filter(function (p) { return p.status === 'descartada' || p.status === 'publicada'; });

      tela.innerHTML = '<h1>Conteúdo e SEO</h1>' +
        '<p id="aviso-cont" class="aviso" role="status" hidden></p>' +
        '<h2>Visitas dos últimos 30 dias</h2>' +
        '<p class="mut">Contagem própria, sem cookie e sem IP: só página, dia e o site de origem. Começa a contar quando esta versão for publicada.</p>' +
        (total ? '<table class="tab"><thead><tr><th>Canal</th><th class="num">Visitas</th><th class="num">%</th></tr></thead><tbody>' +
          Object.keys(CANAL).filter(function (k) { return canais[k]; }).map(function (k) {
            return '<tr' + (k === 'ia' ? ' class="destaque"' : '') + '><td>' + (k === 'ia' ? '<b>' + CANAL[k] + '</b>' : CANAL[k]) + '</td><td class="num">' + canais[k] + '</td><td class="num">' + Math.round(100 * canais[k] / total) + '%</td></tr>';
          }).join('') + '</tbody></table>' +
          ((v.ia_por_origem || []).length ? '<p><b>De onde vêm as visitas de IA:</b> ' + v.ia_por_origem.map(function (o) { return esc(o.origem) + ' (' + o.n + ')'; }).join(', ') + '</p>' : '') +
          ((v.ia_paginas || []).length ? '<p><b>Páginas que as IAs mais mandam gente:</b></p><ul>' + v.ia_paginas.map(function (p) { return '<li>' + esc(p.caminho) + ' · ' + p.n + '</li>'; }).join('') + '</ul>' : '')
          : '<p class="mut">Nenhuma visita registrada ainda.</p>') +
        '<h2>Situação técnica do site</h2><ul class="checklist">' +
        '<li>✓ <code>llms.txt</code> e <code>llms-full.txt</code> na raiz, com os fatos da empresa e o mapa das páginas</li>' +
        '<li>✓ <code>robots.txt</code> libera GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot e Google-Extended</li>' +
        '<li>✓ Dados estruturados: Organization e LocalBusiness, WebSite, BreadcrumbList, FAQPage e Article, testados a cada publicação</li>' +
        '<li>✓ Título e H1 únicos, sitemap completo, nenhuma página órfã, data de atualização visível</li>' +
        '<li>✓ IndexNow: o Bing é avisado das páginas que mudaram a cada publicação</li>' +
        '<li>○ Search Console: depende de você (veja o README, passo 5)</li>' +
        '<li>○ Perfil da empresa no Google: nome, endereço e telefone iguais aos do site</li></ul>' +
        '<h2>Fila de conteúdo</h2>' +
        '<p class="mut">Cada lacuna da análise de Concorrência vira uma proposta. O agente escreve o rascunho só com fatos do site e marca em amarelo o que a Corquímica precisa informar. Aprovado, ele vira página por PR: nada vai ao ar sem você.</p>' +
        (abertas.map(cartao).join('') || '<p class="mut">Nenhuma proposta aberta. Rode uma análise na tela Concorrência.</p>') +
        (fechadas.length ? '<details><summary>Publicadas e descartadas (' + fechadas.length + ')</summary>' + fechadas.map(cartao).join('') + '</details>' : '');

      if (mensagem) aviso(mensagem[0], mensagem[1]);
      ligar();
    });
  }

  function cartao(p) {
    var botoes = '';
    if (podeEscrever()) {
      if (p.status === 'proposta' || p.status === 'rascunho') botoes += '<button type="button" class="prim" data-rascunhar="' + esc(p.id) + '"' + (escrevendo[p.id] ? ' disabled' : '') + '>' + (escrevendo[p.id] ? 'Escrevendo… (até 2 min)' : p.rascunho ? 'Reescrever rascunho' : 'Escrever rascunho') + '</button> ';
      if (p.status === 'rascunho') botoes += '<button type="button" data-status="aprovada" data-id="' + esc(p.id) + '">Aprovar</button> ';
      if (p.status === 'aprovada') botoes += '<button type="button" data-status="publicada" data-id="' + esc(p.id) + '">Marcar como publicada</button> ';
      if (p.status !== 'descartada' && p.status !== 'publicada') botoes += '<button type="button" class="link" data-descartar="' + esc(p.id) + '">Descartar ou pedir ajuste</button>';
    }
    var faltam = (p.rascunho || '').match(/\[PREENCHER:/g);
    return '<div class="proposta"><b>' + esc(p.titulo) + '</b> <span class="mut">' + esc(p.tipo || '') + ' · ' + esc(p.url_sugerida || '') + ' · ' + esc(STATUS[p.status] || p.status) + '</span>' +
      (p.lacuna ? '<p><small class="mut">Lacuna:</small> ' + esc(p.lacuna) + '</p>' : '') +
      (p.por_que ? '<p><small class="mut">Por quê:</small> ' + esc(p.por_que) + '</p>' : '') +
      (p.rascunho ? '' : '<small class="mut">Esboço</small>' + lista(p.esboco)) +
      ((p.dados_que_faltam || []).length && !p.rascunho ? '<small class="mut">Dados que a Corquímica precisa fornecer</small>' + lista(p.dados_que_faltam) : '') +
      (p.rascunho ? '<details' + (p.status === 'rascunho' ? ' open' : '') + '><summary>Rascunho' + (faltam ? ' · ' + faltam.length + ' dado(s) a preencher' : '') + ' · ' + esc(dataHora(p.atualizado_em)) + '</summary>' +
        '<pre class="resultado rascunho">' + marcar(p.rascunho) + '</pre><p><button type="button" data-copiar="' + esc(p.id) + '">Copiar texto</button></p></details>' : '') +
      (p.descarte_motivo ? '<p><small class="mut">Motivo do descarte:</small> ' + esc(p.descarte_motivo) + '</p>' : '') +
      ((p.ajustes || []).length && p.status !== 'descartada' ? '<p><small class="mut">Último ajuste pedido:</small> ' + esc(p.ajustes[p.ajustes.length - 1].motivo) + '</p>' : '') +
      (botoes ? '<p>' + botoes + '</p>' : '') +
      // Descarte com motivo: o tema não serve, ou o rascunho volta para o robô com o ajuste pedido.
      (podeEscrever() && p.status !== 'descartada' && p.status !== 'publicada' ? '<form class="descarte" data-painel="' + esc(p.id) + '" hidden><p><b>O que fazer com esta proposta?</b> O motivo ensina os robôs.</p>' +
        '<label class="chk"><input type="radio" name="dtipo" value="refazer" checked> ' + (p.rascunho ? 'Refazer o rascunho com ajustes' : 'Seguir, mas escrever com este ajuste') + '</label>' +
        '<label class="chk"><input type="radio" name="dtipo" value="tema"> O tema não serve: descartar</label>' +
        '<label>Motivo<input name="dmotivo" maxlength="500" placeholder="Ex.: foque em metalização, não em madeira"></label>' +
        '<div class="linha"><button type="submit" class="prim">Confirmar</button><button type="button" class="link" data-cancelar>Cancelar</button></div></form>' : '') + '</div>';
  }

  function ligar() {
    tela.querySelectorAll('[data-rascunhar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.rascunhar;
        escrevendo[id] = true; b.disabled = true; b.textContent = 'Escrevendo… (até 2 min)';
        api('/functions/v1/conteudo', { metodo: 'POST', corpo: { acao: 'rascunhar', proposta_id: id } })
          .then(function (r) { aviso('Rascunho pronto (US$ ' + Number(r.custo).toFixed(4).replace('.', ',') + '). ' + (r.marcadores ? r.marcadores + ' dado(s) para a Corquímica preencher, em amarelo.' : 'Nenhum dado faltando.')); })
          .catch(function (e) { aviso(e.message, true); })
          .then(function () { delete escrevendo[id]; if (location.hash === '#conteudo') render(); });
      });
    });
    tela.querySelectorAll('[data-status]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.status === 'descartada' && !confirm('Descartar esta proposta?')) return;
        api('/rest/v1/propostas_conteudo?id=eq.' + q(b.dataset.id), { metodo: 'PATCH', corpo: { status: b.dataset.status, atualizado_em: new Date().toISOString() } })
          .then(function () {
            aviso(b.dataset.status === 'aprovada' ? 'Aprovada. Para virar página, peça ao Claude Code: "publicar a proposta aprovada" (sai como PR para você revisar).' : 'Atualizado.');
            return render();
          })
          .catch(function (e) { aviso(e.message, true); });
      });
    });
    tela.querySelectorAll('[data-descartar]').forEach(function (b) {
      b.addEventListener('click', function () { var f = tela.querySelector('[data-painel="' + b.dataset.descartar + '"]'); f.hidden = false; f.dmotivo.focus(); });
    });
    tela.querySelectorAll('form[data-painel]').forEach(function (f) {
      f.querySelector('[data-cancelar]').addEventListener('click', function () { f.hidden = true; });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var id = f.dataset.painel, tipo = f.dtipo.value, motivo = f.dmotivo.value.trim();
        if (motivo.length < 3) { aviso('Escreva brevemente o motivo: é com ele que os robôs aprendem.', true); f.dmotivo.focus(); return; }
        f.querySelector('button[type=submit]').disabled = true;
        api('/rest/v1/rpc/descartar_proposta', { metodo: 'POST', corpo: { p_id: id, p_tipo: tipo, p_motivo: motivo } })
          .then(function () {
            if (tipo === 'tema') { aviso('Proposta descartada. O motivo entra na próxima revisão semanal.'); return; }
            escrevendo[id] = true; render();
            return api('/functions/v1/conteudo', { metodo: 'POST', corpo: { acao: 'rascunhar', proposta_id: id } })
              .then(function (r) { aviso('Rascunho reescrito com o seu ajuste (US$ ' + Number(r.custo).toFixed(4).replace('.', ',') + ').'); }, function (e) { aviso('Ajuste registrado, mas o rascunho não saiu agora: ' + e.message + '. Use "Reescrever rascunho" para tentar de novo.', true); })
              .then(function () { delete escrevendo[id]; });
          })
          .then(function () { if (location.hash === '#conteudo') return render(); })
          .catch(function (e) { aviso(e.message, true); f.querySelector('button[type=submit]').disabled = false; });
      });
    });
    tela.querySelectorAll('[data-copiar]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/rest/v1/propostas_conteudo?select=rascunho&id=eq.' + q(b.dataset.copiar)).then(function (r) {
          return navigator.clipboard.writeText(r[0].rascunho);
        }).then(function () { b.textContent = 'Copiado'; }).catch(function () { aviso('Não consegui copiar. Selecione o texto e use Ctrl+C.', true); });
      });
    });
  }

  window.CQ_CONT = {
    abrir: function (ctx) { api = ctx.api; perfil = ctx.perfil; tela = ctx.tela; return render(); },
  };
})();
