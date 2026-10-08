// Formulário de contato: grava o lead no Supabase (se configurado) e abre o WhatsApp com a mensagem pronta.
(function () {
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ''; };
  var wa = meta('cq-wa'), sbUrl = meta('cq-supabase-url'), sbKey = meta('cq-supabase-key');
  // Mensagem do WhatsApp no idioma da página.
  var T = {
    pt: { hi: 'Olá! Vim pelo site da Corquímica.', name: 'Nome/empresa', mat: 'Material', seg: 'Segmento', prod: 'Produto', proj: 'Projeto', done: 'Pronto! O WhatsApp abriu com a sua mensagem. Se não abriu, use o botão verde no canto da tela.' },
    es: { hi: '¡Hola! Vengo del sitio web de Corquímica.', name: 'Nombre/empresa', mat: 'Material', seg: 'Sector', prod: 'Producto', proj: 'Proyecto', done: '¡Listo! WhatsApp se abrió con su mensaje. Si no se abrió, use el botón verde en la esquina de la pantalla.' },
    en: { hi: 'Hello! I found you through the Corquímica website.', name: 'Name/company', mat: 'Material', seg: 'Industry', prod: 'Product', proj: 'Project', done: 'Done! WhatsApp opened with your message. If it did not open, use the green button in the corner of the screen.' }
  };
  var t = T[(document.documentElement.lang || 'pt').slice(0, 2)] || T.pt;
  var shown = function (sel) { return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : sel.value; };
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
      var prodName = form.dataset.productName || data.product;
      var text = t.hi + '\n' +
        t.name + ': ' + data.contact + '\n' +
        t.mat + ': ' + shown(f.material) + '\n' + t.seg + ': ' + shown(f.segment) +
        (prodName ? '\n' + t.prod + ': ' + prodName : '') +
        (data.message ? '\n' + t.proj + ': ' + data.message : '');
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
      msg.textContent = t.done;
    });
  });
})();
