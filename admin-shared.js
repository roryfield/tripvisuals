// [VZ] Admin Shared — FAB · Help Drawer · Exit Animation
// Include ONE script tag at end of every admin page <body>.
// No dependencies other than admin.css.
(function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════
       HELP FAB (WhatsApp-style floating button)
    ═══════════════════════════════════════════════════════ */
    function createFAB () {
        var btn = document.createElement('a');
        btn.className  = 'vz-help-fab';
        btn.id         = 'vzHelpFab';
        btn.href       = '#';
        btn.setAttribute('aria-label', 'Abrir manual de ajuda');
        btn.innerHTML  =
            '<span class="vz-help-fab-ring" aria-hidden="true"></span>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            '     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>' +
            '  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' +
            '</svg>';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            openDrawer();
        });
        document.body.appendChild(btn);
    }

    /* ═══════════════════════════════════════════════════════
       HELP DRAWER
    ═══════════════════════════════════════════════════════ */
    var drawerContentLoaded = false;

    function createDrawer () {
        var overlay = document.createElement('div');
        overlay.className = 'vz-help-overlay';
        overlay.id        = 'vzHelpOverlay';
        overlay.addEventListener('click', closeDrawer);

        var drawer = document.createElement('div');
        drawer.className = 'vz-help-drawer';
        drawer.id        = 'vzHelpDrawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-label', 'Manual do sistema');
        drawer.innerHTML =
            '<div class="vz-help-drawer-head">' +
            '  <span class="vz-help-drawer-title">MANUAL</span>' +
            '  <button class="vz-help-drawer-close" id="vzHelpClose" aria-label="Fechar manual">✕</button>' +
            '</div>' +
            '<div class="vz-help-drawer-body" id="vzHelpBody">' +
            '  <div class="vz-help-loading">' +
            '    <div class="vz-help-spinner"></div>' +
            '    <p>Carregando manual...</p>' +
            '  </div>' +
            '</div>' +
            '<div class="vz-help-drawer-foot">' +
            '  <a href="/admin-help.html" class="vz-help-full-link">Abrir manual completo →</a>' +
            '</div>';

        document.body.appendChild(overlay);
        document.body.appendChild(drawer);

        var closeBtn = document.getElementById('vzHelpClose');
        if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeDrawer();
        });
    }

    function openDrawer () {
        var overlay = document.getElementById('vzHelpOverlay');
        var drawer  = document.getElementById('vzHelpDrawer');
        if (!overlay || !drawer) return;
        overlay.classList.add('open');
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
        if (!drawerContentLoaded) loadHelpContent();
        var closeBtn = document.getElementById('vzHelpClose');
        if (closeBtn) setTimeout(function () { closeBtn.focus(); }, 300);
    }

    function closeDrawer () {
        var overlay = document.getElementById('vzHelpOverlay');
        var drawer  = document.getElementById('vzHelpDrawer');
        if (!overlay || !drawer) return;
        overlay.classList.remove('open');
        drawer.classList.remove('open');
        document.body.style.overflow = '';
        var fab = document.getElementById('vzHelpFab');
        if (fab) fab.focus();
    }

    function loadHelpContent () {
        fetch('/admin-help.html')
            .then(function (r) { return r.text(); })
            .then(function (html) {
                var doc    = new DOMParser().parseFromString(html, 'text/html');
                var main   = doc.querySelector('main');
                var target = document.getElementById('vzHelpBody');
                if (!main || !target) return;
                // Strip the page-header (we have our own drawer title)
                var hdr = main.querySelector('.page-header');
                if (hdr) hdr.remove();
                // Strip the help-hero (intro) — keep section content only
                var hero = main.querySelector('.help-hero');
                if (hero) hero.remove();
                // Strip the outer layout wrapper; extract just the section content
                var layout = main.querySelector('.help-layout');
                if (layout) {
                    var sidenav = layout.querySelector('.help-sidenav');
                    if (sidenav) sidenav.remove();
                    target.innerHTML = layout.innerHTML;
                } else {
                    target.innerHTML = main.innerHTML;
                }
                drawerContentLoaded = true;
            })
            .catch(function () {
                var target = document.getElementById('vzHelpBody');
                if (target) target.innerHTML =
                    '<p style="color:#888;padding:24px;font-size:.85rem">' +
                    'Manual temporariamente indisponível.</p>';
            });
    }

    /* ═══════════════════════════════════════════════════════
       EXIT ANIMATION  (mirrors the login loading screen)
    ═══════════════════════════════════════════════════════ */
    function createExitOverlay () {
        var el = document.createElement('div');
        el.className = 'vz-exit-overlay';
        el.id        = 'vzExitOverlay';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML =
            '<div class="vz-exit-content">' +
            '  <div class="vz-exit-spinner"></div>' +
            '  <p class="vz-exit-msg">Encerrando sessão...</p>' +
            '</div>';
        document.body.appendChild(el);
    }

    function triggerLogout () {
        if (!confirm('Sair da conta?')) return;

        // Fade-in the exit overlay
        var overlay = document.getElementById('vzExitOverlay');
        if (overlay) overlay.classList.add('active');

        fetch('/api/logout', { method: 'POST' })
            .catch(function () { /* still redirect on failure */ })
            .finally(function () {
                setTimeout(function () {
                    window.location.replace('/login.html');
                }, 2000);
            });
    }

    /* ═══════════════════════════════════════════════════════
       WIRE UP LOGOUT BUTTONS
       Replaces the inline onclick handlers already present.
    ═══════════════════════════════════════════════════════ */
    function wireLogout () {
        document.querySelectorAll('.btn-logout, #btnLogout').forEach(function (btn) {
            // Clone to strip existing listeners, then reattach
            var fresh = btn.cloneNode(true);
            btn.parentNode.replaceChild(fresh, btn);
            fresh.addEventListener('click', triggerLogout);
        });
    }

    /* ═══════════════════════════════════════════════════════
       INIT
    ═══════════════════════════════════════════════════════ */
    function init () {
        createFAB();
        createDrawer();
        createExitOverlay();
        wireLogout();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
