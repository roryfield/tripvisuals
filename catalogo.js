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
    var todosProdutos  = [];
    var activeFilters = { tipo: '', genero: '' };
    var searchAberta  = false;
    var NUMERO_LOJA   = '5511940537169';

    // [VZ] Checkout automático — false até /api/checkout/status confirmar
    // que o CNPJ/Asaas estão configurados. Enquanto isso, o botão de PIX
    // fica oculto e o fluxo é 100% WhatsApp, como hoje.
    var checkoutAutomaticoHabilitado = false;
    var pixPollTimer = null;
    var pixPedidoId  = null;

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
            return p.nome.toLowerCase().includes(q)
                || (p.tipo   || '').toLowerCase().includes(q)
                || (p.genero || '').toLowerCase().includes(q)
                || (p.descricao || '').toLowerCase().includes(q);
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
    function comprarItem(nome, preco, tamanho) {
        var texto = 'Olá, equipe Trip Visuals! 🛸\n\n' +
            'Vim pelo catálogo e tenho interesse neste item:\n\n' +
            '*Item:* ' + nome + '\n' +
            '*Tamanho:* ' + tamanho + '\n' +
            '*Valor base:* R$ ' + Number(preco).toFixed(2) + '\n\n' +
            'Poderia me confirmar a disponibilidade nesse tamanho e calcular o frete para o meu CEP?';
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
    function applyFilters(lista) {
        var f = activeFilters;
        return lista.filter(function (p) {
            var matchTipo   = !f.tipo   || (p.tipo   || '').toLowerCase() === f.tipo.toLowerCase();
            var matchGenero = !f.genero || (p.genero || '').toLowerCase() === f.genero.toLowerCase();
            return matchTipo && matchGenero;
        });
    }

    function renderProdutos(lista) {
        var vitrine = document.getElementById('vitrine');
        var filtered = applyFilters(lista);
        vitrine.innerHTML = '';

        // Update active count
        var countEl = document.getElementById('filterCount');
        if (countEl) {
            var hasFilter = activeFilters.tipo || activeFilters.genero;
            countEl.textContent = hasFilter
                ? filtered.length + ' de ' + lista.length + ' produtos'
                : lista.length + ' produtos';
        }

        if (filtered.length === 0) {
            vitrine.innerHTML =
                '<div class="state-msg">' +
                '<span class="icon" aria-hidden="true">🔍</span>' +
                '<p>Nenhum produto nessa combinação de filtros.</p>' +
                '<button class="state-clear-filters" type="button">Limpar filtros</button>' +
                '</div>';
            var clr = vitrine.querySelector('.state-clear-filters');
            if (clr) clr.addEventListener('click', function () { limparFiltros(); });
            return;
        }

        filtered.forEach(function (p, i) {
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
                (p.destaque ? '<span class="destaque-badge">Novidade</span>' : '') +
                '<h3>' + esc(p.nome) + '</h3>' +
                '<div class="card-meta">' +
                (p.genero ? '<span class="genero-badge">' + esc(p.genero) + '</span>' : '') +
                (p.cor    ? '<span class="cor-badge">'    + esc(p.cor)    + '</span>' : '') +
                '<span class="price">R$ ' + Number(p.preco).toFixed(2) + '</span>' +
                '</div>' +
                '</div>';
            var img = btn.querySelector('img');
            if (img) setImgFallback(img);
            btn.addEventListener('click', function () { abrirModal(p); });
            vitrine.appendChild(btn);
        });
    }

    function limparFiltros() {
        activeFilters = { tipo: '', genero: '' };
        renderFiltros(todosProdutos);
        renderProdutos(todosProdutos);
    }

    function renderFiltros(lista) {
        var bar = document.getElementById('filterBar');
        if (!bar) return;

        // Compute unique tipos and generos in this product set
        var tipos   = [...new Set(lista.map(p => p.tipo   || '').filter(Boolean))].sort();
        var generos = [...new Set(lista.map(p => p.genero || '').filter(Boolean))].sort();

        var f = activeFilters;

        var tipoHtml = '';
        if (tipos.length > 0) {
            tipoHtml  = '<div class="filter-group" role="group" aria-label="Filtrar por tipo">';
            tipoHtml += '<button class="filter-chip' + (!f.tipo ? ' active' : '') + '" data-filter="tipo" data-value="">Todos</button>';
            tipos.forEach(function (t) {
                tipoHtml += '<button class="filter-chip' + (f.tipo === t ? ' active' : '') + '" data-filter="tipo" data-value="' + esc(t) + '">' + esc(t) + '</button>';
            });
            tipoHtml += '</div>';
        }

        var generoHtml = '';
        if (generos.length >= 1) {
            generoHtml  = '<div class="filter-group" role="group" aria-label="Filtrar por gênero">';
            generoHtml += '<button class="filter-chip' + (!f.genero ? ' active' : '') + '" data-filter="genero" data-value="">Todos</button>';
            generos.forEach(function (g) {
                generoHtml += '<button class="filter-chip' + (f.genero === g ? ' active' : '') + '" data-filter="genero" data-value="' + esc(g) + '">' + esc(g) + '</button>';
            });
            generoHtml += '</div>';
        }

        var clearHtml = (f.tipo || f.genero)
            ? '<button class="filter-clear" type="button" aria-label="Limpar todos os filtros">× Limpar</button>'
            : '';

        var countHtml = '<span class="filter-count" id="filterCount"></span>';

        bar.innerHTML =
            '<div class="filter-bar-inner">' +
            tipoHtml + generoHtml + clearHtml + countHtml +
            '</div>';

        // Wire chip clicks
        bar.querySelectorAll('.filter-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                var key = chip.dataset.filter;
                var val = chip.dataset.value;
                activeFilters[key] = (activeFilters[key] === val) ? '' : val;
                renderFiltros(todosProdutos);
                renderProdutos(todosProdutos);
            });
        });

        // Wire clear button
        var clearBtn = bar.querySelector('.filter-clear');
        if (clearBtn) clearBtn.addEventListener('click', limparFiltros);

        // Update count
        var countEl = document.getElementById('filterCount');
        if (countEl) {
            var filtered = applyFilters(lista);
            var hasFilter = f.tipo || f.genero;
            countEl.textContent = hasFilter
                ? filtered.length + ' de ' + lista.length + ' produtos'
                : lista.length + ' produtos';
        }
    }

    // ── PRODUCT MODAL ────────────────────────────────────────────
    var modalProduto = null;

    function abrirModal(p) {
        // Async click counter — fire-and-forget
        if (p.id) {
            fetch('/api/produtos/' + p.id + '/click', { method: 'POST' }).catch(function(){});
        }
        modalProduto = p;
        var modal      = document.getElementById('productModal');
        var card       = modal && modal.querySelector('.product-modal-card');
        var img        = document.getElementById('modalImg');
        var titleEl    = document.getElementById('modalTitle');
        var corEl      = document.getElementById('modalCor');
        var priceEl    = document.getElementById('modalPrice');
        var tipoEl     = document.getElementById('modalTipo');
        var generoEl   = document.getElementById('modalGenero');
        if (!modal) return;
        // Always reset to detail view on open
        if (card) card.setAttribute('data-state', 'detail');
        var tamanhoEl = document.getElementById('modalTamanho');
        var sizeErrorEl = document.getElementById('modalSizeError');
        if (tamanhoEl) tamanhoEl.value = '';
        if (sizeErrorEl) sizeErrorEl.textContent = '';

        img.src    = p.imagem_url || '';
        img.alt    = p.nome;
        setImgFallback(img);
        titleEl.textContent = p.nome;
        corEl.textContent    = p.cor    || '';
        priceEl.textContent  = 'R$ ' + Number(p.preco).toFixed(2);
        // Custom description if available
        var descEl = modal.querySelector('.product-modal-desc');
        if (descEl) descEl.textContent = p.descricao || 'Estampa disponível em camiseta, regata, babylook ou moletom. Modelo, cor e tamanho são combinados pelo WhatsApp.';
        if (tipoEl)   tipoEl.textContent   = p.tipo   || '';
        if (generoEl) generoEl.textContent = p.genero || '';

        // [VZ] Only offer PIX when the backend confirms it's actually live
        var buyPixBtn = document.getElementById('modalBuyPix');
        if (buyPixBtn) buyPixBtn.hidden = !checkoutAutomaticoHabilitado;

        // Load extra photos for gallery
        var gallery = document.getElementById('modalGallery');
        if (gallery && p.id) {
            gallery.innerHTML = '';
            fetch('/api/produtos/' + p.id + '/fotos').then(function(r){ return r.json(); }).then(function(fotos){
                if (fotos.length > 0) {
                    gallery.innerHTML = fotos.map(function(f){
                        return '<img src="' + esc(f.url) + '" alt="" class="gallery-thumb" loading="lazy">';
                    }).join('');
                    gallery.querySelectorAll('.gallery-thumb').forEach(function(thumb){
                        thumb.addEventListener('click', function(){
                            img.src = thumb.src;
                        });
                    });
                }
            }).catch(function(){});
        }

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
        pararPollingPix();
    }

    function initFaqModal() {
        var faqModal    = document.getElementById('faqModal');
        var faqBtn      = document.getElementById('faqBtn');
        var faqBackdrop = document.getElementById('faqBackdrop');
        var faqClose    = document.getElementById('faqClose');
        if (!faqModal || !faqBtn) return;

        function abrirFaq() {
            faqModal.classList.add('open');
            faqModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            if (faqClose) setTimeout(function () { faqClose.focus(); }, 50);
        }
        function fecharFaq() {
            faqModal.classList.remove('open');
            faqModal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }

        faqBtn.addEventListener('click', abrirFaq);
        if (faqClose)    faqClose.addEventListener('click', fecharFaq);
        if (faqBackdrop) faqBackdrop.addEventListener('click', fecharFaq);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && faqModal.classList.contains('open')) fecharFaq();
        });
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
            if (!modalProduto) return;
            var tamanhoEl = document.getElementById('modalTamanho');
            var sizeErrorEl = document.getElementById('modalSizeError');
            var tamanho = tamanhoEl ? tamanhoEl.value : '';
            if (!tamanho) {
                if (sizeErrorEl) sizeErrorEl.textContent = 'Selecione o tamanho antes de continuar.';
                if (tamanhoEl) tamanhoEl.focus();
                return;
            }
            if (sizeErrorEl) sizeErrorEl.textContent = '';
            comprarItem(modalProduto.nome, modalProduto.preco, tamanho);
            // Flip the modal into success state
            var card = modal.querySelector('.product-modal-card');
            if (card) {
                card.setAttribute('data-state', 'success');
                var continueBtn = document.getElementById('modalContinue');
                if (continueBtn) setTimeout(function () { continueBtn.focus(); }, 500);
            }
        });

        // Continue navigating button closes modal
        var continueBtn = document.getElementById('modalContinue');
        if (continueBtn) continueBtn.addEventListener('click', fecharModal);
        document.addEventListener('keydown', function (e) {
            if (!modal.classList.contains('open')) return;
            if (e.key === 'Escape') { fecharModal(); return; }
            // Focus trap — only cycles through VISIBLE focusables so the
            // hidden buy button (in success state) is never landed on.
            if (e.key === 'Tab') {
                // [VZ] Generic query instead of a hand-listed array — this way
                // the trap stays correct automatically across detail/success/pix
                // states (each shows a different set of buttons/inputs) without
                // needing to be updated every time a state gains a new control.
                var focusables = Array.prototype.slice.call(
                    modal.querySelectorAll('button, input, a[href]')
                ).filter(function (el) {
                    return el.offsetParent !== null && !el.disabled;
                });
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

    // [VZ] CHECKOUT AUTOMÁTICO (PIX) ───────────────────────────────
    // Entirely optional layer on top of the existing WhatsApp flow.
    // If /api/checkout/status ever reports enabled:false (the default,
    // until CNPJ + Asaas are configured), none of this is reachable —
    // the PIX button stays hidden and behavior is identical to today.
    function verificarCheckoutStatus() {
        fetch('/api/checkout/status')
            .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
            .then(function (d) { checkoutAutomaticoHabilitado = !!d.enabled; })
            .catch(function () { checkoutAutomaticoHabilitado = false; });
    }

    function pararPollingPix() {
        if (pixPollTimer) { clearInterval(pixPollTimer); pixPollTimer = null; }
        pixPedidoId = null;
    }

    function iniciarPollingPix(pedidoId) {
        pararPollingPix();
        pixPedidoId = pedidoId;
        pixPollTimer = setInterval(function () {
            fetch('/api/pedidos/' + pedidoId + '/status')
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.payment_status === 'pago') {
                        pararPollingPix();
                        var waiting = document.getElementById('pixWaiting');
                        if (waiting) waiting.innerHTML = '✅ Pagamento confirmado! Seu pedido já está na fila de produção.';
                    }
                })
                .catch(function () { /* silent — next tick retries */ });
        }, 4000);
    }

    function initPixCheckout() {
        verificarCheckoutStatus();

        var modal        = document.getElementById('productModal');
        var buyPixBtn     = document.getElementById('modalBuyPix');
        var pixForm       = document.getElementById('pixForm');
        var pixFormBack   = document.getElementById('pixFormBack');
        var pixFormError  = document.getElementById('pixFormError');
        var pixFormSubmit = document.getElementById('pixFormSubmit');
        var pixQrWrap     = document.getElementById('pixQrWrap');
        var pixQrImg      = document.getElementById('pixQrImg');
        var pixCopyBtn    = document.getElementById('pixCopyBtn');
        var pixCheckoutError = document.getElementById('pixCheckoutError');
        var pixCpfInput   = document.getElementById('pixCpf');
        if (!modal) return;

        // Light mask as the customer types — 000.000.000-00
        if (pixCpfInput) pixCpfInput.addEventListener('input', function () {
            var d = this.value.replace(/\D/g, '').slice(0, 11);
            var out = d;
            if (d.length > 9) out = d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6,9)+'-'+d.slice(9);
            else if (d.length > 6) out = d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6);
            else if (d.length > 3) out = d.slice(0,3)+'.'+d.slice(3);
            this.value = out;
        });

        function cpfValido(cpf) {
            cpf = String(cpf).replace(/\D/g, '');
            if (cpf.length !== 11) return false;
            if (/^(\d)\1{10}$/.test(cpf)) return false; // all-same-digit is never a real CPF
            function calcDigit(base, weights) {
                var sum = 0;
                for (var i = 0; i < weights.length; i++) sum += parseInt(base[i], 10) * weights[i];
                var rest = sum % 11;
                return rest < 2 ? 0 : 11 - rest;
            }
            var d1 = calcDigit(cpf, [10,9,8,7,6,5,4,3,2]);
            var d2 = calcDigit(cpf, [11,10,9,8,7,6,5,4,3,2]);
            return d1 === parseInt(cpf[9], 10) && d2 === parseInt(cpf[10], 10);
        }

        function entrarEstadoPix() {
            var card = modal.querySelector('.product-modal-card');
            if (card) card.setAttribute('data-state', 'pix');
            if (pixForm) { pixForm.reset(); pixForm.hidden = false; }
            if (pixQrWrap) pixQrWrap.hidden = true;
            if (pixFormError) pixFormError.textContent = '';
        }

        if (buyPixBtn) buyPixBtn.addEventListener('click', function () {
            if (!modalProduto) return;
            var tamanhoEl = document.getElementById('modalTamanho');
            var sizeErrorEl = document.getElementById('modalSizeError');
            if (!tamanhoEl || !tamanhoEl.value) {
                if (sizeErrorEl) sizeErrorEl.textContent = 'Selecione o tamanho antes de continuar.';
                if (tamanhoEl) tamanhoEl.focus();
                return;
            }
            if (sizeErrorEl) sizeErrorEl.textContent = '';
            entrarEstadoPix();
        });

        if (pixFormBack) pixFormBack.addEventListener('click', function () {
            var card = modal.querySelector('.product-modal-card');
            if (card) card.setAttribute('data-state', 'detail');
            pararPollingPix();
        });

        if (pixForm) pixForm.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!modalProduto) return;
            var tamanho  = (document.getElementById('modalTamanho') || {}).value || '';
            var nome     = (document.getElementById('pixNome') || {}).value || '';
            var whatsapp = (document.getElementById('pixWhatsapp') || {}).value || '';
            var cpf      = (pixCpfInput || {}).value || '';
            nome = nome.trim(); whatsapp = whatsapp.replace(/\D/g, ''); cpf = cpf.replace(/\D/g, '');

            if (!tamanho) { pixFormError.textContent = 'Tamanho não selecionado — volte e selecione antes de continuar.'; return; }
            if (nome.length < 2) { pixFormError.textContent = 'Digite seu nome.'; return; }
            if (whatsapp.length < 10) { pixFormError.textContent = 'Digite um WhatsApp válido com DDD.'; return; }
            if (!cpfValido(cpf)) { pixFormError.textContent = 'CPF inválido. Confira os números digitados.'; return; }
            pixFormError.textContent = '';

            pixFormSubmit.disabled = true;
            pixFormSubmit.textContent = 'Gerando cobrança…';

            fetch('/api/checkout/pix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    produto_id: modalProduto.id,
                    tamanho: tamanho,
                    cliente_nome: nome,
                    cliente_whatsapp: whatsapp,
                    cpfCnpj: cpf
                })
            })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, body: d }; }); })
            .then(function (res) {
                pixFormSubmit.disabled = false;
                pixFormSubmit.textContent = 'Gerar QR Code PIX';
                if (!res.ok) { pixFormError.textContent = res.body.error || 'Erro ao gerar PIX.'; return; }

                pixForm.hidden = true;
                pixQrWrap.hidden = false;
                if (pixQrImg && res.body.pix_qr_code) pixQrImg.src = 'data:image/png;base64,' + res.body.pix_qr_code;
                pixQrWrap.dataset.copiaCola = res.body.pix_copia_cola || '';
                if (pixCheckoutError) pixCheckoutError.textContent = '';
                if (res.body.pedido_id) iniciarPollingPix(res.body.pedido_id);
            })
            .catch(function () {
                pixFormSubmit.disabled = false;
                pixFormSubmit.textContent = 'Gerar QR Code PIX';
                pixFormError.textContent = 'Erro de conexão. Tente novamente.';
            });
        });

        if (pixCopyBtn) pixCopyBtn.addEventListener('click', function () {
            var codigo = (pixQrWrap && pixQrWrap.dataset.copiaCola) || '';
            if (!codigo) return;
            var doCopyFallback = function () {
                var ta = document.createElement('textarea');
                ta.value = codigo; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); } catch (_) {}
                document.body.removeChild(ta);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(codigo).catch(doCopyFallback);
            } else {
                doCopyFallback();
            }
            pixCopyBtn.textContent = 'Copiado!';
            pixCopyBtn.classList.add('copied');
            setTimeout(function () {
                pixCopyBtn.textContent = 'Copiar código PIX';
                pixCopyBtn.classList.remove('copied');
            }, 2000);
        });
    }

    // ── INIT ─────────────────────────────────────────────────────
    function initEventListeners() {
        initModal();
        initFaqModal();
        initPixCheckout();
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
                '?text=' + encodeURIComponent('Olá, equipe Trip Visuals! 🛸\n\nVim pelo catálogo e gostaria de mais informações sobre os modelos, cores e tamanhos disponíveis.');
        }

        try {
            var resProd   = await fetch('/api/produtos');
            todosProdutos = resProd.ok ? await resProd.json() : [];
            renderFiltros(todosProdutos);
            renderProdutos(todosProdutos);
        } catch (e) {
            document.getElementById('vitrine').innerHTML =
                '<div class="state-msg">' +
                '<span class="icon" aria-hidden="true">⚠️</span>' +
                '<p>Erro ao carregar produtos. Tente novamente.</p>' +
                '</div>';
        }
    }

    // ── CATALOG INTRO — shown on first session visit only ──────
    var INTRO_MIN_MS = 1500;   // ensure animation is visible
    var INTRO_MAX_MS = 5000;   // hard cap — brand moment runs up to 5s
    var introStart    = 0;
    var introHidden   = false;

    function shouldShowIntro() {
        try {
            return !sessionStorage.getItem('vz-intro-seen');
        } catch (_) { return true; }
    }

    function markIntroSeen() {
        try { sessionStorage.setItem('vz-intro-seen', '1'); } catch (_) {}
    }

    function mostrarIntro() {
        var el = document.getElementById('catalogIntro');
        if (!el) return;
        introStart = Date.now();
        el.classList.add('active');
        el.setAttribute('aria-hidden', 'false');
        el.addEventListener('click', esconderIntro, { once: true });
        // Hard cap — never get stuck
        setTimeout(function () { esconderIntro(); }, INTRO_MAX_MS);
    }

    function esconderIntro() {
        if (introHidden) return;
        introHidden = true;
        var el = document.getElementById('catalogIntro');
        if (!el) return;
        var elapsed = Date.now() - introStart;
        var wait    = Math.max(0, INTRO_MIN_MS - elapsed);
        setTimeout(function () {
            el.classList.add('leaving');
            el.setAttribute('aria-hidden', 'true');
            setTimeout(function () {
                el.classList.remove('active', 'leaving');
                el.parentNode && el.parentNode.removeChild(el);
            }, 650);
            markIntroSeen();
        }, wait);
    }

    function bootCatalog() {
        var showIntro = shouldShowIntro();
        if (showIntro) mostrarIntro();
        initEventListeners();
        // Wrap carregar to trigger intro hide after products load
        var origCarregar = carregar;
        Promise.resolve()
            .then(function () { return origCarregar(); })
            .catch(function () { /* errors are handled inside carregar */ })
            .then(function () { if (showIntro) esconderIntro(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootCatalog);
    } else {
        bootCatalog();
    }
})();
