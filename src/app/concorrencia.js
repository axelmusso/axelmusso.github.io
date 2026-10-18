// Concorrência (Fase 7): sites dos concorrentes coletados, matriz de forte e fraco, lacunas e propostas de conteúdo.
// A coleta e a análise rodam na Edge Function "concorrencia"; aqui só se lê o banco e se aperta o botão.
// Todo texto vindo do banco ou da IA passa por esc() antes de virar HTML.
(function () {
  var api, perfil, tela;
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var q = encodeURIComponent;
  var dataHora = function (s) { return s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; };
  var usd = function (v) { return 'US$ ' + Number(v || 0).toFixed(4).replace('.', ','); };
  var fn = function (corpo) { return api('/functions/v1/concorrencia', { metodo: 'POST', corpo: corpo }); };
  var podeEscrever = function () { return perfil.papel === 'dono' || perfil.papel === 'operador'; };
  var NOME_PASSO = { proposta: 'Claude · proposta', critica: 'ChatGPT · crítica', final: 'Claude · versão final' };
  var NIVEL = { alta: 'alta', media: 'média', baixa: 'baixa' };
  var rodando = false;   // laço de "avançar" da análise ativo nesta aba
  var mensagem = null;   // aviso que sobrevive ao redesenho da tela

  function aviso(texto, ruim) {
    mensagem = texto ? [texto, ruim] : null;
    var a = document.getElementById('aviso-conc');
    if (!a) return;
    a.className = 'aviso' + (ruim ? ' ruim' : '');
    a.textContent = texto || '';
    a.hidden = !texto;
  }
  // Destaca as fontes citadas pela IA ([fonte: URL]) e as hipóteses, depois de escapar.
  function marcar(t) {
    return esc(t).replace(/\[fonte:\s*([^\]]+)\]/gi, '<span class="fonte" title="fonte">$1</span>').replace(/HIP[ÓO]TESE:/g, '<b class="hipotese">HIPÓTESE:</b>');
  }
  var lista = function (itens) { return (itens || []).length ? '<ul>' + itens.map(function (i) { return '<li>' + marcar(i) + '</li>'; }).join('') + '</ul>' : '<span class="mut">—</span>'; };

  function render(id) {
    return Promise.all([
      api('/rest/v1/concorrentes?select=*&order=nome'),
      api('/rest/v1/coletas_concorrente?select=concorrente_id,url,mudou,coletado_em&order=coletado_em.desc&limit=3000'),
      api('/rest/v1/analises_mercado?select=id,status,custo_usd,criado_em,passos&order=criado_em.desc&limit=20'),
    ]).then(function (r) {
      var cons = r[0], coletas = r[1], analises = r[2];
      var ultimaFechada = analises.filter(function (a) { return a.status === 'fechada'; })[0];
      var aberta = analises.filter(function (a) { return a.status === 'em_andamento'; })[0];
      var desde = ultimaFechada ? ultimaFechada.criado_em : null;
      var porCon = {};
      coletas.forEach(function (c) {
        var p = porCon[c.concorrente_id] || (porCon[c.concorrente_id] = { urls: {}, mudaram: 0 });
        p.urls[c.url] = true;
        if (c.mudou && desde && c.coletado_em > desde) p.mudaram++;
      });
      var totalMudou = Object.keys(porCon).reduce(function (s, k) { return s + porCon[k].mudaram; }, 0);
      var escolhida = id || (ultimaFechada && ultimaFechada.id);

      tela.innerHTML = '<h1>Concorrência</h1>' +
        '<p class="mut">O robô lê as páginas públicas de cada concorrente (home, produtos, blog, preço, llms.txt e dados estruturados), respeitando o robots.txt. Quando o conteúdo de uma página muda, isso aparece aqui. A análise é feita pela dupla do Conselho: Claude monta, ChatGPT confere, Claude fecha.</p>' +
        '<p id="aviso-conc" class="aviso" role="status" hidden></p>' +
        '<h2>Concorrentes</h2>' +
        '<table class="tab"><thead><tr><th>Concorrente</th><th>Última coleta</th><th class="num">Páginas</th><th class="num">Mudaram*</th><th>Situação</th>' + (podeEscrever() ? '<th></th>' : '') + '</tr></thead><tbody>' +
        cons.map(function (c) {
          var p = porCon[c.id] || { urls: {}, mudaram: 0 };
          return '<tr><td><a href="' + esc(c.site) + '" target="_blank" rel="noopener">' + esc(c.nome) + '</a></td>' +
            '<td>' + esc(dataHora(c.ultima_coleta_em) || 'nunca') + '</td>' +
            '<td class="num">' + Object.keys(p.urls).length + '</td><td class="num">' + p.mudaram + '</td>' +
            '<td>' + (c.ultimo_erro ? '<span class="ruim">' + esc(c.ultimo_erro) + '</span>' : (c.ultima_coleta_em ? 'ok' : '<span class="mut">a coletar</span>')) + '</td>' +
            (podeEscrever() ? '<td><button type="button" data-coletar="' + esc(c.id) + '">Coletar</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table>' +
        '<p class="mut">* páginas que mudaram desde a última análise fechada' + (desde ? ' (' + esc(dataHora(desde)) + ')' : '') + '.' +
        (totalMudou ? ' <b>' + totalMudou + ' mudança(s): vale rodar uma nova análise.</b>' : '') + '</p>' +
        (podeEscrever() ? '<p><button type="button" id="coletar-todos">Coletar todos</button></p>' +
          '<details><summary>Cadastrar concorrente</summary><form class="grade" id="form-concorrente">' +
          '<label>Nome<input name="nome" required maxlength="120"></label>' +
          '<label class="largo">Site (o robô só segue links dentro deste caminho)<input name="site" type="url" required placeholder="https://www.exemplo.com.br/"></label>' +
          '<button type="submit">Cadastrar</button></form></details>' : '') +
        '<h2>Análise de mercado</h2>' +
        (aberta ? '<p>Análise em andamento: ' + esc((aberta.passos || []).map(function (x) { return NOME_PASSO[x.nome] || x.nome; }).join(' → ') || 'começando') +
          ' · ' + esc(usd(aberta.custo_usd)) + '</p><p id="andamento" class="mut">' + (rodando ? 'Trabalhando… (cada passo leva de 30 s a 2 min)' : '') + '</p>' +
          (podeEscrever() && !rodando ? '<p><button type="button" class="prim" id="continuar" data-id="' + esc(aberta.id) + '">Continuar análise</button></p>' : '')
          : (podeEscrever() ? '<p><button type="button" class="prim" id="nova-analise">Nova análise</button> <span class="mut">3 passos, cerca de US$ 0,40 (a primeira custou US$ 0,40), dentro do teto diário.</span></p>' : '')) +
        (analises.length ? '<details><summary>Análises anteriores</summary><ul>' + analises.map(function (a) {
          return '<li><a href="#concorrencia/' + esc(a.id) + '">' + esc(dataHora(a.criado_em)) + '</a> · ' + esc(a.status.replace('_', ' ')) + ' · ' + esc(usd(a.custo_usd)) + '</li>';
        }).join('') + '</ul></details>' : '') +
        '<div id="analise"></div>';

      if (mensagem) aviso(mensagem[0], mensagem[1]);
      ligar();
      if (escolhida) return mostrarAnalise(escolhida);
    });
  }

  function mostrarAnalise(id) {
    return api('/rest/v1/analises_mercado?select=*&id=eq.' + q(id)).then(function (r) {
      var a = r[0], alvo = document.getElementById('analise');
      if (!a || !alvo) return;
      var passos = a.passos || [];
      var critica = passos.filter(function (p) { return p.nome === 'critica'; })[0];
      if (a.status !== 'fechada') {
        alvo.innerHTML = '<p class="mut">Análise de ' + esc(dataHora(a.criado_em)) + ' ainda não terminou (' + passos.length + ' de 3 passos).</p>';
        return;
      }
      alvo.innerHTML = '<p class="mut">Análise de ' + esc(dataHora(a.criado_em)) + ' · ' + esc(a.tokens) + ' tokens · ' + esc(usd(a.custo_usd)) + '</p>' +
        '<h3>Propostas de conteúdo</h3>' +
        (a.propostas || []).map(function (p) {
          return '<div class="proposta"><b>' + esc(p.titulo) + '</b> <span class="mut">' + esc(p.tipo) + ' · ' + esc(p.url_sugerida) + '</span>' +
            '<p><small class="mut">Lacuna:</small> ' + marcar(p.lacuna) + '</p>' +
            '<p><small class="mut">Por quê:</small> ' + marcar(p.por_que) + '</p>' +
            '<small class="mut">Esboço</small>' + lista(p.esboco) +
            ((p.dados_que_faltam || []).length ? '<small class="mut">Dados que a Corquímica precisa fornecer</small>' + lista(p.dados_que_faltam) : '') + '</div>';
        }).join('') +
        '<h3>Lacunas (o que ninguém responde)</h3>' +
        '<table class="tab"><thead><tr><th>#</th><th>Lacuna e pergunta do comprador</th><th>Demanda</th><th>Facilidade</th></tr></thead><tbody>' +
        (a.lacunas || []).map(function (l) {
          return '<tr><td>' + esc(l.prioridade) + '</td><td><b>' + esc(l.tema) + '</b><br>' + marcar(l.pergunta_do_comprador) +
            '<br><small class="mut">' + marcar(l.por_que_e_lacuna) + (l.evidencia ? ' · ' + marcar(l.evidencia) : '') + '</small></td>' +
            '<td>' + esc(NIVEL[l.demanda] || l.demanda) + '<br><small class="mut">' + marcar(l.demanda_motivo) + '</small></td>' +
            '<td>' + esc(NIVEL[l.facilidade] || l.facilidade) + '<br><small class="mut">' + marcar(l.facilidade_motivo) + '</small></td></tr>';
        }).join('') + '</tbody></table>' +
        '<h3>Matriz de forte e fraco</h3>' +
        '<table class="tab"><thead><tr><th>Concorrente</th><th>Promete</th><th>Prova</th><th>Fortes</th><th>Fracos</th><th>Como chama o produto</th></tr></thead><tbody>' +
        (a.matriz || []).map(function (m) {
          return '<tr><td><b>' + esc(m.concorrente) + '</b></td><td>' + marcar(m.promete) + '</td><td>' + marcar(m.prova) + '</td>' +
            '<td>' + lista(m.fortes) + '</td><td>' + lista(m.fracos) + '</td><td>' + esc((m.vocabulario || []).join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        ((a.vocabulario || []).length ? '<h3>Vocabulário do mercado</h3><table class="tab"><thead><tr><th>Termo</th><th>Quem usa</th><th>Corquímica usa?</th></tr></thead><tbody>' +
          a.vocabulario.map(function (v) {
            return '<tr><td>' + esc(v.termo) + '</td><td>' + esc((v.quem_usa || []).join(', ')) + '</td><td>' + (v.corquimica_usa ? 'sim' : '<b>não</b>') + '</td></tr>';
          }).join('') + '</tbody></table>' : '') +
        (critica ? '<details><summary>O que o ChatGPT (cético) contestou</summary><div class="texto">' + marcar(critica.texto) + '</div></details>' : '') +
        '<details><summary>Dossiê que os dois receberam</summary><pre class="resultado">' + esc(JSON.stringify(a.dossie, null, 2)) + '</pre></details>';
    });
  }

  function coletar(ids, botao) {
    if (botao) { botao.disabled = true; botao.textContent = 'Coletando…'; }
    var resumo = [];
    // Dois por vez: cada coleta lê até 11 páginas de um site.
    var fila = ids.slice();
    var trabalhar = function () {
      var id = fila.shift();
      if (!id) return Promise.resolve();
      return fn({ acao: 'coletar', concorrente_id: id })
        .then(function (r) { resumo.push(r.paginas + ' páginas (' + r.novas + ' novas, ' + r.mudaram + ' mudaram)'); })
        .catch(function (e) { resumo.push(e.message); })
        .then(trabalhar);
    };
    return Promise.all([trabalhar(), trabalhar()]).then(function () {
      aviso('Coleta: ' + resumo.join(' · '));
      return render();
    });
  }

  // Roda um passo por vez até fechar; para se sair da tela ou der erro (teto, rede).
  function analisar(id) {
    rodando = true;
    var passo = function () {
      if (location.hash.indexOf('#concorrencia') !== 0) { rodando = false; return; }
      return render()
        .then(function () { return fn({ acao: 'avancar', analise_id: id }); })
        .then(function (r) {
          if (r.status === 'fechada') { rodando = false; aviso('Análise fechada.'); location.hash = 'concorrencia/' + id; return render(id); }
          return passo();
        })
        .catch(function (e) { rodando = false; aviso(e.message, true); return render(); });
    };
    return passo();
  }

  function ligar() {
    tela.querySelectorAll('[data-coletar]').forEach(function (b) {
      b.addEventListener('click', function () { coletar([b.dataset.coletar], b); });
    });
    var todos = document.getElementById('coletar-todos');
    if (todos) todos.addEventListener('click', function () {
      api('/rest/v1/concorrentes?select=id&ativo=is.true').then(function (r) { return coletar(r.map(function (x) { return x.id; }), todos); });
    });
    var nova = document.getElementById('nova-analise');
    if (nova) nova.addEventListener('click', function () {
      nova.disabled = true;
      fn({ acao: 'abrir_analise' }).then(function (r) { return analisar(r.analise_id); }).catch(function (e) { aviso(e.message, true); nova.disabled = false; });
    });
    var cont = document.getElementById('continuar');
    if (cont) cont.addEventListener('click', function () { analisar(cont.dataset.id); });
    var f = document.getElementById('form-concorrente');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var site = f.site.value.trim(), dominio;
      try { dominio = new URL(site).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { aviso('Endereço inválido.', true); return; }
      api('/rest/v1/concorrentes', { metodo: 'POST', corpo: { nome: f.nome.value.trim(), site: site, dominio: dominio }, retorno: true })
        .then(function () { aviso('Concorrente cadastrado. Clique em "Coletar" na linha dele.'); return render(); })
        .catch(function (e) { aviso(/duplicate|unique/i.test(e.message) ? 'Esse domínio já está cadastrado.' : e.message, true); });
    });
  }

  window.CQ_CONC = {
    abrir: function (ctx, id) { api = ctx.api; perfil = ctx.perfil; tela = ctx.tela; return render(id); },
  };
})();
