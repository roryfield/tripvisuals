// [VZ] Trip Visuals Wear — Catalog page logic (external for strict CSP)
(function () {
    'use strict';

    // ── XSS SAFETY ──────────────────────────────────────────────
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ── FALLBACK IMAGE ───────────────────────────────────────────
    var FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 320">' +
        '<rect fill="#0a0a0a" width="400" height="320"/>' +
        '<text x="200" y="160" fill="#444" text-anchor="middle" dy=".3em" ' +
        'font-family="sans-serif" font-size="14" letter-spacing="2">SEM IMAGEM</text>' +
        '</svg>'
    );

    function setImgFallback(img) {
        img.onerror = function () { this.src = FALLBACK_IMG; this.onerror = null; };
    }

    // ── STATE ────────────────────────────────────────────────────
    var todosProdutos = [];
    var searchAberta  = false;
    var NUMERO_LOJA   = '5511940537169';

    // ── LAYOUT ───────────────────────────────────────────────────
    function setLayout(layout) {
        document.getElementById('vitrine').className = layout;
        ['grid-1', 'grid-2', 'grid-3'].forEach(function (l) {
            var btn = document.getElementById('lt-' + l);
            if (!btn) return;
            btn.classList.toggle('active', l === layout);
            btn.setAttribute('aria-pressed', l === layout ? 'true' : 'false');
        });
        try { sessionStorage.setItem('cliente_layout', layout); } catch (_) {}
    }

    // ── SEARCH ───────────────────────────────────────────────────
    function toggleSearch() {
        var input = document.getElementById('searchInput');
        var btn   = document.getElementById('searchToggle');
        searchAberta = !searchAberta;
        input.classList.toggle('open', searchAberta);
        btn.classList.toggle('active', searchAberta);
        if (searchAberta) {
            setTimeout(function () { input.focus(); }, 350);
        } else {
            input.value = '';
            fecharResultados();
        }
    }

    function fecharSearchSeVazio() {
        var input = document.getElementById('searchInput');
        if (!input.value.trim()) {
            setTimeout(function () {
                searchAberta = false;
                input.classList.remove('open');
                var btn = document.getElementById('searchToggle');
                if (btn) btn.classList.remove('active');
                fecharResultados();
            }, 200);
        }
    }

    function fecharResultados() {
        var el = document.getElementById('searchResults');
        if (el) el.classList.remove('visible');
    }

    function filtrarProdutos(query) {
        var box = document.getElementById('searchResults');
        var q   = query.trim().toLowerCase();
        if (!q) { fecharResultados(); return; }

        var found = todosProdutos.filter(function (p) {
            return p.nome.toLowerCase().includes(q);
        });
        box.classList.add('visible');

        if (found.length === 0) {
            box.innerHTML = '<p class="sr-label">Resultados</p>' +
                '<p class="sr-empty">Nenhum produto encontrado para "' + esc(query) + '"</p>';
            return;
        }

        box.innerHTML = '<p class="sr-label">' + found.length +
            ' resultado' + (found.length > 1 ? 's' : '') +
            '</p><div class="sr-grid" id="srGrid"></div>';

        var grid = document.getElementById('srGrid');
        found.forEach(function (p) {
            var btn = document.createElement('button');
            btn.className = 'sr-item';
            btn.type      = 'button';
            btn.innerHTML =
                '<img src="' + esc(p.imagem_url || '') + '" alt="">' +
                '<div class="sr-item-info">' +
                '<div class="sr-item-name">' + esc(p.nome) + '</div>' +
                '<div class="sr-item-price">R$ ' + Number(p.preco).toFixed(2) + '</div>' +
                '</div>';
            // Set onerror via JS property — CSP-safe
            var img = btn.querySelector('img');
            if (img) setImgFallback(img);
            btn.addEventListener('click', function () { abrirModal(p); });
            grid.appendChild(btn);
        });
    }

    document.addEventListener('click', function (e) {
        if (!e.target.closest('.search-wrap') && !e.target.closest('#searchResults')) {
            fecharResultados();
        }
    });

    // ── PURCHASE ─────────────────────────────────────────────────
    function comprarItem(nome, preco) {
        var texto = 'Olá, equipe Trip Visuals! 🛸\n\n' +
            'Vim pelo site e tenho interesse neste artefato:\n' +
            '*Item:* ' + nome + '\n' +
            '*Valor:* R$ ' + Number(preco).toFixed(2) + '\n\n' +
            'Poderiam me ajudar com os tamanhos e o cálculo do frete para o meu CEP?';
        window.open(
            'https://wa.me/' + NUMERO_LOJA + '?text=' + encodeURIComponent(texto),
            '_blank', 'noopener'
        );
    }

    // ── SKELETON LOADING ─────────────────────────────────────────
    function renderSkeleton(count) {
        var vitrine = document.getElementById('vitrine');
        vitrine.className = 'skeleton-grid';
        var html = '';
        for (var i = 0; i < count; i++) {
            html += '<div class="skeleton-card" aria-hidden="true">' +
                '<div class="skeleton-img"></div>' +
                '<div class="skeleton-text"></div>' +
                '<div class="skeleton-text short"></div>' +
                '</div>';
        }
        vitrine.innerHTML = html;
    }

    // ── RENDER ────────────────────────────────────────────────────
    function renderProdutos(lista) {
        var vitrine = document.getElementById('vitrine');
        vitrine.innerHTML = '';

        if (lista.length === 0) {
            vitrine.innerHTML =
                '<div class="state-msg">' +
                '<span class="icon" aria-hidden="true">👕</span>' +
                '<p>Coleção sendo montada. Volte em breve!</p>' +
                '<p class="vz-ig-hint">Siga no Instagram para novidades.</p>' +
                '</div>';
            return;
        }

        lista.forEach(function (p, i) {
            var btn = document.createElement('button');
            btn.className = 'card-produto';
            btn.type      = 'button';
            btn.setAttribute('aria-label', p.nome + (p.cor ? ' — ' + p.cor : '') + ' — R$ ' + Number(p.preco).toFixed(2) + ' — Ver detalhes');
            btn.style.setProperty('--card-delay', Math.min(i * 40, 600) + 'ms');
            btn.innerHTML =
                '<img src="' + esc(p.imagem_url || '') + '" alt="' + esc(p.nome) + '" loading="lazy">' +
                '<div class="buy-overlay" aria-hidden="true">' +
                '<div class="buy-pill">Ver detalhes</div>' +
                '</div>' +
                '<div class="card-info">' +
                '<h3>' + esc(p.nome) + '</h3>' +
                '<div class="card-meta">' +
                (p.cor ? '<span class="cor-badge">' + esc(p.cor) + '</span>' : '') +
                '<span class="price">R$ ' + Number(p.preco).toFixed(2) + '</span>' +
                '</div>' +
                '</div>';
            // Set onerror via JS property — CSP-safe
            var img = btn.querySelector('img');
            if (img) setImgFallback(img);
            btn.addEventListener('click', function () { abrirModal(p); });
            vitrine.appendChild(btn);
        });
    }

    // ── PRODUCT MODAL ────────────────────────────────────────────
    var modalProduto = null;

    function abrirModal(p) {
        modalProduto = p;
        var modal      = document.getElementById('productModal');
        var img        = document.getElementById('modalImg');
        var titleEl    = document.getElementById('modalTitle');
        var corEl      = document.getElementById('modalCor');
        var priceEl    = document.getElementById('modalPrice');
        if (!modal) return;

        img.src    = p.imagem_url || '';
        img.alt    = p.nome;
        setImgFallback(img);
        titleEl.textContent = p.nome;
        corEl.textContent   = p.cor || '';
        priceEl.textContent = 'R$ ' + Number(p.preco).toFixed(2);

        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        // Focus the close button for keyboard users
        var closeBtn = document.getElementById('modalClose');
        if (closeBtn) setTimeout(function () { closeBtn.focus(); }, 50);
    }

    function fecharModal() {
        var modal = document.getElementById('productModal');
        if (!modal) return;
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        modalProduto = null;
    }

    function initModal() {
        var modal     = document.getElementById('productModal');
        var backdrop  = document.getElementById('modalBackdrop');
        var closeBtn  = document.getElementById('modalClose');
        var buyBtn    = document.getElementById('modalBuy');
        if (!modal) return;

        if (closeBtn) closeBtn.addEventListener('click', fecharModal);
        if (backdrop) backdrop.addEventListener('click', fecharModal);
        if (buyBtn)   buyBtn.addEventListener('click', function () {
            if (modalProduto) comprarItem(modalProduto.nome, modalProduto.preco);
        });
        document.addEventListener('keydown', function (e) {
            if (!modal.classList.contains('open')) return;
            if (e.key === 'Escape') { fecharModal(); return; }
            // Focus trap — keep Tab inside the modal
            if (e.key === 'Tab') {
                var focusables = [closeBtn, buyBtn].filter(Boolean);
                if (focusables.length === 0) return;
                var first = focusables[0], last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault(); last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault(); first.focus();
                }
            }
        });
    }

    // ── INIT ─────────────────────────────────────────────────────
    function initEventListeners() {
        initModal();
        var searchToggle = document.getElementById('searchToggle');
        var searchInput  = document.getElementById('searchInput');
        var layoutBtns   = document.querySelectorAll('.lt-btn');
        var logoEl       = document.getElementById('landingLogo');

        if (searchToggle) searchToggle.addEventListener('click', toggleSearch);
        if (searchInput) {
            searchInput.addEventListener('input', function () { filtrarProdutos(this.value); });
            searchInput.addEventListener('blur', fecharSearchSeVazio);
        }
        layoutBtns.forEach(function (btn) {
            btn.addEventListener('click', function () { setLayout(this.id.replace('lt-', '')); });
        });
        // Logo onerror — CSP-safe
        if (logoEl) logoEl.onerror = function () { this.style.display = 'none'; };
    }

    async function carregar() {
        renderSkeleton(6);

        var cfg = {};
        try {
            var resCfg = await fetch('/api/config');
            cfg = resCfg.ok ? await resCfg.json() : {};
        } catch (_) {}

        var adminLayout  = cfg.layout_padrao || 'grid-3';
        var sessaoLayout = null;
        try { sessaoLayout = sessionStorage.getItem('cliente_layout'); } catch (_) {}
        setLayout(sessaoLayout || adminLayout);

        if (cfg.landing_whatsapp) {
            var m = cfg.landing_whatsapp.match(/wa\.me\/(\d+)/);
            if (m) NUMERO_LOJA = m[1];
        }

        if (cfg.landing_logo_url) {
            var logo = document.getElementById('landingLogo');
            if (logo) logo.src = cfg.landing_logo_url;
        }

        var waBtn = document.getElementById('whatsappBtn');
        if (waBtn) {
            waBtn.href = 'https://wa.me/' + NUMERO_LOJA +
                '?text=' + encodeURIComponent('Olá! Vim pelo catálogo Trip Visuals 🛸');
        }

        try {
            var resProd   = await fetch('/api/produtos');
            todosProdutos = resProd.ok ? await resProd.json() : [];
            renderProdutos(todosProdutos);
        } catch (e) {
            document.getElementById('vitrine').innerHTML =
                '<div class="state-msg">' +
                '<span class="icon" aria-hidden="true">⚠️</span>' +
                '<p>Erro ao carregar produtos. Tente novamente.</p>' +
                '</div>';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initEventListeners();
            carregar();
        });
    } else {
        initEventListeners();
        carregar();
    }
})();
