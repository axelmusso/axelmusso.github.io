// CRM: dashboard, empresas, ficha com linha do tempo, funil arrastável e tarefas do dia.
// Sem biblioteca. Todo texto vindo do banco passa por esc() antes de virar HTML.
(function () {
  var api, perfil, tela;
  var ETAPAS = [
    ['novo', 'Novo'], ['qualificado', 'Qualificado'], ['contatado', 'Contatado'], ['respondeu', 'Respondeu'],
    ['reuniao', 'Reunião'], ['proposta', 'Proposta'], ['ganho', 'Ganho'], ['perdido', 'Perdido'],
  ];
  var NOME_ETAPA = Object.fromEntries(ETAPAS);
  var TIPOS = [['nota', 'Nota'], ['ligacao', 'Ligação'], ['email', 'E-mail'], ['reuniao', 'Reunião'], ['whatsapp', 'WhatsApp'], ['visita', 'Visita']];
  var NOME_TIPO = Object.assign(Object.fromEntries(TIPOS), { mudanca_etapa: 'Mudança de etapa' });
  var BASES = ['Legítimo interesse (contato profissional público)', 'Consentimento', 'Cliente atual (execução de contrato)'];

  // ---------- utilidades ----------
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var podeEscrever = function () { return perfil.papel === 'dono' || perfil.papel === 'operador'; };
  var hoje = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var data = function (s) { return s ? new Date(s.length === 10 ? s + 'T12:00' : s).toLocaleDateString('pt-BR') : ''; };
  var dataHora = function (s) { return s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; };
  var moeda = function (v) { return v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var opcoes = function (lista, atual) { return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === atual ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
  // Campos de um formulário viram objeto; vazio vira null; checkbox vira true/false.
  function dados(form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (c) {
      if (!c.name) return;
      if (c.type === 'checkbox') o[c.name] = c.checked;
      else { var v = c.value.trim(); o[c.name] = v === '' ? null : c.type === 'number' ? Number(v) : v; }
    });
    return o;
  }
  var q = function (s) { return encodeURIComponent(s); };
  function dominioDe(site) {
    if (!site) return null;
    try { return new URL(/^https?:\/\//.test(site) ? site : 'https://' + site).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return null; }
  }
  function erro(e) { aviso(e && e.message ? e.message : String(e), true); }
  function aviso(texto, ruim) {
    var a = document.getElementById('aviso-crm');
    if (!a) { a = document.createElement('p'); a.id = 'aviso-crm'; a.setAttribute('role', 'status'); tela.prepend(a); }
    a.className = 'aviso' + (ruim ? ' ruim' : '');
    a.textContent = texto;
  }
  var inserir = function (tabela, corpo) { return api('/rest/v1/' + tabela, { metodo: 'POST', corpo: corpo, retorno: true }); };
  var alterar = function (tabela, id, corpo) { return api('/rest/v1/' + tabela + '?id=eq.' + q(id), { metodo: 'PATCH', corpo: corpo, retorno: true }); };
  var apagar = function (tabela, id) { return api('/rest/v1/' + tabela + '?id=eq.' + q(id), { metodo: 'DELETE' }); };

  // ---------- navegação ----------
  function rota() {
    var partes = (location.hash.slice(1) || 'dashboard').split('/');
    document.querySelectorAll('.menu a').forEach(function (a) {
      var alvo = a.getAttribute('href').slice(1);
      if (alvo === partes[0] || (alvo === 'empresas' && partes[0] === 'empresa')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    tela.innerHTML = '<p class="mut">Carregando…</p>';
    var telas = { dashboard: dashboard, empresas: empresas, empresa: ficha, funil: funil, tarefas: tarefas, operacao: operacao, conselho: conselho, memoria: memoria,
      prospeccao: function () { return window.CQ_PROSP.abrir({ api: api, perfil: perfil, tela: tela }); } };
    (telas[partes[0]] || dashboard)(partes[1]).catch(function (e) { tela.innerHTML = ''; erro(e); });
  }

  // ---------- dashboard ----------
  function dashboard() {
    return Promise.all([
      api('/rest/v1/negocios?select=etapa,valor_estimado'),
      api('/rest/v1/tarefas?select=id,vence_em&concluida=is.false'),
      api('/rest/v1/empresas?select=id'),
    ]).then(function (r) {
      var neg = r[0], tar = r[1], h = hoje();
      var porEtapa = {}; neg.forEach(function (n) { porEtapa[n.etapa] = (porEtapa[n.etapa] || 0) + 1; });
      var abertos = neg.filter(function (n) { return n.etapa !== 'ganho' && n.etapa !== 'perdido'; });
      var valor = abertos.reduce(function (s, n) { return s + Number(n.valor_estimado || 0); }, 0);
      var atrasadas = tar.filter(function (t) { return t.vence_em && t.vence_em < h; }).length;
      var doDia = tar.filter(function (t) { return t.vence_em === h; }).length;
      tela.innerHTML = '<h1>Dashboard</h1><p class="mut">Olá, ' + esc(perfil.nome || perfil.email) + ' (' + esc(perfil.papel) + ').</p>' +
        '<div class="numeros">' +
        '<a href="#empresas"><b>' + r[2].length + '</b>empresas</a>' +
        '<a href="#funil"><b>' + abertos.length + '</b>negócios abertos</a>' +
        '<a href="#funil"><b>' + esc(moeda(valor)) + '</b>em aberto</a>' +
        '<a href="#tarefas"><b>' + doDia + '</b>tarefas hoje</a>' +
        '<a href="#tarefas" class="' + (atrasadas ? 'ruim' : '') + '"><b>' + atrasadas + '</b>atrasadas</a>' +
        '</div><h2>Funil</h2><table class="tab"><tbody>' +
        ETAPAS.map(function (e) { return '<tr><td>' + esc(e[1]) + '</td><td class="num">' + (porEtapa[e[0]] || 0) + '</td></tr>'; }).join('') +
        '</tbody></table>';
    });
  }

  // ---------- empresas ----------
  var filtro = { busca: '', status: '', setor: '', uf: '' };
  function empresas() {
    var url = '/rest/v1/empresas?select=id,nome,dominio,setor,cidade,uf,status,icp_score&order=atualizado_em.desc&limit=300';
    var b = filtro.busca.replace(/[,()*%\\]/g, ' ').trim();
    if (b) url += '&or=' + q('(nome.ilike.*' + b + '*,dominio.ilike.*' + b + '*,cidade.ilike.*' + b + '*,cnpj.ilike.*' + b + '*)');
    if (filtro.status) url += '&status=eq.' + q(filtro.status);
    if (filtro.setor) url += '&setor=ilike.' + q('*' + filtro.setor.replace(/[*%,()]/g, '') + '*');
    if (filtro.uf) url += '&uf=eq.' + q(filtro.uf.toUpperCase());
    return api(url).then(function (lista) {
      tela.innerHTML = '<div class="cab"><h1>Empresas</h1>' + (podeEscrever() ? '<button type="button" class="prim" id="nova-empresa">Nova empresa</button>' : '') + '</div>' +
        (podeEscrever() ? formEmpresa() : '') +
        '<form class="filtros" id="filtros">' +
        '<input name="busca" type="search" placeholder="Buscar nome, domínio, cidade, CNPJ" value="' + esc(filtro.busca) + '" aria-label="Buscar">' +
        '<select name="status" aria-label="Status"><option value="">Todos os status</option>' + opcoes([['prospect', 'Prospect'], ['cliente', 'Cliente'], ['descartada', 'Descartada']], filtro.status) + '</select>' +
        '<input name="setor" placeholder="Setor" value="' + esc(filtro.setor) + '" aria-label="Setor">' +
        '<input name="uf" placeholder="UF" maxlength="2" value="' + esc(filtro.uf) + '" aria-label="UF" class="curto">' +
        '<button type="submit">Filtrar</button></form>' +
        '<p class="mut">' + lista.length + (lista.length === 300 ? '+ (mostrando as 300 mais recentes)' : '') + ' empresa(s)</p>' +
        '<table class="tab"><thead><tr><th>Nome</th><th>Setor</th><th>Cidade</th><th>Status</th><th class="num">ICP</th></tr></thead><tbody>' +
        (lista.map(function (e) {
          return '<tr><td><a href="#empresa/' + esc(e.id) + '">' + esc(e.nome) + '</a>' + (e.dominio ? '<br><small class="mut">' + esc(e.dominio) + '</small>' : '') + '</td><td>' + esc(e.setor) + '</td><td>' + esc([e.cidade, e.uf].filter(Boolean).join('/')) + '</td><td>' + esc(e.status) + '</td><td class="num">' + esc(e.icp_score) + '</td></tr>';
        }).join('') || '<tr><td colspan="5" class="mut">Nenhuma empresa.</td></tr>') + '</tbody></table>';
      document.getElementById('filtros').addEventListener('submit', function (ev) { ev.preventDefault(); filtro = dados(ev.target); rota(); });
      if (!podeEscrever()) return;
      var f = document.getElementById('form-empresa');
      document.getElementById('nova-empresa').addEventListener('click', function () { f.hidden = !f.hidden; if (!f.hidden) f.nome.focus(); });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = dados(f), criarNegocio = d.criar_negocio; delete d.criar_negocio;
        d.dominio = dominioDe(d.site); d.origem = 'manual'; if (d.uf) d.uf = d.uf.toUpperCase();
        inserir('empresas', d).then(function (r) {
          var e = r[0];
          return (criarNegocio ? inserir('negocios', { empresa_id: e.id, titulo: e.nome, responsavel: perfil.id }) : Promise.resolve())
            .then(function () { location.hash = 'empresa/' + e.id; });
        }).catch(erro);
      });
    });
  }
  function formEmpresa(e) {
    e = e || {};
    var campo = function (n, rot, extra) { return '<label>' + rot + '<input name="' + n + '" value="' + esc(e[n]) + '"' + (extra || '') + '></label>'; };
    return '<form class="grade" id="form-empresa"' + (e.id ? '' : ' hidden') + '>' +
      campo('nome', 'Nome *', ' required maxlength="200"') + campo('site', 'Site') + campo('setor', 'Setor') +
      campo('porte', 'Porte') + campo('cidade', 'Cidade') + campo('uf', 'UF', ' maxlength="2"') + campo('cnpj', 'CNPJ') + campo('telefone', 'Telefone') +
      (e.id ? '<label>Status<select name="status">' + opcoes([['prospect', 'Prospect'], ['cliente', 'Cliente'], ['descartada', 'Descartada']], e.status) + '</select></label>' +
        campo('icp_score', 'ICP (0–100)', ' type="number" min="0" max="100"')
        : '<label class="chk"><input type="checkbox" name="criar_negocio" checked> Já criar negócio no funil (etapa Novo)</label>') +
      '<button type="submit" class="prim">' + (e.id ? 'Salvar dados' : 'Cadastrar') + '</button></form>';
  }

  // ---------- ficha da empresa ----------
  function ficha(id) {
    if (!id) { location.hash = 'empresas'; return Promise.resolve(); }
    var f = '&empresa_id=eq.' + q(id);
    return Promise.all([
      api('/rest/v1/empresas?select=*&id=eq.' + q(id)),
      api('/rest/v1/contatos?select=*' + f + '&order=nome'),
      api('/rest/v1/negocios?select=*' + f),
      api('/rest/v1/interacoes?select=*,contatos(nome)' + f + '&order=ocorrido_em.desc&limit=200'),
    ]).then(function (r) {
      var e = r[0][0], contatos = r[1], negocios = r[2], linha = r[3];
      if (!e) { tela.innerHTML = '<h1>Empresa não encontrada</h1><p><a href="#empresas">Voltar</a></p>'; return; }
      var ids = negocios.map(function (n) { return n.id; });
      return (ids.length ? api('/rest/v1/tarefas?select=*&order=concluida,vence_em&negocio_id=in.(' + ids.map(q).join(',') + ')') : Promise.resolve([]))
        .then(function (tars) { desenharFicha(e, contatos, negocios, linha, tars); });
    });
  }
  function desenharFicha(e, contatos, negocios, linha, tars) {
    var w = podeEscrever();
    var nomeNeg = Object.fromEntries(negocios.map(function (n) { return [n.id, n.titulo]; }));
    var agoraLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    tela.innerHTML =
      '<p><a href="#empresas">← Empresas</a></p>' +
      '<div class="cab"><h1>' + esc(e.nome) + '</h1>' + (e.site ? '<a href="' + esc(/^https?:/.test(e.site) ? e.site : 'https://' + e.site) + '" target="_blank" rel="noopener noreferrer">' + esc(e.dominio || e.site) + '</a>' : '') + '</div>' +
      '<p class="mut">' + esc([e.setor, e.porte, [e.cidade, e.uf].filter(Boolean).join('/'), e.cnpj && 'CNPJ ' + e.cnpj, e.telefone, e.origem && 'origem: ' + e.origem].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="colunas"><div>' +
      // negócios
      '<h2>Negócios</h2>' + (negocios.map(function (n) {
        return '<div class="item"><b>' + esc(n.titulo) + '</b> ' + esc(moeda(n.valor_estimado)) +
          (w ? ' <select data-etapa="' + esc(n.id) + '" aria-label="Etapa">' + opcoes(ETAPAS, n.etapa) + '</select>' : ' · ' + esc(NOME_ETAPA[n.etapa])) +
          (n.etapa === 'perdido' && n.motivo_perda ? '<br><small class="mut">Motivo: ' + esc(n.motivo_perda) + '</small>' : '') + '</div>';
      }).join('') || '<p class="mut">Nenhum negócio.</p>') +
      (w ? '<form class="linha" id="form-negocio"><input name="titulo" placeholder="Novo negócio" required aria-label="Título do negócio"><input name="valor_estimado" type="number" min="0" step="0.01" placeholder="Valor R$" aria-label="Valor estimado" class="curto"><button type="submit">Adicionar</button></form>' : '') +
      // tarefas
      '<h2>Tarefas</h2>' + (tars.map(function (t) {
        return '<label class="chk item' + (t.concluida ? ' feita' : '') + '"><input type="checkbox" data-tarefa="' + esc(t.id) + '"' + (t.concluida ? ' checked' : '') + (w ? '' : ' disabled') + '> ' + esc(t.titulo) +
          ' <small class="mut">' + esc(data(t.vence_em)) + ' · ' + esc(nomeNeg[t.negocio_id]) + '</small></label>';
      }).join('') || '<p class="mut">Nenhuma tarefa.</p>') +
      (w && negocios.length ? '<form class="linha" id="form-tarefa"><input name="titulo" placeholder="Nova tarefa" required aria-label="Tarefa"><input name="vence_em" type="date" value="' + hoje() + '" aria-label="Vence em"><select name="negocio_id" aria-label="Negócio">' + opcoes(negocios.map(function (n) { return [n.id, n.titulo]; })) + '</select><button type="submit">Adicionar</button></form>' : '') +
      // contatos
      '<h2>Contatos</h2>' + (contatos.map(function (c) {
        return '<div class="item"><b>' + esc(c.nome || '(sem nome)') + '</b> ' + esc(c.cargo) +
          '<br><small>' + esc([c.email, c.telefone].filter(Boolean).join(' · ')) + (c.pode_contatar ? '' : ' · <span class="ruim">não contatar</span>') + '</small>' +
          (c.fonte_url ? '<br><small class="mut">fonte: ' + esc(c.fonte_url) + ' · ' + esc(data(c.coletado_em)) + '</small>' : '') + '</div>';
      }).join('') || '<p class="mut">Nenhum contato.</p>') +
      (w ? '<details><summary>Adicionar contato</summary><form class="grade" id="form-contato">' +
        '<label>Nome<input name="nome"></label><label>Cargo<input name="cargo"></label><label>E-mail<input name="email" type="email"></label>' +
        '<label>Telefone<input name="telefone"></label><label>LinkedIn<input name="linkedin"></label><label>Onde achou (URL)<input name="fonte_url"></label>' +
        '<label>Base legal (LGPD)<select name="base_legal">' + opcoes(BASES.map(function (b) { return [b, b]; })) + '</select></label>' +
        '<label class="chk"><input type="checkbox" name="pode_contatar" checked> Pode contatar</label>' +
        '<button type="submit" class="prim">Salvar contato</button></form></details>' : '') +
      (w ? '<details><summary>Editar dados da empresa</summary>' + formEmpresa(e) + (perfil.papel === 'dono' ? '<button type="button" class="perigo" id="apagar-empresa">Excluir empresa</button>' : '') + '</details>' : '') +
      '</div><div>' +
      // linha do tempo
      '<h2>Linha do tempo</h2>' +
      (w ? '<form class="grade" id="form-interacao">' +
        '<label>Tipo<select name="tipo">' + opcoes(TIPOS) + '</select></label>' +
        '<label>Direção<select name="direcao">' + opcoes([['saida', 'Nós → empresa'], ['entrada', 'Empresa → nós'], ['interna', 'Interna']]) + '</select></label>' +
        '<label>Contato<select name="contato_id"><option value="">—</option>' + opcoes(contatos.map(function (c) { return [c.id, c.nome || c.email || '(sem nome)']; })) + '</select></label>' +
        '<label>Quando<input name="ocorrido_em" type="datetime-local" value="' + agoraLocal + '"></label>' +
        '<label class="largo">Assunto<input name="assunto"></label>' +
        '<label class="largo">O que aconteceu<textarea name="conteudo" rows="3" required></textarea></label>' +
        '<button type="submit" class="prim">Registrar</button></form>' : '') +
      '<ol class="tempo">' + (linha.map(function (i) {
        return '<li class="' + esc(i.tipo) + '"><small class="mut">' + esc(dataHora(i.ocorrido_em)) + ' · ' + esc(NOME_TIPO[i.tipo] || i.tipo) +
          (i.direcao ? ' · ' + esc({ entrada: 'recebido', saida: 'enviado', interna: 'interno' }[i.direcao]) : '') +
          (i.contatos ? ' · ' + esc(i.contatos.nome) : '') + (i.agente_id ? ' · agente ' + esc(i.agente_id) : '') + '</small>' +
          (i.assunto ? '<b>' + esc(i.assunto) + '</b>' : '') + '<p>' + esc(i.conteudo) + '</p></li>';
      }).join('') || '<li class="mut">Nada registrado ainda.</li>') + '</ol>' +
      '</div></div>';

    if (!w) return;
    var recarregar = function () { return ficha(e.id); };
    tela.querySelectorAll('[data-etapa]').forEach(function (s) {
      s.addEventListener('change', function () { mudarEtapa(s.dataset.etapa, s.value).then(recarregar).catch(erro); });
    });
    tela.querySelectorAll('[data-tarefa]').forEach(function (c) {
      c.addEventListener('change', function () { alterar('tarefas', c.dataset.tarefa, { concluida: c.checked }).then(recarregar).catch(erro); });
    });
    enviar('form-negocio', function (d) { d.empresa_id = e.id; d.responsavel = perfil.id; return inserir('negocios', d); }, recarregar);
    enviar('form-tarefa', function (d) { d.responsavel = perfil.id; return inserir('tarefas', d); }, recarregar);
    enviar('form-contato', function (d) { d.empresa_id = e.id; d.origem = 'manual'; d.coletado_em = new Date().toISOString(); if (d.email) d.email = d.email.toLowerCase(); return inserir('contatos', d); }, recarregar);
    // Hora não mexida = agora (com segundos), para a ordem da linha do tempo ficar certa.
    enviar('form-interacao', function (d) { d.empresa_id = e.id; d.ocorrido_em = !d.ocorrido_em || d.ocorrido_em === agoraLocal ? new Date().toISOString() : new Date(d.ocorrido_em).toISOString(); return inserir('interacoes', d); }, recarregar);
    enviar('form-empresa', function (d) { d.dominio = dominioDe(d.site); if (d.uf) d.uf = d.uf.toUpperCase(); return alterar('empresas', e.id, d); }, recarregar);
    var ap = document.getElementById('apagar-empresa');
    if (ap) ap.addEventListener('click', function () {
      if (!confirm('Excluir "' + e.nome + '" com contatos, negócios, tarefas e linha do tempo? Não tem volta.')) return;
      apagar('empresas', e.id).then(function () { location.hash = 'empresas'; }).catch(erro);
    });
  }
  function enviar(id, salvar, depois) {
    var f = document.getElementById(id);
    if (!f) return;
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var b = f.querySelector('button[type=submit]'); b.disabled = true;
      salvar(dados(f)).then(depois).catch(function (e) { b.disabled = false; erro(e); });
    });
  }
  // Perdido pede o motivo (vira aprendizado depois).
  function mudarEtapa(id, etapa) {
    var corpo = { etapa: etapa };
    if (etapa === 'perdido') {
      var m = prompt('Por que este negócio foi perdido?');
      if (m === null) return Promise.reject(new Error('Mudança cancelada.'));
      corpo.motivo_perda = m.trim() || null;
    }
    return alterar('negocios', id, corpo);
  }

  // ---------- funil ----------
  function funil() {
    return api('/rest/v1/negocios?select=id,titulo,valor_estimado,etapa,empresa_id,empresas(nome)&order=valor_estimado.desc.nullslast').then(function (lista) {
      var w = podeEscrever();
      tela.innerHTML = '<h1>Funil</h1>' + (w ? '<p class="mut">Arraste o cartão para mudar de etapa (no celular, use a lista do cartão).</p>' : '') +
        '<div class="quadro">' + ETAPAS.map(function (et) {
          var col = lista.filter(function (n) { return n.etapa === et[0]; });
          var soma = col.reduce(function (s, n) { return s + Number(n.valor_estimado || 0); }, 0);
          return '<section class="coluna" data-coluna="' + et[0] + '"><h2>' + esc(et[1]) + ' <small class="mut">' + col.length + (soma ? ' · ' + esc(moeda(soma)) : '') + '</small></h2>' +
            col.map(function (n) {
              return '<article class="cartao-neg" draggable="' + w + '" data-id="' + esc(n.id) + '"><a href="#empresa/' + esc(n.empresa_id) + '">' + esc(n.empresas && n.empresas.nome) + '</a>' +
                '<div>' + esc(n.titulo) + '</div><small class="mut">' + esc(moeda(n.valor_estimado)) + '</small>' +
                (w ? '<select data-etapa="' + esc(n.id) + '" aria-label="Mover para">' + opcoes(ETAPAS, n.etapa) + '</select>' : '') + '</article>';
            }).join('') + '</section>';
        }).join('') + '</div>';
      if (!w) return;
      var arrastando = null;
      tela.querySelectorAll('.cartao-neg').forEach(function (c) {
        c.addEventListener('dragstart', function (ev) { arrastando = c.dataset.id; ev.dataTransfer.effectAllowed = 'move'; c.classList.add('movendo'); });
        c.addEventListener('dragend', function () { c.classList.remove('movendo'); });
      });
      tela.querySelectorAll('.coluna').forEach(function (col) {
        col.addEventListener('dragover', function (ev) { ev.preventDefault(); col.classList.add('alvo'); });
        col.addEventListener('dragleave', function () { col.classList.remove('alvo'); });
        col.addEventListener('drop', function (ev) {
          ev.preventDefault(); col.classList.remove('alvo');
          var n = lista.find(function (x) { return x.id === arrastando; });
          if (n && n.etapa !== col.dataset.coluna) mudarEtapa(n.id, col.dataset.coluna).then(rota).catch(erro);
        });
      });
      tela.querySelectorAll('[data-etapa]').forEach(function (s) {
        s.addEventListener('change', function () { mudarEtapa(s.dataset.etapa, s.value).then(rota).catch(function (e) { erro(e); rota(); }); });
      });
    });
  }

  // ---------- tarefas do dia ----------
  function tarefas() {
    var limite = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    return Promise.all([
      api('/rest/v1/tarefas?select=*,negocios(titulo,empresa_id,empresas(nome))&concluida=is.false&or=' + q('(vence_em.lte.' + limite + ',vence_em.is.null)') + '&order=vence_em.asc.nullslast'),
      api('/rest/v1/negocios?select=id,titulo,empresas(nome)&etapa=not.in.(ganho,perdido)&order=titulo'),
    ]).then(function (r) {
      var lista = r[0], negs = r[1], h = hoje(), w = podeEscrever();
      var grupo = function (titulo, itens) {
        return '<h2>' + titulo + ' <small class="mut">' + itens.length + '</small></h2>' + (itens.map(function (t) {
          var n = t.negocios;
          return '<label class="chk item"><input type="checkbox" data-tarefa="' + esc(t.id) + '"' + (w ? '' : ' disabled') + '> <span><b>' + esc(t.titulo) + '</b>' +
            (t.descricao ? ' — ' + esc(t.descricao) : '') + '<br><small class="mut">' + esc(data(t.vence_em) || 'sem data') +
            (n ? ' · <a href="#empresa/' + esc(n.empresa_id) + '">' + esc(n.empresas && n.empresas.nome) + '</a> · ' + esc(n.titulo) : '') + '</small></span></label>';
        }).join('') || '<p class="mut">Nada.</p>');
      };
      tela.innerHTML = '<h1>Tarefas</h1>' +
        (w ? '<form class="linha" id="form-tarefa"><input name="titulo" placeholder="Nova tarefa" required aria-label="Tarefa"><input name="vence_em" type="date" value="' + h + '" aria-label="Vence em">' +
          '<select name="negocio_id" aria-label="Negócio"><option value="">Sem negócio</option>' + opcoes(negs.map(function (n) { return [n.id, (n.empresas ? n.empresas.nome + ' · ' : '') + n.titulo]; })) + '</select>' +
          '<button type="submit">Adicionar</button></form>' : '') +
        grupo('Atrasadas', lista.filter(function (t) { return t.vence_em && t.vence_em < h; })) +
        grupo('Hoje', lista.filter(function (t) { return t.vence_em === h; })) +
        grupo('Próximos 7 dias', lista.filter(function (t) { return t.vence_em && t.vence_em > h; })) +
        grupo('Sem data', lista.filter(function (t) { return !t.vence_em; }));
      if (!w) return;
      tela.querySelectorAll('[data-tarefa]').forEach(function (c) {
        c.addEventListener('change', function () { alterar('tarefas', c.dataset.tarefa, { concluida: true }).then(rota).catch(erro); });
      });
      enviar('form-tarefa', function (d) { d.responsavel = perfil.id; return inserir('tarefas', d); }, rota);
    });
  }

  // ---------- conselho: Claude (estrategista) x ChatGPT (cético) ----------
  var NOME_PAPEL = { estrategista: 'Claude · estrategista', cetico: 'ChatGPT · cético', relator: 'Claude · relator', dono: 'Você · orientação' };
  var conversando = {}; // sessões com o laço de "avançar" rodando nesta aba
  // Texto do modelo: escapa tudo e só depois destaca fontes, hipóteses e títulos.
  function marcar(t) {
    return esc(t)
      .replace(/\[fonte:\s*([^\]]+)\]/gi, '<span class="fonte" title="fonte">$1</span>')
      .replace(/HIP[ÓO]TESE:/g, '<b class="hipotese">HIPÓTESE:</b>')
      .replace(/^##\s*(.+)\n+/gm, '<b class="tit">$1</b>')
      .replace(/^CONCORDA:\s*(sim|não|nao)\s*$/gim, '<b class="concorda">CONCORDA: $1</b>');
  }
  function conselho(id) { return id ? sessaoConselho(id) : listaConselho(); }
  function listaConselho() {
    return api('/rest/v1/conselho_sessoes?select=id,tema,status,custo_usd,criado_em&order=criado_em.desc&limit=50').then(function (lista) {
      tela.innerHTML = '<h1>Conselho</h1><p class="mut">Claude propõe, ChatGPT ataca, e um relator fecha com decisão, riscos e próximo passo mensurável. Os dois recebem o mesmo dossiê com números reais do banco.</p>' +
        (podeEscrever() ? '<form class="grade" id="form-conselho"><label class="largo">Tema ou pergunta<textarea name="tema" rows="2" required maxlength="1000" placeholder="Ex.: Por que o funil está parado na etapa contatado?"></textarea></label>' +
          '<label>Profundidade<select name="nivel"><option value="rotina">Rotina (Sonnet + gpt-6.1-sol, ~US$ 0,05–0,15)</option><option value="dificil">Difícil (Opus + gpt-6.1-sol, ~US$ 0,10–0,30)</option></select></label>' +
          '<button type="submit" class="prim">Abrir sessão</button></form>' : '') +
        '<table class="tab"><thead><tr><th>Tema</th><th>Status</th><th class="num">Custo</th><th>Quando</th></tr></thead><tbody>' +
        (lista.map(function (x) {
          return '<tr><td><a href="#conselho/' + esc(x.id) + '">' + esc(x.tema) + '</a></td><td>' + esc(x.status.replace('_', ' ')) + '</td><td class="num">' + esc(usd(x.custo_usd, 4)) + '</td><td>' + esc(dataHora(x.criado_em)) + '</td></tr>';
        }).join('') || '<tr><td colspan="4" class="mut">Nenhuma sessão ainda.</td></tr>') + '</tbody></table>';
      enviar('form-conselho', function (d) {
        return api('/functions/v1/conselho', { metodo: 'POST', corpo: { acao: 'abrir', tema: d.tema, nivel: d.nivel } })
          .then(function (r) { conversando[r.sessao_id] = 'iniciar'; location.hash = 'conselho/' + r.sessao_id; });
      }, function () {});
    });
  }
  function sessaoConselho(id) {
    return Promise.all([
      api('/rest/v1/conselho_sessoes?select=*&id=eq.' + q(id)),
      api('/rest/v1/conselho_mensagens?select=*&order=criado_em&sessao_id=eq.' + q(id)),
    ]).then(function (r) {
      var s = r[0][0], msgs = r[1];
      if (!s) { tela.innerHTML = '<h1>Sessão não encontrada</h1><p><a href="#conselho">Voltar</a></p>'; return; }
      var aberta = s.status === 'em_andamento', rodando = conversando[id] === true;
      tela.innerHTML = '<p><a href="#conselho">← Conselho</a></p><h1>' + esc(s.tema) + '</h1>' +
        '<p class="mut">' + esc(s.status.replace('_', ' ')) + ' · ' + esc(s.nivel) + ' · ' + esc(s.tokens) + ' tokens · ' + esc(usd(s.custo_usd, 4)) + ' · ' + esc(dataHora(s.criado_em)) + '</p>' +
        '<details><summary>Dossiê que os dois receberam</summary><pre class="resultado">' + esc(JSON.stringify(s.dossie, null, 2)) + '</pre></details>' +
        (s.decisao ? '<section class="decisao"><h2>Fechamento</h2><div class="texto">' + marcar(s.decisao) + '</div></section>' : '') +
        '<ol class="conversa">' + msgs.map(function (m) {
          return '<li class="msg-' + esc(m.papel) + '"><small class="mut">Rodada ' + esc(m.rodada) + ' · ' + esc(NOME_PAPEL[m.papel] || m.papel) + ' · ' + esc(dataHora(m.criado_em)) + '</small>' +
            '<div class="texto">' + marcar(m.conteudo) + '</div>' +
            (m.fontes && m.fontes.length ? '<small class="mut">' + m.fontes.length + ' fonte(s) citada(s)</small>' : (m.provedor !== 'humano' ? '<small class="ruim">nenhuma fonte citada</small>' : '')) + '</li>';
        }).join('') + '</ol>' +
        (aberta ? '<p id="andamento" class="mut">' + (rodando ? 'Conversando… (cada fala leva de 10 a 60 s)' : '') + '</p>' : '') +
        (aberta && podeEscrever() ? (rodando ? '' : '<p><button type="button" class="prim" id="continuar">Continuar conversa</button></p>') +
          '<form class="grade" id="form-intervir"><label class="largo">Mudar o rumo (os dois leem antes da próxima fala)<textarea name="texto" rows="2" required maxlength="2000"></textarea></label><button type="submit">Enviar orientação</button></form>' : '');
      if (!aberta || !podeEscrever()) return;
      enviar('form-intervir', function (d) { return api('/functions/v1/conselho', { metodo: 'POST', corpo: { acao: 'intervir', sessao_id: id, texto: d.texto } }); }, function () { aviso('Orientação registrada. Entra na próxima fala.'); sessaoConselho(id); });
      var b = document.getElementById('continuar');
      if (b) b.addEventListener('click', function () { conversar(id); });
      if (conversando[id] === 'iniciar') conversar(id);
    });
  }
  // Roda um passo por vez até fechar; para se sair da tela, der erro ou bater no teto.
  function conversar(id) {
    conversando[id] = true;
    var passo = function () {
      if (location.hash !== '#conselho/' + id) { conversando[id] = false; return; }
      return sessaoConselho(id)
        .then(function () { return api('/functions/v1/conselho', { metodo: 'POST', corpo: { acao: 'avancar', sessao_id: id } }); })
        .then(function (r) { if (r.status === 'fechada') { conversando[id] = false; return sessaoConselho(id); } return passo(); })
        .catch(function (e) { conversando[id] = false; sessaoConselho(id).then(function () { erro(e); }); });
    };
    passo();
  }

  // ---------- memória: o que os robôs aprenderam ----------
  var NOME_STATUS = { proposta: 'Proposta (aguarda resultado)', hipotese: 'Hipótese', testando: 'Testando', confirmado: 'Confirmado', refutado: 'Refutado' };
  var memFn = function (corpo) { return api('/functions/v1/memoria', { metodo: 'POST', corpo: corpo }); };
  function cartaoMemoria(m, w) {
    var ev = (m.evidencia || []).filter(function (e) { return e.amostra; });
    return '<div class="item mem-' + esc(m.status) + '"><small class="mut">#' + esc(m.id.slice(0, 8)) + ' · ' + esc(NOME_STATUS[m.status] || m.status) + ' · confiança ' + Number(m.confianca).toFixed(2) +
      ' · visto ' + esc(m.visto_vezes) + 'x' + (m.tags && m.tags.length ? ' · ' + esc(m.tags.join(', ')) : '') + '</small>' +
      '<div>' + esc(m.hipotese) + '</div>' +
      (ev.length ? '<small class="mut">' + ev.map(function (e) { return esc(e.metrica) + ': ' + esc(e.valor) + ' (n=' + esc(e.amostra) + ')' + (e.contraria ? ' <span class="ruim">contraria</span>' : ''); }).join(' · ') + '</small>' : '') +
      (m.origem === 'conselho' && m.origem_id ? '<br><small><a href="#conselho/' + esc(m.origem_id) + '">ver sessão do Conselho</a></small>' : '') +
      (w && m.status !== 'refutado' ? '<details><summary>Registrar resultado medido</summary><form class="linha" data-resultado="' + esc(m.id) + '">' +
        '<input name="metrica" placeholder="Métrica (ex.: taxa de resposta)" required><input name="valor" placeholder="Valor (ex.: 18%)" required class="curto"><input name="amostra" type="number" min="1" placeholder="Amostra" required class="curto">' +
        '<label class="chk"><input type="checkbox" name="contraria"> Contraria</label><input name="resultado" placeholder="O que aconteceu (opcional)"><button type="submit">Salvar</button></form></details>' : '') + '</div>';
  }
  function memoria() {
    return Promise.all([
      api('/rest/v1/memoria_aprendizados?select=id,hipotese,evidencia,resultado,confianca,status,tags,visto_vezes,origem,origem_id,atualizado_em&order=confianca.desc,atualizado_em.desc&limit=200'),
      api('/rest/v1/memoria_consolidacoes?select=*&order=criado_em.desc&limit=5'),
    ]).then(function (r) {
      var lista = r[0], cons = r[1], w = podeEscrever();
      var grupo = function (titulo, itens) { return '<h2>' + titulo + ' <small class="mut">' + itens.length + '</small></h2>' + (itens.map(function (m) { return cartaoMemoria(m, w); }).join('') || '<p class="mut">Nada.</p>'); };
      tela.innerHTML = '<h1>Memória</h1><p class="mut">O que os agentes aprenderam, sempre com o número que sustenta. Antes de agir, eles leem os parecidos com a tarefa, com confiança acima de 0,6 e não refutados. Nunca guarda dado de pessoa.</p>' +
        '<form class="linha" id="form-buscar-mem"><input type="search" name="texto" required placeholder="Testar: o que os agentes leriam sobre… (ex.: assunto de e-mail para calçados)" style="flex:1 1 300px"><button type="submit">Buscar</button></form><div id="resultado-mem"></div>' +
        (w ? '<details><summary>Registrar aprendizado</summary><form class="grade" id="form-mem">' +
          '<label class="largo">Aprendizado, com o número<textarea name="hipotese" rows="2" required placeholder="Ex.: assunto com o nome da cidade teve 31% de resposta contra 12% do genérico, em 84 envios"></textarea></label>' +
          '<label>Métrica<input name="metrica" required placeholder="taxa de resposta"></label><label>Valor<input name="valor" required placeholder="31% x 12%"></label>' +
          '<label>Amostra<input name="amostra" type="number" min="1" required></label><label>Fonte<input name="fonte" placeholder="campanha de outubro"></label>' +
          '<label>Tags<input name="tags" placeholder="email, assunto"></label><button type="submit" class="prim">Gravar</button></form></details>' : '') +
        grupo('Propostas aguardando resultado', lista.filter(function (m) { return m.status === 'proposta'; })) +
        grupo('Aprendizados ativos', lista.filter(function (m) { return ['hipotese', 'testando', 'confirmado'].indexOf(m.status) >= 0; })) +
        grupo('Refutados (somem na próxima consolidação)', lista.filter(function (m) { return m.status === 'refutado'; })) +
        '<h2>Consolidações semanais</h2>' + (perfil.papel === 'dono' ? '<p><button type="button" id="consolidar">Consolidar agora</button> <small class="mut">funde duplicados, sobe o que se repetiu, derruba o contrariado e apaga o refutado</small></p>' : '') +
        (cons.map(function (c) { return '<div class="item"><small class="mut">' + esc(dataHora(c.criado_em)) + ' · ' + (c.mudancas || []).length + ' mudança(s)</small><div class="texto">' + esc(c.resumo) + '</div></div>'; }).join('') || '<p class="mut">Nenhuma ainda.</p>');

      document.getElementById('form-buscar-mem').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var saida = document.getElementById('resultado-mem'); saida.innerHTML = '<p class="mut">Buscando…</p>';
        memFn({ acao: 'buscar', texto: ev.target.texto.value }).then(function (r) {
          saida.innerHTML = r.itens.length ? r.itens.map(function (m) { return '<div class="item"><small class="mut">semelhança ' + Number(m.similaridade).toFixed(2) + '</small>' + cartaoMemoria(m, false) + '</div>'; }).join('')
            : '<p class="mut">Nenhum aprendizado com confiança acima de 0,6 parecido com isso. Os agentes agiriam sem memória.</p>';
        }).catch(erro);
      });
      if (!w) return;
      enviar('form-mem', function (d) {
        return memFn({ acao: 'gravar', hipotese: d.hipotese, tags: (d.tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean),
          evidencia: [{ metrica: d.metrica, valor: d.valor, amostra: d.amostra, fonte: d.fonte || 'informado na tela' }] })
          .then(function (r) { aviso(r.acao === 'fundido' ? 'Já existia um parecido: a medição foi somada a ele.' : 'Aprendizado gravado.'); });
      }, rota);
      tela.querySelectorAll('[data-resultado]').forEach(function (f) {
        f.addEventListener('submit', function (ev) {
          ev.preventDefault(); var d = dados(f); d.acao = 'resultado'; d.id = f.dataset.resultado;
          memFn(d).then(function (r) { aviso('Resultado salvo: ' + r.status + ', confiança ' + Number(r.confianca).toFixed(2) + '.'); return memoria(); }).catch(erro);
        });
      });
      var bc = document.getElementById('consolidar');
      if (bc) bc.addEventListener('click', function () {
        bc.disabled = true; bc.textContent = 'Consolidando…';
        memFn({ acao: 'consolidar' }).then(function () { return rota(); }).catch(function (e) { bc.disabled = false; bc.textContent = 'Consolidar agora'; erro(e); });
      });
    });
  }

  // ---------- operação: gasto de IA, teste de conexão e últimas execuções ----------
  var usd = function (v, casas) { return 'US$ ' + Number(v || 0).toFixed(casas == null ? 2 : casas); };
  function operacao() {
    return Promise.all([
      api('/rest/v1/rpc/gasto_ia', { metodo: 'POST', corpo: {} }),
      api('/rest/v1/config?select=chave,valor'),
      api('/rest/v1/execucoes_agente?select=*&order=criado_em.desc&limit=50'),
    ]).then(function (r) {
      var g = r[0][0] || {}, cfg = Object.fromEntries(r[1].map(function (c) { return [c.chave, c.valor]; })), ex = r[2];
      var dono = perfil.papel === 'dono';
      var barra = function (v, t) { var pct = t > 0 ? Math.min(100, (v / t) * 100) : 100; return '<div class="barra' + (pct >= 80 ? ' alto' : '') + '"><span style="width:' + pct.toFixed(0) + '%"></span></div>'; };
      tela.innerHTML = '<h1>Operação</h1>' +
        '<p>Robôs: <b class="' + (cfg.sistema_ativo ? '' : 'ruim') + '">' + (cfg.sistema_ativo ? 'ligados' : 'parados') + '</b> <small class="mut">(o botão de parada chega na Fase 9; testes manuais funcionam mesmo parado)</small></p>' +
        '<div class="numeros">' +
        '<div><b>' + usd(g.hoje_usd, 4) + '</b>hoje, de ' + usd(g.teto_diario_usd) + barra(Number(g.hoje_usd), Number(g.teto_diario_usd)) + '</div>' +
        '<div><b>' + usd(g.mes_usd, 4) + '</b>no mês, de ' + usd(g.teto_mensal_usd) + barra(Number(g.mes_usd), Number(g.teto_mensal_usd)) + '</div></div>' +
        (dono ? '<form class="linha" id="form-tetos"><label>Teto diário US$ <input name="teto_diario_usd" type="number" min="0" step="0.01" value="' + esc(cfg.teto_diario_usd) + '" class="curto"></label>' +
          '<label>Teto mensal US$ <input name="teto_mensal_usd" type="number" min="0" step="0.01" value="' + esc(cfg.teto_mensal_usd) + '" class="curto"></label><button type="submit">Salvar tetos</button></form>' +
          '<h2>Testar conexão</h2><p class="mut">Uma chamada curta no modelo mais barato de cada um (custa frações de centavo).</p>' +
          '<div class="linha"><button type="button" data-testar="anthropic">Testar Claude</button><button type="button" data-testar="openai">Testar ChatGPT</button></div><pre id="resultado-teste" class="resultado" hidden></pre>' : '') +
        '<h2>Últimas execuções</h2><table class="tab"><thead><tr><th>Quando</th><th>Provedor / modelo</th><th>Papel</th><th class="num">Tokens</th><th class="num">Custo</th><th class="num">Tempo</th><th>Resultado</th></tr></thead><tbody>' +
        (ex.map(function (e) {
          return '<tr><td>' + esc(dataHora(e.criado_em)) + '</td><td>' + esc(e.provedor) + '<br><small class="mut">' + esc(e.modelo) + '</small></td><td>' + esc(e.papel) + '</td>' +
            '<td class="num">' + esc(e.tokens_entrada) + ' / ' + esc(e.tokens_saida) + '</td><td class="num">' + esc(usd(e.custo_usd, 5)) + '</td><td class="num">' + (e.duracao_ms != null ? (e.duracao_ms / 1000).toFixed(1) + ' s' : '') + '</td>' +
            '<td>' + (e.sucesso ? 'ok' : '<span class="ruim">' + esc(e.erro) + '</span>') +
            (e.memorias && e.memorias.length ? '<br><small class="mut">usou memória ' + e.memorias.map(function (m) { return '#' + esc(m.slice(0, 8)); }).join(', ') + '</small>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan="7" class="mut">Nenhuma execução ainda.</td></tr>') + '</tbody></table>';
      if (!dono) return;
      enviar('form-tetos', function (d) {
        return Promise.all(['teto_diario_usd', 'teto_mensal_usd'].map(function (k) {
          return api('/rest/v1/config?chave=eq.' + k, { metodo: 'PATCH', corpo: { valor: Number(d[k] || 0) }, retorno: true });
        }));
      }, rota);
      tela.querySelectorAll('[data-testar]').forEach(function (b) {
        b.addEventListener('click', function () {
          var saida = document.getElementById('resultado-teste');
          tela.querySelectorAll('[data-testar]').forEach(function (x) { x.disabled = true; });
          saida.hidden = false; saida.textContent = 'Chamando ' + b.textContent.replace('Testar ', '') + '…';
          api('/functions/v1/ia-teste', { metodo: 'POST', corpo: { provedor: b.dataset.testar } })
            .then(function (r) { saida.textContent = r.modelo + ': ' + r.texto + '\n' + r.tokensEntrada + ' tokens de entrada, ' + r.tokensSaida + ' de saída, ' + usd(r.custoUsd, 6) + ', ' + (r.duracaoMs / 1000).toFixed(1) + ' s'; })
            .catch(function (e) { saida.textContent = 'Recusado: ' + e.message; })
            .then(function () { setTimeout(rota, 2500); });
        });
      });
    });
  }

  window.CQ_CRM = {
    iniciar: function (ctx) {
      api = ctx.api; perfil = ctx.perfil; tela = document.getElementById('tela');
      if (!window.CQ_CRM.ouvindo) { window.addEventListener('hashchange', rota); window.CQ_CRM.ouvindo = true; }
      rota();
    },
  };
})();
