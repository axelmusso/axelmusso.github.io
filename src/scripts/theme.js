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
