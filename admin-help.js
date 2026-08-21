// [VZ] admin-help — extracted from admin-help.html
(function () {
    'use strict';

const links    = document.querySelectorAll('.help-topics .topic-chip');
    const sections = Array.from(links).map(a => document.querySelector(a.getAttribute('href')));

    function activeSection() {
        const y = window.scrollY + 100;
        let current = sections[0];
        for (const sec of sections) {
            if (sec && sec.offsetTop <= y) current = sec;
        }
        if (!current && !sections[0]) return null;
    return current ? current.id : (sections[0] ? sections[0].id : null);
    }
    let lastId = null;
    function syncNav() {
        const id = activeSection();
        if (!id || id === lastId) return;
        lastId = id;
        links.forEach(a => a.classList.toggle('current', a.getAttribute('href') === '#' + id));
    }
    // Filtro de busca: digitar filtra os chips visíveis pelo texto, sem
    // mexer no scroll nem na seção ativa.
    (function () {
        var input = document.getElementById('helpTopicsSearch');
        var empty = document.getElementById('helpTopicsEmpty');
        if (!input) return;
        var todosOsItens = Array.from(document.querySelectorAll('.help-topics > *')); // chips E rótulos, na ordem real do DOM
        input.addEventListener('input', function () {
            var q = input.value.trim().toLowerCase();
            var visibleCount = 0;
            todosOsItens.forEach(function (el) {
                if (!el.classList.contains('topic-chip')) return; // rótulos são tratados depois, olhando pra frente
                var match = !q || el.textContent.toLowerCase().indexOf(q) !== -1;
                el.classList.toggle('chip-hidden', !match);
                if (match) visibleCount++;
            });
            // [VZ] Fase 27b — um rótulo de grupo só aparece se pelo menos um
            // chip depois dele (até o próximo rótulo) continuar visível.
            var grupoAtualTemChipVisivel = false;
            var rotuloAtual = null;
            todosOsItens.forEach(function (el) {
                if (el.classList.contains('topic-group-label')) {
                    if (rotuloAtual) rotuloAtual.classList.toggle('chip-hidden', !grupoAtualTemChipVisivel);
                    rotuloAtual = el;
                    grupoAtualTemChipVisivel = false;
                } else if (el.classList.contains('topic-chip') && !el.classList.contains('chip-hidden')) {
                    grupoAtualTemChipVisivel = true;
                }
            });
            if (rotuloAtual) rotuloAtual.classList.toggle('chip-hidden', !grupoAtualTemChipVisivel);

            if (empty) empty.hidden = visibleCount !== 0;
        });
    })();

    window.addEventListener('scroll', syncNav, { passive: true });
    syncNav();

    // ── NUKE BUTTON — arm-then-confirm pattern ───────────────
    (function () {
        var btn = document.getElementById('btnNukeAll');
        if (!btn) return;

        var label    = document.getElementById('nukeLabel');
        var armed    = false;
        var countdown = null;
        var count    = 5;

        function disarm() {
            armed = false;
            count = 5;
            clearInterval(countdown);
            btn.classList.remove('armed');
            label.textContent = 'Encerrar tudo';
            btn.disabled = false;
        }

        btn.addEventListener('click', async function () {
            if (btn.classList.contains('firing')) return;

            if (!armed) {
                // ── ARM ───────────────────────────────────────────
                armed = true;
                count = 5;
                btn.classList.add('armed');
                label.textContent = 'Confirmar? (' + count + ')';

                countdown = setInterval(function () {
                    count--;
                    if (count <= 0) { disarm(); return; }
                    label.textContent = 'Confirmar? (' + count + ')';
                }, 1000);

            } else {
                // ── FIRE ──────────────────────────────────────────
                clearInterval(countdown);
                armed = false;
                btn.classList.remove('armed');
                btn.classList.add('firing');
                btn.disabled = true;
                label.textContent = 'Encerrando…';

                try {
                    var res = await fetch('/api/sessions/all', {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    if (!res.ok) throw new Error('server error');

                    btn.classList.remove('firing');
                    btn.classList.add('success');
                    label.textContent = '✓ Pronto — saindo…';

                    setTimeout(function () {
                        window.location.href = '/login.html';
                    }, 1400);

                } catch (_) {
                    btn.classList.remove('firing');
                    btn.disabled = false;
                    label.textContent = 'Erro — tente novamente';
                    setTimeout(disarm, 2500);
                }
            }
        });

        // Disarm if user clicks anywhere else
        document.addEventListener('click', function (e) {
            if (armed && e.target !== btn && !btn.contains(e.target)) {
                disarm();
            }
        });
    })();

    // ── CONTACT BUTTONS — number assembled in JS, never in HTML ──
    (function () {
        var waBtn    = document.getElementById('btnContactWa');
        var emailBtn = document.getElementById('btnContactEmail');

        if (waBtn) {
            waBtn.addEventListener('click', function () {
                var d = waBtn.dataset;
                var num  = d.p1 + d.p2 + d.p3 + d.p4;
                var text = encodeURIComponent('Olá Rory! Vim pelo painel da Trip Visuals e preciso de suporte.');
                window.open('https://wa.me/' + num + '?text=' + text, '_blank', 'noopener');
            });
        }

        if (emailBtn) {
            emailBtn.addEventListener('click', function () {
                var d = emailBtn.dataset;
                window.location.href = 'mailto:' + d.u + '@' + d.d
                    + '?subject=' + encodeURIComponent('Suporte — Trip Visuals')
                    + '&body=Ola+Rory%2C';
            });
        }
    })();

    links.forEach(a => {
        a.addEventListener('click', e => {
            const target = document.querySelector(a.getAttribute('href'));
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', a.getAttribute('href'));
        });
    });

    // [VZ] Fase 27 — modal de imagem pros GIFs/screenshots do manual.
    // Clique em qualquer imagem dentro de .help-gif abre ela em tamanho
    // grande, com a legenda real (puxada do figcaption ao lado, não
    // duplicada à mão). Reaproveita o <dialog> nativo já corrigido antes
    // pra centralização — mesmo padrão do resto do site.
    (function () {
        const dlg      = document.getElementById('dlgMediaViewer');
        const imgGrande = document.getElementById('mediaViewerImg');
        const legenda   = document.getElementById('mediaViewerLegenda');
        const btnFechar = document.getElementById('btnFecharMediaViewer');
        if (!dlg || !imgGrande) return;

        document.querySelectorAll('.help-gif img').forEach(function (img) {
            img.style.cursor = 'zoom-in';
            img.setAttribute('tabindex', '0');
            img.setAttribute('role', 'button');
            img.setAttribute('aria-label', 'Ampliar imagem: ' + (img.alt || ''));

            function abrir() {
                imgGrande.src = img.src;
                imgGrande.alt = img.alt;
                const fig = img.closest('figure');
                const cap = fig ? fig.querySelector('figcaption') : null;
                legenda.textContent = cap ? cap.textContent : '';
                dlg.showModal();
            }
            img.addEventListener('click', abrir);
            img.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
            });
        });

        function fechar() { dlg.close(); }
        btnFechar.addEventListener('click', fechar);
        dlg.addEventListener('click', function (e) {
            if (e.target === dlg) fechar(); // clique fora da imagem, no fundo do dialog
        });
    })();
})();