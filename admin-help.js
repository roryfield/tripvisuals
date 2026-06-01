// [VZ] admin-help — extracted from admin-help.html
(function () {
    'use strict';

const links    = document.querySelectorAll('.help-sidebar a');
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
    // Safety net: hide sidebar on narrow screens even if CSS is cached from old version
    function applySidebarVisibility() {
        var sidebar = document.querySelector('.help-sidebar');
        if (!sidebar) return;
        if (window.innerWidth <= 900) {
            sidebar.style.display = 'none';
        } else {
            sidebar.style.display = '';  // let CSS take over on wide screens
        }
    }
    applySidebarVisibility();
    window.addEventListener('resize', applySidebarVisibility, { passive: true });

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
})();