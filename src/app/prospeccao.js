// Prospecção (Fase 6, parte A): importar a base de clientes, descobrir empresas, qualificar, escrever e aprovar rascunhos.
// A planilha de clientes é lida AQUI, no navegador, e vai direto para o banco: não passa por nenhum outro lugar.
(function () {
  var api, perfil, tela;
  var DATA_ATIVO = '2026-06-01'; // comprou desta data em diante = cliente ativo, não recebe contato
  // Grupo de cadastro → o que a empresa usa. MOV (moveleiro) usa vernizes; MET (metalizadoras) verniz UV, solventes e tintas ABS; 3D só resinas 3D; o resto, mensagem geral.
  var PERFIL_DO_GRUPO = { MOV: 'verniz', MET: 'metalizacao', '3D': 'resina3d' };
  // De onde veio o e-mail do contato (LGPD: a fonte fica registrada).
  var ORIGEM = { base_clientes: 'da planilha', site: 'achado no site', receita_federal: 'do cadastro do CNPJ', indicado: 'indicado pela empresa', resposta: 'veio na resposta' };
  var SITUACAO_FEIRA = { com_lista: 'lista pública', sem_lista: 'sem lista on-line', a_verificar: 'a verificar', fora_do_escopo: 'fora do escopo' };
  var NOME_PERFIL = { verniz: 'usa verniz', metalizacao: 'metalizadora', resina3d: 'só resina 3D', geral: 'perfil geral' };
  var GENERICOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br', 'icloud.com', 'msn.com'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var q = encodeURIComponent;
  var dataHoraBR = function (s) { return s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; };
  var fn = function (corpo) { return api('/functions/v1/prospeccao', { metodo: 'POST', corpo: corpo }); };
  var envio = function (corpo) { return api('/functions/v1/envio', { metodo: 'POST', corpo: corpo }); };
  // Que tipo de e-mail é o rascunho (as respostas a clientes ficam na "Caixa de respostas", separada).
  function tipoRascunho(m) {
    return (m.refeito_de ? 'Refeito com o seu motivo · ' : '') + tipoBase(m);
  }
  function tipoBase(m) {
    var ex = m.empresas && m.empresas.relacao === 'ex_cliente';
    if (m.angulo === 'indicacao') return '1º contato com pessoa indicada';
    if (m.passo === 1) return ex ? '1º e-mail de retomada (ex-cliente)' : '1º contato (empresa nova)';
    if (m.passo >= 2 && m.passo <= 4) return 'Continuação ' + m.passo + ' de 4' + (ex ? ' (ex-cliente)' : '') + ': ainda sem resposta';
    if (m.passo >= 5) return 'Nova tentativa depois de 2 meses sem resposta';
    return 'E-mail';
  }
  var CLASSE = { interessado: 'Interessado', pergunta: 'Pergunta', nao_agora: 'Não agora', nao: 'Não', descadastro: 'Descadastro', automatica: 'Resposta automática' };
  var podeEscrever = function () { return perfil.papel === 'dono' || perfil.papel === 'operador'; };
  var pendente = null; // mensagem que precisa sobreviver ao redesenho da tela
  function aviso(texto, ruim) {
    pendente = [texto, ruim];
    var a = document.getElementById('aviso-prosp');
    if (!a) return;
    a.className = 'aviso' + (ruim ? ' ruim' : '');
    a.textContent = texto;
    a.hidden = !texto;
  }

  // ---------- leitor de .xlsx sem biblioteca (zip + XML, com o descompactador do próprio navegador) ----------
  async function lerXlsx(arquivo) {
    var buf = new Uint8Array(await arquivo.arrayBuffer());
    var dv = new DataView(buf.buffer);
    var fimDir = -1;
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { fimDir = i; break; }
    if (fimDir < 0) throw new Error('Este arquivo não parece ser uma planilha .xlsx.');
    var total = dv.getUint16(fimDir + 10, true), p = dv.getUint32(fimDir + 16, true), arquivos = {};
    for (var k = 0; k < total; k++) {
      var nLen = dv.getUint16(p + 28, true), eLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true);
      arquivos[new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nLen))] = { metodo: dv.getUint16(p + 10, true), tam: dv.getUint32(p + 20, true), local: dv.getUint32(p + 42, true) };
      p += 46 + nLen + eLen + cLen;
    }
    async function ler(nome) {
      var a = arquivos[nome]; if (!a) return null;
      var ini = a.local + 30 + dv.getUint16(a.local + 26, true) + dv.getUint16(a.local + 28, true);
      var dados = buf.subarray(ini, ini + a.tam);
      if (a.metodo === 0) return new TextDecoder().decode(dados);
      return new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    }
    var xml = function (t) { return new DOMParser().parseFromString(t, 'application/xml'); };
    var textoDe = function (no) { return Array.prototype.map.call(no.getElementsByTagName('t'), function (t) { return t.textContent; }).join(''); };
    var compart = [];
    var ss = await ler('xl/sharedStrings.xml');
    if (ss) compart = Array.prototype.map.call(xml(ss).getElementsByTagName('si'), textoDe);
    var nomeFolha = Object.keys(arquivos).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort()[0];
    if (!nomeFolha) throw new Error('A planilha não tem nenhuma aba.');
    var linhas = Array.prototype.map.call(xml(await ler(nomeFolha)).getElementsByTagName('row'), function (r) {
      var o = {};
      Array.prototype.forEach.call(r.getElementsByTagName('c'), function (c) {
        var col = (c.getAttribute('r') || '').replace(/\d+/g, ''), tipo = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        o[col] = tipo === 's' ? compart[Number(v && v.textContent)] : tipo === 'inlineStr' ? textoDe(c) : v ? v.textContent : '';
      });
      return o;
    });
    var cab = linhas.shift() || {};
    return linhas.map(function (l) { var o = {}; Object.keys(cab).forEach(function (col) { if (cab[col]) o[String(cab[col]).trim()] = l[col] == null ? '' : String(l[col]).trim(); }); return o; });
  }

  // Encontra a coluna pelo nome, sem depender de acento ou maiúscula.
  var norm = function (s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  function coluna(linha, nomes) { var ks = Object.keys(linha); for (var i = 0; i < nomes.length; i++) { var k = ks.find(function (x) { return norm(x) === norm(nomes[i]); }); if (k) return k; } return null; }
  function dataExcel(v) {
    if (!v) return null;
    if (/^\d+(\.\d+)?$/.test(v)) { var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 864e5); return d.toISOString().slice(0, 10); }
    var m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
  }
  var emailsDe = function (s) { return (String(s || '').toLowerCase().match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []); };

  async function importar(arquivo, saida) {
    saida.textContent = 'Lendo a planilha no seu navegador…';
    var linhas = await lerXlsx(arquivo);
    if (!linhas.length) throw new Error('A planilha está vazia.');
    var C = {
      razao: coluna(linhas[0], ['Razão social', 'Razao social']), fantasia: coluna(linhas[0], ['Fantasia', 'Nome fantasia']),
      doc: coluna(linhas[0], ['CNPJ/CPF', 'CNPJ']), uf: coluna(linhas[0], ['UF']), email: coluna(linhas[0], ['E-mail cad', 'E-mail', 'Email']),
      f1: coluna(linhas[0], ['Fone 1', 'Telefone']), f2: coluna(linhas[0], ['Fone 2']), cel: coluna(linhas[0], ['Celular']),
      data: coluna(linhas[0], ['Dt.últ', 'Dt.ult', 'Data última compra']), grupo: coluna(linhas[0], ['Abr.Grp.Cad.', 'Grp.Cad.']),
    };
    if (!C.doc || !C.data || !(C.razao || C.fantasia)) throw new Error('Não achei as colunas esperadas (CNPJ/CPF, Razão social ou Fantasia, Dt.últ).');
    // Junta linhas da mesma empresa (mesmo CNPJ), ficando com a compra mais recente.
    var porDoc = {};
    linhas.forEach(function (l) {
      var doc = String(l[C.doc] || '').replace(/\D/g, '');
      if (doc.length !== 11 && doc.length !== 14) return;
      var e = porDoc[doc] || (porDoc[doc] = { doc: doc, nome: '', razao: '', fantasia: '', uf: '', grupo: '', data: null, emails: [], fones: [] });
      e.nome = e.nome || l[C.fantasia] || l[C.razao];
      e.razao = e.razao || (C.razao ? l[C.razao] : '');
      e.fantasia = e.fantasia || (C.fantasia ? l[C.fantasia] : '');
      e.uf = e.uf || String(l[C.uf] || '').toUpperCase().trim();
      e.grupo = e.grupo || (C.grupo ? l[C.grupo] : '');
      var d = dataExcel(l[C.data]); if (d && (!e.data || d > e.data)) e.data = d;
      emailsDe(l[C.email]).forEach(function (m) { if (e.emails.indexOf(m) < 0) e.emails.push(m); });
      [C.f1, C.f2, C.cel].forEach(function (c) { var f = c && String(l[c] || '').trim(); if (f && e.fones.indexOf(f) < 0) e.fones.push(f); });
    });
    var lista = Object.keys(porDoc).map(function (k) { return porDoc[k]; });
    // Mesma empresa com outro CNPJ (mesma razão social ou mesmo nome fantasia): vale a compra mais recente do grupo.
    // Se qualquer CNPJ dela comprou a partir de DATA_ATIVO, todos ficam como cliente ativo.
    var pai = {}, raiz = function (d) { while (pai[d] !== d) d = pai[d] = pai[pai[d]]; return d; };
    lista.forEach(function (e) { pai[e.doc] = e.doc; });
    var porNome = {};
    lista.forEach(function (e) {
      [e.razao, e.fantasia].forEach(function (n) {
        var k = norm(n || ''); if (k.length < 4) return;
        if (porNome[k]) pai[raiz(e.doc)] = raiz(porNome[k]); else porNome[k] = e.doc;
      });
    });
    var maisRecente = {};
    lista.forEach(function (e) { var r = raiz(e.doc); if (e.data && (!maisRecente[r] || e.data > maisRecente[r])) maisRecente[r] = e.data; });
    lista.forEach(function (e) { e.ativo = !!(maisRecente[raiz(e.doc)] && maisRecente[raiz(e.doc)] >= DATA_ATIVO); });
    var semDoc = linhas.length - linhas.filter(function (l) { var d = String(l[C.doc] || '').replace(/\D/g, ''); return d.length === 11 || d.length === 14; }).length;
    var ativos = lista.filter(function (e) { return e.ativo; });
    saida.textContent = 'Gravando ' + lista.length + ' empresas…';

    // 1) Empresas: grava ou atualiza pelo CNPJ (reimportar não duplica).
    var ids = {};
    for (var i = 0; i < lista.length; i += 100) {
      var lote = lista.slice(i, i + 100).map(function (e) {
        var ativo = e.ativo, g = String(e.grupo || '').toUpperCase().replace(/\s/g, '');
        return { cnpj: e.doc, nome: String(e.nome).slice(0, 200), uf: /^[A-Z]{2}$/.test(e.uf) ? e.uf : null, grupo: e.grupo || null, telefone: e.fones[0] || null,
          ultima_compra: e.data, relacao: ativo ? 'cliente_ativo' : 'ex_cliente', status: ativo ? 'cliente' : 'prospect', origem: 'base_clientes',
          perfil_produto: PERFIL_DO_GRUPO[g] || 'geral', perfil_fonte: 'grupo de cadastro ' + (e.grupo || '(vazio)') };
      });
      var r = await api('/rest/v1/empresas?on_conflict=cnpj&select=id,cnpj', { metodo: 'POST', corpo: lote, prefer: 'resolution=merge-duplicates,return=representation' });
      r.forEach(function (x) { ids[x.cnpj] = x.id; });
      saida.textContent = 'Empresas: ' + Math.min(i + 100, lista.length) + ' de ' + lista.length + '…';
    }
    // 2) Contatos da base: troca os antigos pelos da planilha.
    var todos = Object.keys(ids).map(function (k) { return ids[k]; });
    for (var j = 0; j < todos.length; j += 80) {
      await api('/rest/v1/contatos?origem=eq.base_clientes&empresa_id=in.(' + todos.slice(j, j + 80).join(',') + ')', { metodo: 'DELETE' });
    }
    var contatos = [];
    lista.forEach(function (e) {
      var ativo = e.ativo;
      var base = ativo ? 'Cliente atual (execução de contrato)' : 'Legítimo interesse (relação comercial anterior)';
      var itens = e.emails.length ? e.emails : [null];
      itens.forEach(function (m, n) {
        contatos.push({ empresa_id: ids[e.doc], email: m, telefone: n === 0 ? e.fones.join(' / ') || null : null, origem: 'base_clientes', base_legal: base, coletado_em: new Date().toISOString(), pode_contatar: !ativo });
      });
    });
    for (var c = 0; c < contatos.length; c += 100) await api('/rest/v1/contatos', { metodo: 'POST', corpo: contatos.slice(c, c + 100) });
    // 3) Clientes ativos: e-mails e domínios próprios entram na lista de não contatar (motivo "cliente").
    await api('/rest/v1/lista_supressao?motivo=eq.cliente', { metodo: 'DELETE' });
    var sup = [], vistos = {};
    ativos.forEach(function (e) {
      e.emails.forEach(function (m) {
        if (!vistos[m]) { vistos[m] = 1; sup.push({ email: m, dominio: null, motivo: 'cliente' }); }
        var dom = m.split('@')[1];
        if (GENERICOS.indexOf(dom) < 0 && !vistos['@' + dom]) { vistos['@' + dom] = 1; sup.push({ email: null, dominio: dom, motivo: 'cliente' }); }
      });
    });
    for (var s = 0; s < sup.length; s += 100) await api('/rest/v1/lista_supressao', { metodo: 'POST', corpo: sup.slice(s, s + 100) });
    return { empresas: lista.length, ativos: ativos.length, retomada: lista.length - ativos.length, contatos: contatos.filter(function (x) { return x.email; }).length, supressoes: sup.length, ignoradas: semDoc };
  }

  // ---------- tela ----------
  var NOME_REL = { prospect: 'Prospect', cliente_ativo: 'Cliente ativo', ex_cliente: 'Ex-cliente' };
  var filtroProsp = 'fila';
  var filtroRasc = 'pendentes'; // e-mails para aprovar: pendentes (ainda não aprovados), aprovados ou todos
  function render() {
    var w = podeEscrever();
    return Promise.all([
      api('/rest/v1/emails?select=id,empresa_id,para,passo,angulo,assunto,corpo,status,erro,criado_em,memorias,refeito_de,empresas(nome,relacao,perfil_produto,perfil_fonte,icp_score),contatos(origem)&status=in.(rascunho,aprovado)&order=criado_em'),
      api('/rest/v1/config?select=chave,valor&chave=in.(icp,email_assinatura)'),
      api('/rest/v1/empresas?select=relacao,icp_score,qualificado_em,sem_gancho&limit=5000'),
      api('/rest/v1/respostas?select=*,empresas(nome)&status=in.(nova,aprovada)&order=recebido_em'),
      api('/rest/v1/emails?select=id,para,assunto,passo,enviado_em,eventos,empresa_id,empresas(nome)&status=eq.enviado&order=enviado_em.desc&limit=15'),
      envio({ acao: 'status' }).catch(function (e) { return { erro: e.message }; }),
      api('/rest/v1/feiras?select=*&order=situacao,nome'),
    ]).then(function (r) {
      // Mesma ordem do envio: follow-ups, 1º contato com empresa nova (maior nota primeiro), 1º contato com ex-cliente.
      var ordemRasc = function (m) { return m.passo > 1 ? 0 : (m.empresas && m.empresas.relacao === 'ex_cliente') ? 2 : 1; };
      r[0].sort(function (a, b) { return ordemRasc(a) - ordemRasc(b) || ((b.empresas && b.empresas.icp_score) || 0) - ((a.empresas && a.empresas.icp_score) || 0); });
      var rasc = r[0], cfg = Object.fromEntries(r[1].map(function (c) { return [c.chave, c.valor]; })), emp = r[2], resps = r[3], enviados = r[4], st = r[5], feiras = r[6];
      var icp = cfg.icp || { criterios: [], nota_minima: 50 };
      var conta = function (f) { return emp.filter(f).length; };
      // Respostas de clientes ficam no topo: vêm antes de qualquer e-mail novo e saem no mesmo dia quando aprovadas.
      var caixa = '<section class="caixa-respostas' + (resps.length ? ' tem' : '') + '"><h2>Respostas de clientes <small class="mut">' + resps.length + '</small></h2>' +
        (resps.length ? '<p class="mut">Responda primeiro. Aprovada de segunda a sexta, das 8h às 18h, a resposta sai na hora; fora disso, sai às 8h do próximo dia útil, antes de qualquer outro e-mail.</p>' : '') +
        (resps.map(function (x) {
          return '<div class="item resposta"><small class="mut">' + esc(dataHoraBR(x.recebido_em)) + ' · de ' + esc(x.de) + (x.empresas ? ' · <a href="#empresa/' + esc(x.empresa_id) + '">' + esc(x.empresas.nome) + '</a>' : ' · não ligada a envio') +
            ' · <b>' + esc(CLASSE[x.classificacao] || 'sem classificação') + '</b>' + (x.status === 'aprovada' ? ' · <b>aprovada, sai sozinha no próximo horário comercial (8h, dia útil)</b>' : '') + '</small><p><b>' + esc(x.assunto) + '</b></p><div class="texto">' + esc(x.texto.slice(0, 3000)) + '</div>' +
            (w ? '<form class="grade" data-resposta="' + esc(x.id) + '"><label class="largo">Resposta sugerida (edite à vontade)<textarea name="texto" rows="5">' + esc(x.rascunho || '') + '</textarea></label>' +
              '<div class="largo linha"><button type="submit" name="acao" value="enviar" class="prim">Aprovar e enviar</button>' + (x.classificacao ? '' : '<button type="submit" name="acao" value="classificar">Classificar e rascunhar</button>') + '<button type="submit" name="acao" value="descartar">Descartar</button></div></form>' : '') + '</div>';
        }).join('') || '<p class="mut">Nenhuma resposta esperando.</p>') + '</section>';
      tela.innerHTML = '<h1>Prospecção</h1><p id="aviso-prosp" class="aviso" hidden></p>' + caixa +
        '<div class="numeros">' +
        '<div><b>' + conta(function (e) { return e.relacao === 'prospect'; }) + '</b>prospects</div>' +
        '<div><b>' + conta(function (e) { return e.relacao === 'prospect' && e.icp_score >= icp.nota_minima && !e.sem_gancho; }) + '</b>qualificados (nota ≥ ' + icp.nota_minima + ')</div>' +
        '<div><b>' + conta(function (e) { return e.relacao === 'ex_cliente'; }) + '</b>ex-clientes (retomada)</div>' +
        '<div><b>' + conta(function (e) { return e.relacao === 'cliente_ativo'; }) + '</b>clientes ativos (protegidos)</div>' +
        '<div><b>' + rasc.filter(function (m) { return m.status !== 'aprovado'; }).length + '</b>e-mails aguardando você</div></div>' +
        '<h2>Envio</h2>' + (st.erro ? '<p class="ruim">' + esc(st.erro) + '</p>' :
          '<p>Hoje: <b>' + esc(st.enviados) + ' de ' + esc(st.limite) + '</b> e-mails de prospecção (aquecimento: dia ' + esc(st.dias_de_aquecimento + 1) + ', teto ' + esc(st.teto) + '/dia). ' +
          (st.dia_de_iniciais ? '<span>Pode sair tudo agora.</span>' : st.horario_comercial ? '<span class="ruim">Hoje só saem respostas e follow-ups; o 1º e-mail (empresas novas e ex-clientes) sai de terça a quinta.</span>' : '<span class="ruim">Fora do horário comercial: nada sai agora.</span>') + '</p>' +
          '<p class="mut">Regra: respostas a clientes vêm primeiro e saem no mesmo dia (não contam no limite do dia). Depois, os follow-ups. Os dois saem de segunda a sexta, das 8h às 18h (Brasília). O 1º e-mail só sai de terça a quinta: primeiro para empresas novas (maior nota primeiro) e, por último, para ex-clientes, no máximo 15% dos e-mails do dia. Sem resposta em 14 dias, a cadência passa para outro e-mail da empresa (área de compras ou produção primeiro; nota fiscal e financeiro por último), até alguém responder ou acabarem os e-mails.</p>') +
        (w ? '<div class="linha"><button type="button" class="prim" id="enviar-agora">Enviar aprovados agora</button>' + (perfil.papel === 'dono' && !st.erro && !st.horario_comercial ? '<button type="button" id="enviar-teste">Enviar aprovados agora (teste fora do horário)</button>' : '') + '<button type="button" id="preparar">Preparar próximos e-mails da cadência</button></div>' : '') +

        '<h2>E-mails para aprovar</h2><p class="mut">Primeiros contatos, continuações da cadência e retomadas. As respostas a quem escreveu para nós ficam no topo da tela.</p>' +
        '<div class="linha abas">' + [['pendentes', 'Não aprovados', rasc.filter(function (m) { return m.status !== 'aprovado'; }).length], ['aprovados', 'Aprovados, esperando o envio', rasc.filter(function (m) { return m.status === 'aprovado'; }).length], ['todos', 'Todos', rasc.length]].map(function (a) {
          return '<button type="button" data-filtro-rasc="' + a[0] + '"' + (filtroRasc === a[0] ? ' class="prim"' : '') + '>' + a[1] + ' (' + a[2] + ')</button>';
        }).join('') + '</div>' +
        (rasc.filter(function (m) { return filtroRasc === 'todos' || (filtroRasc === 'aprovados') === (m.status === 'aprovado'); }).map(function (m) {
          return '<div class="item email-rasc"><p class="tipo-email">' + esc(tipoRascunho(m)) + (m.status === 'aprovado' ? ' · já aprovado, esperando o envio' : '') + '</p><small class="mut">' + esc(m.empresas && m.empresas.nome) + ' · ' + esc(NOME_REL[m.empresas && m.empresas.relacao] || '') + ' · <span title="' + esc(m.empresas && m.empresas.perfil_fonte) + '">' + esc(NOME_PERFIL[m.empresas && m.empresas.perfil_produto] || '') + '</span> · para ' + esc(m.para) + (m.contatos && ORIGEM[m.contatos.origem] ? ' (' + ORIGEM[m.contatos.origem] + ')' : '') + ' · ' + esc(m.angulo) + (m.memorias && m.memorias.length ? ' · usou memória ' + m.memorias.map(function (x) { return '#' + esc(x.slice(0, 8)); }).join(', ') : '') + '</small>' +
            (m.erro ? '<p class="ruim">' + esc(m.erro) + '</p>' : '') +
            '<form class="grade" data-email="' + esc(m.id) + '"><label class="largo">Assunto<input name="assunto" value="' + esc(m.assunto) + '" maxlength="120"' + (w ? '' : ' disabled') + '></label>' +
            '<label class="largo">Corpo<textarea name="corpo" rows="6"' + (w ? '' : ' disabled') + '>' + esc(m.corpo) + '</textarea></label>' +
            '<div class="largo assinatura"><pre>' + (m.passo === 1 && m.empresas && m.empresas.relacao === 'prospect' ? 'Apresentação da Corquímica (PDF): link\n\n' : '') + esc(cfg.email_assinatura || '') + '\n\nNão quer mais receber estes e-mails? Clique aqui.</pre></div>' +
            (w ? '<div class="largo linha"><button type="submit" name="acao" value="aprovar" class="prim">' + (m.status === 'aprovado' ? 'Salvar (já aprovado)' : 'Aprovar') + '</button><button type="submit" name="acao" value="salvar">Salvar sem aprovar</button><button type="submit" name="acao" value="descartar">Descartar</button></div>' +
              // Descarte com motivo: o robô aprende com ele (refazer o texto ou tirar a empresa das rotinas).
              '<div class="largo descarte" hidden><p><b>Por que descartar?</b> O motivo ensina os robôs.</p>' +
              '<label class="chk"><input type="radio" name="dtipo" value="refazer" checked> O texto não está bom: refazer com ajustes (mesmo endereço)</label>' +
              '<label class="chk"><input type="radio" name="dtipo" value="contato"> O endereço de e-mail não serve: procurar outro contato da empresa (a empresa segue)</label>' +
              '<label class="chk"><input type="radio" name="dtipo" value="empresa"> A empresa não serve: tirar de todas as rotinas</label>' +
              '<label>Motivo<input name="dmotivo" maxlength="500" placeholder="Ex.: é metalizadora, fale de verniz UV · ou: o certo é compras@empresa.com.br"></label>' +
              '<div class="linha"><button type="button" class="prim" data-confirmar-descarte>Confirmar descarte</button><button type="button" class="link" data-cancelar-descarte>Cancelar</button></div></div>' : '') +
            '</form></div>';
        }).join('') || '<p class="mut">' + (filtroRasc === 'aprovados' ? 'Nenhum e-mail aprovado esperando o envio.' : 'Nenhum rascunho esperando.') + '</p>') +

        '<h2>Empresas</h2><div class="linha abas">' +
        [['fila', 'A qualificar'], ['qualificadas', 'Prontas para escrever'], ['retomada', 'Ex-clientes'], ['abaixo', 'Abaixo da nota / sem gancho']].map(function (a) {
          return '<button type="button" data-aba="' + a[0] + '"' + (filtroProsp === a[0] ? ' class="prim"' : '') + '>' + a[1] + '</button>';
        }).join('') + '</div><div id="lista-prosp"><p class="mut">Carregando…</p></div>' +

        // Feiras: fonte constante de leads. Lista lida há mais de 60 dias (ou nunca) pede nova leitura.
        '<h2>Feiras <small class="mut">' + feiras.length + '</small></h2><p class="mut">Listas públicas de expositores. Só entram como prospects os segmentos de plástico; quem já está no cadastro ou na lista de não contatar é pulado.</p>' +
        '<table class="tab"><thead><tr><th>Feira</th><th>Segmento</th><th>Próxima edição</th><th>Situação</th><th>Última leitura</th><th></th></tr></thead><tbody>' + feiras.map(function (f) {
          var velha = f.situacao === 'com_lista' && (!f.ultima_leitura || Date.now() - new Date(f.ultima_leitura).getTime() > 60 * 864e5);
          return '<tr><td>' + (f.site ? '<a href="' + esc(f.site) + '" target="_blank" rel="noopener">' + esc(f.nome) + '</a>' : esc(f.nome)) + '<br><small class="mut">' + esc([f.cidade, f.uf].filter(Boolean).join('/')) + '</small></td><td>' + esc(f.segmento) + '</td><td>' + esc(f.proxima_edicao) + '</td>' +
            '<td title="' + esc(f.observacao) + '">' + esc(SITUACAO_FEIRA[f.situacao] || f.situacao) + '</td><td>' + (f.ultima_leitura ? dataHoraBR(f.ultima_leitura) + ' (' + f.expositores_importados + ' importados)' : '—') + (velha ? ' <b class="ruim">reler</b>' : '') + '</td>' +
            '<td>' + (w && f.situacao === 'com_lista' && f.url_expositores ? '<button type="button" data-feira="' + f.id + '" data-url="' + esc(f.url_expositores) + '">Ler lista</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +

        (w ? '<h2>Descobrir empresas numa página pública</h2><p class="mut">Cole o endereço de uma lista de expositores de feira, associados ou catálogo. O robô respeita o robots.txt e não entra em área com login.</p>' +
          '<form class="linha" id="form-descobrir"><input name="url" type="url" required placeholder="https://…/expositores" style="flex:1 1 300px"><button type="submit">Descobrir</button></form>' : '') +

        (perfil.papel === 'dono' ? '<h2>Importar a base de clientes</h2><p class="mut">Escolha a planilha (.xlsx) exportada do seu sistema. Ela é lida aqui no navegador e vai direto para o banco protegido; não passa por mais nenhum lugar. Quem comprou a partir de ' + DATA_ATIVO.split('-').reverse().join('/') + ' vira <b>cliente ativo</b> (nunca recebe e-mail); os demais entram como <b>ex-cliente</b> para retomada. Reimportar atualiza sem duplicar.</p>' +
          '<form class="linha" id="form-importar"><input type="file" name="arquivo" accept=".xlsx" required><button type="submit">Importar</button></form><pre id="saida-importar" class="resultado" hidden></pre>' : '') +

        '<h2>Últimos enviados</h2><table class="tab"><thead><tr><th>Quando</th><th>Empresa</th><th>Assunto</th><th>Situação</th></tr></thead><tbody>' + (enviados.map(function (m) {
          var ev = (m.eventos || []).map(function (e) { return e.tipo; });
          var sit = ev.indexOf('complained') >= 0 ? '<span class="ruim">marcado como spam</span>' : ev.indexOf('bounced') >= 0 ? '<span class="ruim">voltou (bounce)</span>' : ev.indexOf('delivered') >= 0 ? 'entregue' : ev.indexOf('sent') >= 0 ? 'enviado' : 'aguardando confirmação';
          return '<tr><td>' + esc(dataHoraBR(m.enviado_em)) + '</td><td><a href="#empresa/' + esc(m.empresa_id) + '">' + esc(m.empresas && m.empresas.nome) + '</a><br><small class="mut">' + esc(m.para) + ' · passo ' + esc(m.passo) + '</small></td><td>' + esc(m.assunto) + '</td><td>' + sit + '</td></tr>';
        }).join('') || '<tr><td colspan="4" class="mut">Nada enviado ainda.</td></tr>') + '</tbody></table>' +

        '<details><summary>Como a nota de cliente ideal é calculada</summary><table class="tab"><tbody>' + (icp.criterios || []).map(function (c) { return '<tr><td>' + esc(c.descricao) + '</td><td class="num">' + esc(c.pontos) + '</td></tr>'; }).join('') +
        '<tr><td><b>Abaixo de ' + esc(icp.nota_minima) + ' não recebe e-mail</b></td><td></td></tr></tbody></table></details>';

      if (pendente) { var m = pendente; aviso(m[0], m[1]); pendente = null; }
      ligar(w);
      return listaEmpresas();
    });
  }

  function listaEmpresas() {
    var base = '/rest/v1/empresas?select=id,nome,setor,cidade,uf,site,relacao,icp_score,icp_motivo,icp_criterios,gancho,sem_gancho,ultima_compra,qualificado_em,perfil_produto,perfil_fonte&limit=100';
    var filtros = {
      fila: '&relacao=eq.prospect&qualificado_em=is.null&order=criado_em',
      qualificadas: '&relacao=eq.prospect&icp_score=gte.50&sem_gancho=is.false&order=icp_score.desc',
      retomada: '&relacao=eq.ex_cliente&order=ultima_compra.desc.nullslast',
      abaixo: '&relacao=eq.prospect&qualificado_em=not.is.null&or=(icp_score.lt.50,sem_gancho.is.true)&order=qualificado_em.desc',
    };
    return api(base + filtros[filtroProsp]).then(function (lista) {
      var w = podeEscrever();
      var acao = { fila: ['qualificar', 'Qualificar'], qualificadas: ['redigir', 'Escrever 1º e-mail'], retomada: ['redigir', 'Escrever retomada'], abaixo: ['qualificar', 'Requalificar'] }[filtroProsp];
      document.getElementById('lista-prosp').innerHTML =
        (w && lista.length ? '<p><button type="button" id="lote" data-acao="' + acao[0] + '">' + acao[1] + ' — próximas 5</button> <small class="mut">uma por vez, cada uma leva de 5 a 40 s</small></p>' : '') +
        '<table class="tab"><thead><tr><th>Empresa</th><th class="num">Nota</th><th>Motivo e gancho</th><th></th></tr></thead><tbody>' +
        (lista.map(function (e) {
          return '<tr><td><a href="#empresa/' + esc(e.id) + '">' + esc(e.nome) + '</a><br><small class="mut">' + esc([e.setor, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')) +
            (e.ultima_compra ? ' · última compra ' + esc(e.ultima_compra.split('-').reverse().join('/')) : '') + ' · <span title="' + esc(e.perfil_fonte) + '">' + esc(NOME_PERFIL[e.perfil_produto] || '') + '</span></small></td>' +
            '<td class="num">' + (e.icp_score == null ? '—' : esc(e.icp_score)) + '</td>' +
            '<td><small>' + esc(e.icp_motivo || '') + '</small>' + (e.gancho ? '<br><small><b>Gancho:</b> ' + esc(e.gancho) + '</small>' : '') + (e.sem_gancho && e.qualificado_em ? '<br><small class="ruim">sem gancho</small>' : '') + '</td>' +
            '<td>' + (w ? '<button type="button" data-um="' + acao[0] + '" data-id="' + esc(e.id) + '">' + acao[1] + '</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan="4" class="mut">Nada aqui.</td></tr>') + '</tbody></table>';
      if (!w) return;
      var rodar = function (acaoNome, id) { return fn({ acao: acaoNome, empresa_id: id }); };
      document.querySelectorAll('[data-um]').forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true; b.textContent = 'Trabalhando…';
          rodar(b.dataset.um, b.dataset.id).then(function (r) { aviso(resumo(b.dataset.um, r)); return render(); }).catch(function (e) { aviso(e.message, true); b.disabled = false; b.textContent = acao[1]; });
        });
      });
      var lote = document.getElementById('lote');
      if (lote) lote.addEventListener('click', function () {
        var ids = lista.slice(0, 5).map(function (e) { return e.id; }), feitos = 0, erros = [];
        lote.disabled = true;
        var proximo = function () {
          if (!ids.length) { aviso(feitos + ' feita(s)' + (erros.length ? '; ' + erros.length + ' com problema: ' + erros.join(' | ') : '') + '.', erros.length > 0); return render(); }
          var id = ids.shift(); lote.textContent = 'Trabalhando… (' + (feitos + erros.length + 1) + ' de 5)';
          return rodar(lote.dataset.acao, id).then(function () { feitos++; }).catch(function (e) { erros.push(e.message); }).then(proximo);
        };
        proximo();
      });
    });
  }
  function resumo(acao, r) {
    if (acao === 'qualificar') return 'Nota ' + r.nota + '. ' + (r.gancho ? 'Gancho: ' + r.gancho : 'Sem gancho.') + (r.contatos ? ' ' + r.contatos + ' e-mail(s) público(s) achado(s).' : '') + ' Custo US$ ' + Number(r.custo).toFixed(4) + '.';
    if (r.sem_gancho) return 'Não escrevi: sem gancho específico (' + (r.motivo || '') + ').';
    return 'Rascunho criado: "' + r.assunto + '". Está no topo para você aprovar.' + (r.revisar && r.revisar.length ? ' Atenção: ' + r.revisar.join('; ') : '');
  }

  function ligar(w) {
    document.querySelectorAll('[data-aba]').forEach(function (b) { b.addEventListener('click', function () { filtroProsp = b.dataset.aba; render(); }); });
    document.querySelectorAll('[data-filtro-rasc]').forEach(function (b) { b.addEventListener('click', function () { filtroRasc = b.dataset.filtroRasc; render(); }); });
    document.querySelectorAll('[data-email]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var acao = ev.submitter && ev.submitter.value;
        var corpo = { assunto: f.assunto.value.trim(), corpo: f.corpo.value.trim() };
        if (acao === 'aprovar') { corpo.status = 'aprovado'; corpo.aprovado_por = perfil.id; corpo.aprovado_em = new Date().toISOString(); }
        if (acao === 'descartar') { var d = f.querySelector('.descarte'); d.hidden = false; f.dmotivo.focus(); return; }
        api('/rest/v1/emails?id=eq.' + q(f.dataset.email), { metodo: 'PATCH', corpo: corpo, retorno: true })
          .then(function () { aviso(acao === 'aprovar' ? 'Aprovado. Sai no próximo "Enviar aprovados", dentro do limite e do horário.' : acao === 'descartar' ? 'Rascunho descartado.' : 'Salvo.'); return render(); })
          .catch(function (e) { aviso(e.message, true); });
      });
    });
    // Enter no motivo confirma o descarte (sem isso, o Enter enviaria o formulário pelo primeiro botão: "Aprovar").
    document.querySelectorAll('.descarte input[name=dmotivo]').forEach(function (i) {
      i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); i.closest('.descarte').querySelector('[data-confirmar-descarte]').click(); } });
    });
    document.querySelectorAll('[data-cancelar-descarte]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('.descarte').hidden = true; });
    });
    document.querySelectorAll('[data-confirmar-descarte]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.closest('form'), id = f.dataset.email, tipo = f.dtipo.value, motivo = f.dmotivo.value.trim();
        if (motivo.length < 3) { aviso('Escreva brevemente o motivo: é com ele que os robôs aprendem.', true); f.dmotivo.focus(); return; }
        b.disabled = true; b.textContent = tipo === 'empresa' ? 'Descartando…' : 'Reescrevendo… (até 40 s)';
        api('/rest/v1/rpc/descartar_email', { metodo: 'POST', corpo: { p_email: id, p_tipo: tipo, p_motivo: motivo } })
          .then(function () {
            if (tipo === 'empresa') { aviso('Empresa descartada: saiu de todas as rotinas. O motivo entra na próxima qualificação e na revisão semanal.'); return; }
            b.textContent = tipo === 'contato' ? 'Procurando outro e-mail… (até 1 min)' : b.textContent;
            return fn({ acao: 'refazer', email_id: id }).then(function (r) {
              aviso(r.sem_contato ? 'Endereço descartado. Não achei outro e-mail que combine com a empresa (procurei no site e no CNPJ). Se souber o certo, escreva no motivo ao descartar ou cadastre na ficha da empresa.' :
                r.sem_gancho ? 'Descartado. Não reescrevi: não há algo honesto e novo para dizer a esta empresa (' + (r.motivo || '') + ').' :
                (r.para ? 'Novo rascunho para ' + r.para + ': "' + r.assunto + '".' : 'Reescrito com o seu motivo: "' + r.assunto + '".') + ' Está na lista para aprovar.' + (r.revisar && r.revisar.length ? ' Atenção: ' + r.revisar.join('; ') : ''));
            }, function (e) { aviso('Descartado com o motivo, mas a nova versão não saiu agora (' + e.message + '). Os robôs tentam de novo na próxima rodada da cadência (dias úteis, de hora em hora).', true); });
          })
          .then(function () { return render(); })
          .catch(function (e) { aviso(e.message, true); b.disabled = false; b.textContent = 'Confirmar descarte'; });
      });
    });
    if (!w) return;
    var be = document.getElementById('enviar-agora');
    if (be) be.addEventListener('click', function () {
      if (!confirm('Enviar agora os e-mails aprovados (dentro do limite de hoje)?')) return;
      be.disabled = true; be.textContent = 'Enviando…';
      envio({ acao: 'enviar_aprovados' }).then(function (r) {
        aviso(r.aviso || (r.enviados + ' enviado(s).' + (r.problemas && r.problemas.length ? ' Problemas: ' + r.problemas.join(' | ') : '')), !!(r.problemas && r.problemas.length));
        return render();
      }).catch(function (e) { aviso(e.message, true); be.disabled = false; be.textContent = 'Enviar aprovados agora'; });
    });
    var bt = document.getElementById('enviar-teste');
    if (bt) bt.addEventListener('click', function () {
      if (!confirm('TESTE: enviar agora, fora do horário, os e-mails aprovados? Use só com endereços seus.')) return;
      bt.disabled = true; bt.textContent = 'Enviando…';
      envio({ acao: 'enviar_aprovados', teste: true }).then(function (r) {
        aviso(r.aviso || (r.enviados + ' enviado(s).' + (r.problemas && r.problemas.length ? ' Problemas: ' + r.problemas.join(' | ') : '')), !!(r.problemas && r.problemas.length));
        return render();
      }).catch(function (e) { aviso(e.message, true); bt.disabled = false; });
    });
    var bp = document.getElementById('preparar');
    if (bp) bp.addEventListener('click', function () {
      bp.disabled = true; bp.textContent = 'Escrevendo…';
      envio({ acao: 'preparar' }).then(function (r) {
        aviso(r.vencidas ? r.criados + ' rascunho(s) de continuação criado(s).' + (r.trocas && r.trocas.length ? ' Troca de contato: ' + r.trocas.join(' | ') + '.' : '') + (r.avisos.length ? ' ' + r.avisos.join(' | ') : '') : 'Nenhuma cadência com passo vencido agora.');
        return render();
      }).catch(function (e) { aviso(e.message, true); bp.disabled = false; bp.textContent = 'Preparar próximos e-mails da cadência'; });
    });
    document.querySelectorAll('[data-resposta]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var acao = ev.submitter && ev.submitter.value, id = f.dataset.resposta, b = ev.submitter;
        var feito;
        if (acao === 'enviar') {
          if (!confirm('Enviar esta resposta agora?')) return;
          b.disabled = true; b.textContent = 'Enviando…';
          feito = envio({ acao: 'responder', resposta_id: id, texto: f.texto.value }).then(function (r) { aviso(r.aviso || 'Resposta enviada.'); });
        } else if (acao === 'classificar') {
          b.disabled = true; b.textContent = 'Lendo…';
          feito = envio({ acao: 'classificar', resposta_id: id }).then(function (r) {
            var t = r.telefone_decisor;
            aviso(r.resultado === 'telefone' ? 'Telefone do responsável obtido (' + (t.nome || 'responsável') + ': ' + t.telefone + '). A cadência parou e a tarefa de ligar está em Tarefas.'
              : r.resultado === 'indicado' ? 'A empresa indicou outra pessoa: o contato foi criado e há um rascunho para ela em "E-mails para aprovar".'
              : 'Classificada como ' + (CLASSE[r.classificacao] || r.classificacao) + '.');
          });
        } else {
          feito = api('/rest/v1/respostas?id=eq.' + q(id), { metodo: 'PATCH', corpo: { status: 'descartada' }, retorno: true }).then(function () { aviso('Resposta descartada.'); });
        }
        feito.then(render).catch(function (e) { aviso(e.message, true); b.disabled = false; });
      });
    });
    document.querySelectorAll('[data-feira]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true; b.textContent = 'Lendo…';
        fn({ acao: 'descobrir_url', url: b.dataset.url, feira_id: b.dataset.feira })
          .then(function (r) { aviso(r.encontradas + ' empresa(s) na lista: ' + r.novas + ' nova(s), ' + r.repetidas + ' já existiam ou não podem ser contatadas. Qualifique as novas na aba "A qualificar". Custo US$ ' + Number(r.custo).toFixed(4) + '.'); filtroProsp = 'fila'; return render(); })
          .catch(function (e) { aviso(e.message, true); b.disabled = false; b.textContent = 'Ler lista'; });
      });
    });
    var fd = document.getElementById('form-descobrir');
    if (fd) fd.addEventListener('submit', function (ev) {
      ev.preventDefault(); var b = fd.querySelector('button'); b.disabled = true; b.textContent = 'Lendo a página…';
      fn({ acao: 'descobrir_url', url: fd.url.value.trim() })
        .then(function (r) { aviso(r.encontradas + ' empresa(s) na página: ' + r.novas + ' nova(s), ' + r.repetidas + ' já existiam ou não podem ser contatadas. Custo US$ ' + Number(r.custo).toFixed(4) + '.'); filtroProsp = 'fila'; return render(); })
        .catch(function (e) { aviso(e.message, true); b.disabled = false; b.textContent = 'Descobrir'; });
    });
    var fi = document.getElementById('form-importar');
    if (fi) fi.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var saida = document.getElementById('saida-importar'), b = fi.querySelector('button');
      saida.hidden = false; b.disabled = true;
      importar(fi.arquivo.files[0], saida).then(function (r) {
        fi.reset();
        saida.textContent = 'Pronto.\n' + r.empresas + ' empresas (' + r.ativos + ' clientes ativos protegidos, ' + r.retomada + ' ex-clientes para retomada)\n' +
          r.contatos + ' e-mails de contato\n' + r.supressoes + ' entradas na lista de não contatar (e-mails e domínios dos clientes ativos)' + (r.ignoradas ? '\n' + r.ignoradas + ' linha(s) sem CNPJ/CPF válido foram ignoradas' : '');
      }).catch(function (e) { saida.textContent = 'Não importou: ' + e.message; }).then(function () { b.disabled = false; });
    });
  }

  window.CQ_PROSP = {
    abrir: function (ctx) { api = ctx.api; perfil = ctx.perfil; tela = ctx.tela; return render(); },
  };
})();
