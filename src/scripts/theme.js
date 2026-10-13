// Tema claro/escuro: segue o aparelho até o visitante escolher no botão do cabeçalho; a escolha fica salva.
// Carregado no <head> (sem defer) para aplicar o tema antes de a página aparecer.
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('cq-tema'); } catch (_) {}
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  var dark = function () {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  var sync = function () {
    var b = document.querySelector('.theme-toggle');
    if (!b) return;
    var d = dark();
    b.setAttribute('aria-pressed', String(d));
    b.setAttribute('aria-label', d ? b.dataset.toLight : b.dataset.toDark);
    b.title = b.getAttribute('aria-label');
  };
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.querySelector('.theme-toggle');
    if (!b) return;
    b.hidden = false;
    sync();
    b.addEventListener('click', function () {
      var next = dark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('cq-tema', next); } catch (_) {}
      sync();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  });
})();

// Cabeçalho fixo: na home ele fica transparente sobre o banner e ganha fundo ao rolar a página.
(function () {
  var onScroll = function () {
    var h = document.querySelector('header.site');
    if (h) h.classList.toggle('scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('DOMContentLoaded', onScroll);
})();

// Segmentos da home: a foto troca ao passar o mouse e mantém o último segmento até o próximo (sem voltar à foto geral).
document.addEventListener('DOMContentLoaded', function () {
  var fig = document.querySelector('#segmentos figure.swapper');
  if (!fig) return;
  var current = null;
  var show = function (key) {
    var next = fig.querySelector('.swap[data-seg="' + key + '"]');
    if (!next || next === current) return;
    if (current) {
      var old = current;
      old.classList.remove('on'); old.classList.add('prev');
      setTimeout(function () { old.classList.remove('prev'); }, 400);
    }
    next.classList.remove('prev'); next.classList.add('on');
    current = next;
  };
  document.querySelectorAll('#segmentos .row[data-seg]').forEach(function (row) {
    row.addEventListener('mouseenter', function () { show(row.dataset.seg); });
    row.addEventListener('focus', function () { show(row.dataset.seg); });
  });
});
