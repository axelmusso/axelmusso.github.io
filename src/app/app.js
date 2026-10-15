// Área logada: login (senha ou link por e-mail), sessão e perfil.
// Fala direto com a API do Supabase (Auth e REST), sem biblioteca. Só usa a chave pública;
// o que cada um pode ver é decidido pelas regras RLS no banco, não por esta página.
(function () {
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ''; };
  var SB = meta('cq-supabase-url'), KEY = meta('cq-supabase-key');
  var GUARDA = 'cq-sessao';
  var VOLTA = location.origin + '/app/';
  var $ = function (id) { return document.getElementById(id); };
  var telas = ['carregando', 'entrar', 'sem-acesso', 'app'];
  var mostrar = function (id) { telas.forEach(function (t) { $(t).hidden = t !== id; }); };
  var sessao = null, timer = null;

  // ---------- sessão guardada no navegador ----------
  function guardar(s) {
    sessao = s;
    try { s ? localStorage.setItem(GUARDA, JSON.stringify(s)) : localStorage.removeItem(GUARDA); } catch (_) {}
    clearTimeout(timer);
    // renova um minuto antes de vencer
    if (s) timer = setTimeout(renovar, Math.max(5, s.expires_at - agora() - 60) * 1000);
  }
  function lerGuardada() { try { return JSON.parse(localStorage.getItem(GUARDA)); } catch (_) { return null; } }
  var agora = function () { return Math.floor(Date.now() / 1000); };
  function deResposta(r) {
    return { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at || agora() + (r.expires_in || 3600), user: r.user };
  }

  // ---------- chamadas ao Supabase ----------
  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    var h = { apikey: KEY, 'Content-Type': 'application/json' };
    if (opcoes.retorno) h.Prefer = 'return=representation';
    if (opcoes.prefer) h.Prefer = opcoes.prefer;
    h.Authorization = 'Bearer ' + (sessao && !opcoes.anonimo ? sessao.access_token : KEY);
    return fetch(SB + caminho, { method: opcoes.metodo || 'GET', headers: h, body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined })
      .then(function (res) {
        return res.text().then(function (t) {
          var dados = null; try { dados = t ? JSON.parse(t) : null; } catch (_) {}
          if (!res.ok) { var e = new Error(traduzir(dados, res.status)); e.status = res.status; throw e; }
          return dados;
        });
      });
  }
  function traduzir(d, status) {
    if (d && d.erro) return d.erro; // mensagem já em português, vinda das nossas Edge Functions
    var m = (d && (d.msg || d.error_description || d.message || d.error)) || '';
    if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(m)) return 'Confirme o e-mail antes de entrar (veja a caixa de entrada).';
    if (/already registered|already been registered/i.test(m)) return 'Este e-mail já tem conta. Use Entrar.';
    if (/signups? not allowed|signup is disabled/i.test(m)) return 'Novos cadastros estão desligados.';
    if (/rate limit|too many/i.test(m) || status === 429) return 'Muitas tentativas. Espere alguns minutos.';
    if (/password/i.test(m)) return 'Senha fraca: use pelo menos 8 caracteres.';
    if (/duplicate key/i.test(m)) return 'Já existe um registro igual (mesmo domínio ou e-mail).';
    if (/check constraint/i.test(m)) return 'Algum campo tem valor inválido (ex.: UF com 2 letras maiúsculas, nota de 0 a 100).';
    if (/row-level security|permission denied/i.test(m)) return 'Seu papel não permite essa alteração.';
    return m || 'Erro ' + status + '. Tente de novo.';
  }

  function renovar() {
    if (!sessao) return Promise.reject(new Error('sem sessão'));
    return api('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', anonimo: true, corpo: { refresh_token: sessao.refresh_token } })
      .then(function (r) { guardar(deResposta(r)); })
      .catch(function (e) { guardar(null); mostrar('entrar'); throw e; });
  }

  // Entra na área: confere o usuário no servidor e lê o perfil (o banco só devolve o próprio).
  function abrir() {
    var pronto = sessao.expires_at - agora() < 60 ? renovar() : Promise.resolve();
    return pronto
      .then(function () { return api('/auth/v1/user'); })
      .then(function (u) { return api('/rest/v1/perfis?select=id,nome,papel,email&id=eq.' + encodeURIComponent(u.id)); })
      .then(function (linhas) {
        var p = linhas && linhas[0];
        if (!p || !p.papel) { mostrar('sem-acesso'); return; }
        $('quem').textContent = p.email;
        mostrar('app');
        // Telas do CRM (crm.js) usam a mesma chamada autenticada.
        if (window.CQ_CRM) window.CQ_CRM.iniciar({ api: api, perfil: p });
      })
      .catch(function (e) {
        if (e.status === 401 || e.status === 403) { guardar(null); mostrar('entrar'); aviso('Sessão encerrada. Entre de novo.'); }
        else { mostrar('entrar'); aviso('Não consegui falar com o servidor: ' + e.message); }
      });
  }

  // ---------- tela de entrada ----------
  var criando = false;
  var form = $('form-entrar');
  var aviso = function (t, ok) { var m = $('msg-entrar'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); };
  var ocupado = function (b) { form.querySelectorAll('button').forEach(function (x) { x.disabled = b; }); };

  $('btn-modo').addEventListener('click', function () {
    criando = !criando;
    $('campo-nome').hidden = !criando;
    $('btn-principal').textContent = criando ? 'Criar conta' : 'Entrar';
    $('btn-modo').textContent = criando ? 'Já tenho conta' : 'Criar conta';
    $('btn-link').hidden = criando;
    $('entrar-sub').textContent = criando ? 'Crie sua conta com e-mail e senha (mínimo 8 caracteres).' : 'Entre com seu e-mail e senha.';
    form.senha.autocomplete = criando ? 'new-password' : 'current-password';
    aviso('');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim(), senha = form.senha.value;
    if (!form.email.checkValidity() || !email) return aviso('Informe um e-mail válido.');
    if (senha.length < 8) return aviso('A senha precisa ter pelo menos 8 caracteres.');
    ocupado(true); aviso('');
    var pedido = criando
      ? api('/auth/v1/signup?redirect_to=' + encodeURIComponent(VOLTA), { metodo: 'POST', anonimo: true, corpo: { email: email, password: senha, data: { nome: form.nome.value.trim() || undefined } } })
      : api('/auth/v1/token?grant_type=password', { metodo: 'POST', anonimo: true, corpo: { email: email, password: senha } });
    pedido.then(function (r) {
      form.senha.value = '';
      if (r && r.access_token) { guardar(deResposta(r)); return abrir(); }
      aviso('Conta criada. Abra o e-mail de confirmação que enviamos para ' + email + ' e depois entre aqui.', true);
    }).catch(function (err) { aviso(err.message); }).then(function () { ocupado(false); });
  });

  $('btn-link').addEventListener('click', function () {
    var email = form.email.value.trim();
    if (!email || !form.email.checkValidity()) return aviso('Escreva seu e-mail acima para receber o link.');
    ocupado(true); aviso('');
    // create_user:false — o link só serve para quem já tem conta
    api('/auth/v1/otp?redirect_to=' + encodeURIComponent(VOLTA), { metodo: 'POST', anonimo: true, corpo: { email: email, create_user: false } })
      .then(function () { aviso('Se houver conta com esse e-mail, o link de acesso chega em instantes.', true); })
      .catch(function (err) { aviso(err.message); })
      .then(function () { ocupado(false); });
  });

  document.querySelectorAll('[data-sair]').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = sessao;
      guardar(null); mostrar('entrar'); aviso('Você saiu.', true);
      if (s) fetch(SB + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } }).catch(function () {});
    });
  });

  // ---------- início ----------
  // Volta do link por e-mail (ou da confirmação de cadastro): a sessão vem no endereço, depois do #.
  var h = new URLSearchParams(location.hash.slice(1));
  if (h.get('access_token') || h.get('error_description')) history.replaceState(null, '', location.pathname);
  if (!SB || !KEY) { mostrar('entrar'); aviso('Supabase não configurado neste build.'); return; }
  if (h.get('error_description')) { mostrar('entrar'); aviso(/expired|invalid/i.test(h.get('error_description')) ? 'O link expirou ou já foi usado. Peça outro.' : h.get('error_description')); return; }
  if (h.get('access_token')) {
    guardar({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: Number(h.get('expires_at')) || agora() + Number(h.get('expires_in') || 3600) });
  } else {
    var s = lerGuardada();
    if (s && s.refresh_token) guardar(s);
  }
  if (sessao) abrir(); else mostrar('entrar');
})();
