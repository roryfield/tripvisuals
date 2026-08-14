// [VZ] Admin Shared — FAB · Help Drawer · Exit Animation · Navegação
// Include ONE script tag at end of every admin page <body>.
// No dependencies other than admin.css.
(function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════
       NAVEGAÇÃO — fonte única, renderiza sidebar (desktop) e
       barra inferior (mobile) a partir dos mesmos dados. Evita
       duplicar a lista de 6 destinos em 10 arquivos HTML.
    ═══════════════════════════════════════════════════════ */
    var NAV_ITEMS = [
        {
            id: 'hub', href: '/admin-hub.html', label: 'Hub',
            icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        },
        {
            id: 'upload', href: '/admin.html', label: 'Upload',
            icon: '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
        },
        {
            id: 'produtos', href: '/admin-produtos.html', label: 'Produtos',
            icon: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
        },
        {
            id: 'aparencia', href: '/admin-landing.html', label: 'Marca & Vitrine',
            icon: '<rect x="2" y="4" width="20" height="14" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="8" y1="22" x2="16" y2="22"/><line x1="12" y1="18" x2="12" y2="22"/>',
        },
        {
            id: 'catalogo', href: '/catalogo.html', label: 'Catálogo', external: true,
            icon: '<path d="M1 6s1-1 4-1 5 2 8 2 4-1 4-1V22s-1 1-4 1-5-2-8-2-4 1-4 1V6z"/><line x1="1" y1="6" x2="1" y2="22"/>',
        },
        {
            id: 'pedidos', href: '/admin-pedidos.html', label: 'Pedidos',
            icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
        },
    ];

    function currentNavId () {
        var path = window.location.pathname;
        if (path.indexOf('admin-hub') !== -1)      return 'hub';
        if (path.indexOf('admin-produtos') !== -1) return 'produtos';
        if (path.indexOf('admin-landing') !== -1)  return 'aparencia';
        if (path.indexOf('admin-layout') !== -1)   return 'aparencia'; // redireciona pra landing
        if (path.indexOf('admin-pedidos') !== -1)  return 'pedidos';
        if (path.indexOf('admin-catalogador') !== -1) return 'upload'; // ainda sob "Upload" até a Oficina existir
        if (/\/admin\.html$/.test(path))           return 'upload';
        return null; // páginas fora do fluxo principal (Ajuda, Sobre) — nenhum item marcado ativo
    }

    function iconSvg (pathsInner) {
        return '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
               'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + pathsInner + '</svg>';
    }

    function renderTab (item, activeId, variant) {
        var isActive = item.id === activeId;
        var cls = variant === 'sidebar' ? 'sidebar-tab' : 'nav-tab';
        if (isActive) cls += ' active';
        if (item.external) cls += ' external';
        var extraAttrs = item.external ? ' target="_blank" rel="noopener"' : '';
        var current = isActive ? ' aria-current="page"' : '';
        return '<a href="' + item.href + '" class="' + cls + '" id="' + variant + '-tab-' + item.id + '"' +
               current + extraAttrs + '>' + iconSvg(item.icon) +
               '<span>' + item.label + '</span></a>';
    }

    function createNav () {
        var activeId = currentNavId();

        var sidebar = document.createElement('nav');
        sidebar.className = 'admin-sidebar';
        sidebar.setAttribute('aria-label', 'Navegação admin (desktop)');
        sidebar.innerHTML = '<div class="admin-sidebar-brand">VDZN</div>' +
            NAV_ITEMS.map(function (item) { return renderTab(item, activeId, 'sidebar'); }).join('');
        document.body.insertBefore(sidebar, document.body.firstChild);

        // Remove a nav inferior estática, se o arquivo ainda tiver uma
        // (páginas antigas antes desta troca) — evita duplicar.
        var existing = document.querySelector('nav.admin-nav');
        if (existing) existing.remove();

        var bottom = document.createElement('nav');
        bottom.className = 'admin-nav';
        bottom.setAttribute('aria-label', 'Navegação admin (mobile)');
        bottom.innerHTML = NAV_ITEMS.map(function (item) { return renderTab(item, activeId, 'nav'); }).join('');
        document.body.appendChild(bottom);
    }

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
                    var topicsBar = layout.querySelector('.help-topics-bar');
                    if (topicsBar) topicsBar.remove();
                    target.innerHTML = layout.innerHTML;
                } else {
                    target.innerHTML = main.innerHTML;
                }
                drawerContentLoaded = true;
            })
            .catch(function () {
                var target = document.getElementById('vzHelpBody');
                if (target) target.innerHTML =
                    '<p class="vz-empty-state">' +
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
            '  <p class="vz-exit-brand">TRIP VISUALS</p>' +
            '  <div class="vz-exit-spinner"></div>' +
            '  <p class="vz-exit-msg">Encerrando sessão...</p>' +
            '  <p class="vz-exit-credit">Sistema por VOIDZONE</p>' +
            '</div>';
        document.body.appendChild(el);
    }

    function triggerLogout () {
        if (!confirm('Sair da conta?')) return;

        // Fade-in the exit overlay
        var overlay = document.getElementById('vzExitOverlay');
        if (overlay) overlay.classList.add('active');

        fetch('/api/logout', { method: 'POST', credentials: 'include' })
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
        createNav();
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
