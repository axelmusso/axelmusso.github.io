// Formulário de contato: grava o lead no Supabase (se configurado) e abre o WhatsApp com a mensagem pronta.
(function () {
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ''; };
  var wa = meta('cq-wa'), sbUrl = meta('cq-supabase-url'), sbKey = meta('cq-supabase-key');
  document.querySelectorAll('form[data-lead]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      if (f.website && f.website.value) return; // honeypot: robôs
      if (!form.reportValidity()) return;
      var data = {
        contact: f.contact.value.trim().slice(0, 200),
        material: f.material.value,
        segment: f.segment.value,
        message: (f.message.value || '').trim().slice(0, 600),
        product: form.dataset.product || null,
        page: form.dataset.page || location.pathname,
        consent: true
      };
      var text = 'Olá! Vim pelo site da Corquímica.\n' +
        'Nome/empresa: ' + data.contact + '\n' +
        'Material: ' + data.material + '\nSegmento: ' + data.segment +
        (data.product ? '\nProduto: ' + data.product : '') +
        (data.message ? '\nProjeto: ' + data.message : '');
      var url = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(text);
      // abre o WhatsApp no mesmo clique (evita bloqueio de pop-up)
      window.open(url, '_blank', 'noopener');
      if (sbUrl && sbKey) {
        try {
          fetch(sbUrl + '/rest/v1/leads', {
            method: 'POST', keepalive: true,
            headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, Prefer: 'return=minimal' },
            body: JSON.stringify(data)
          }).catch(function () {});
        } catch (_) {}
      }
      var msg = form.querySelector('.msg');
      if (!msg) { msg = document.createElement('p'); msg.className = 'msg'; msg.setAttribute('role', 'status'); form.appendChild(msg); }
      msg.textContent = 'Pronto! O WhatsApp abriu com a sua mensagem. Se não abriu, use o botão verde no canto da tela.';
    });
  });
})();
