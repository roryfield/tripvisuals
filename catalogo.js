// [VZ] Trip Visuals Wear — Catalog page logic (external for strict CSP)
(function () {
    'use strict';

    // ── XSS SAFETY ──────────────────────────────────────────────
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // [VZ] Ambient glow (2026-09-17) — fundo cyberpunk que reage ao
    // ponteiro no desktop e à inclinação do aparelho no mobile, além da
    // deriva autônoma já resolvida em CSS (@keyframes ambient-drift-*).
    // Decisão consciente: NÃO pede permissão de sensor de movimento no
    // iOS (DeviceOrientationEvent.requestPermission) — isso exigiria um
    // gesto explícito do usuário e um prompt nativo só pra um efeito
    // decorativo, o que é abusar da permissão. Em iOS mais novo o efeito
    // simplesmente não reage à inclinação; a deriva automática do CSS
    // continua garantindo que o fundo nunca fica estático.
    function initAmbientGlow() {
        var el = document.getElementById('ambientGlow');
        if (!el) return;
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) return;

        var targetX = 0, targetY = 0, curX = 0, curY = 0;
        var MAX_OFFSET = 34; // px — nudge sutil, nunca desloca a cena inteira
        var raf = null;

        function aplicar() {
            curX += (targetX - curX) * 0.06;
            curY += (targetY - curY) * 0.06;
            el.style.setProperty('--ambient-x', curX.toFixed(1) + 'px');
            el.style.setProperty('--ambient-y', curY.toFixed(1) + 'px');
            if (Math.abs(targetX - curX) > 0.1 || Math.abs(targetY - curY) > 0.1) {
                raf = requestAnimationFrame(aplicar);
            } else {
                raf = null;
            }
        }
        function agendar() {
            if (!raf) raf = requestAnimationFrame(aplicar);
        }

        window.addEventListener('pointermove', function (e) {
            if (e.pointerType === 'touch') return; // toque real é tratado pela inclinação abaixo, não pela posição do dedo
            var nx = (e.clientX / window.innerWidth) - 0.5;
            var ny = (e.clientY / window.innerHeight) - 0.5;
            targetX = nx * MAX_OFFSET * 2;
            targetY = ny * MAX_OFFSET * 2;
            agendar();
        }, { passive: true });

        if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') {
            window.addEventListener('deviceorientation', function (e) {
                if (e.gamma === null || e.beta === null) return;
                var nx = Math.max(-1, Math.min(1, e.gamma / 30));
                var ny = Math.max(-1, Math.min(1, (e.beta - 40) / 30));
                targetX = nx * MAX_OFFSET;
                targetY = ny * MAX_OFFSET;
                agendar();
            }, { passive: true });
        }
    }

    // [VZ] Estado "ativo" nos ícones do header (2026-09-17) — antes o ícone
    // que abre um modal (manual/FAQ/feedback) voltava pro visual neutro assim
    // que o clique terminava, então não dava pra saber, olhando pro header,
    // qual painel estava aberto. Chamado de dentro de cada abrir*/fechar*,
    // não do listener de clique, pra cobrir também quando o modal é aberto
    // por outro caminho (ex.: botão de manual da tela de intro).
    function marcarBotaoModalAtivo(btn, ativo) {
        if (!btn) return;
        btn.classList.toggle('active', !!ativo);
        btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    }

    // [VZ] Visualizador multi-ângulo (2026-09-07) — duas variantes, mesma ideia:
    // trocar a imagem grande do modal sem precisar de nenhuma lib externa.
    //
    // #modalImg e o listener de window são reaproveitados a cada abertura de
    // modal (o elemento nunca é recriado) — sem limpar os listeners do produto
    // anterior antes de anexar os novos, eles se acumulam a cada produto aberto.
    // limparViewerAnterior() existe só pra isso: sempre roda antes de montar um
    // visualizador novo (e quando o produto não tem papel nenhum, void a chama
    // sozinha lá embaixo, no reset do modal).
    var limparViewerAnterior = function () {};

    // Flip (vestuário: frente/verso): clique alterna entre as duas fotos.
    // Não é uma animação 3D de verdade, é troca de imagem — deliberado, simples
    // e leve, sem custo de fotografia extra além das duas fotos que já existem.
    function initFlipViewer(img, hint, urlFrente, urlVerso) {
        limparViewerAnterior();
        var mostrandoVerso = false;
        img.src = urlFrente;
        img.classList.add('viewer-flip-ativo');
        var onClick = function () {
            mostrandoVerso = !mostrandoVerso;
            img.src = mostrandoVerso ? urlVerso : urlFrente;
            if (hint) hint.textContent = mostrandoVerso ? '🔄 Ver frente' : '🔄 Ver verso';
        };
        img.addEventListener('click', onClick);
        if (hint) {
            hint.hidden = false;
            hint.textContent = '🔄 Ver verso';
            hint.onclick = onClick;
        }
        limparViewerAnterior = function () {
            img.removeEventListener('click', onClick);
            img.classList.remove('viewer-flip-ativo');
            if (hint) hint.onclick = null;
        };
    }

    // Giro (decor 3D: sequência de ângulos): arrastar horizontalmente (mouse ou
    // touch) cicla pela sequência de fotos, dando a sensação de girar o objeto.
    // Técnica padrão de mercado (o mesmo princípio do "360 view" do Shopify e de
    // plugins de produto giratório) — troca de frame por posição do arraste, sem
    // modelagem 3D nenhuma por trás.
    function initSpinViewer(img, hint, urls) {
        limparViewerAnterior();
        var indice = 0;
        img.src = urls[0];
        img.classList.add('viewer-spin-ativo');
        if (hint) {
            hint.hidden = false;
            hint.textContent = '↔ Arraste pra girar';
        }

        var arrastando = false;
        var moveu = false;
        var xInicial = 0;
        var indiceInicial = 0;
        var LARGURA_POR_FRAME = 18; // px de arraste por foto — sensível o bastante sem ficar nervoso

        function posX(e) {
            return (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
        }

        function aplicarIndice(novoIndice) {
            var n = urls.length;
            indice = ((novoIndice % n) + n) % n;
            img.src = urls[indice];
        }

        function onStart(e) {
            arrastando = true;
            moveu = false;
            xInicial = posX(e);
            indiceInicial = indice;
        }
        function onMove(e) {
            if (!arrastando) return;
            var delta = posX(e) - xInicial;
            if (Math.abs(delta) > 4) moveu = true;
            aplicarIndice(indiceInicial - Math.round(delta / LARGURA_POR_FRAME));
        }
        function onEnd() { arrastando = false; }
        // Clique simples (sem arrastar), pra quem não percebe que dá pra arrastar —
        // avança um frame por clique. Só dispara se o gesto não foi um arraste
        // (senão soltar o mouse depois de girar também contaria como clique).
        function onClick() {
            if (moveu) return;
            aplicarIndice(indice + 1);
        }

        img.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        img.addEventListener('touchstart', onStart, { passive: true });
        img.addEventListener('touchmove', onMove, { passive: true });
        img.addEventListener('touchend', onEnd);
        img.addEventListener('click', onClick);

        limparViewerAnterior = function () {
            img.removeEventListener('mousedown', onStart);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onEnd);
            img.removeEventListener('touchstart', onStart);
            img.removeEventListener('touchmove', onMove);
            img.removeEventListener('touchend', onEnd);
            img.removeEventListener('click', onClick);
            img.classList.remove('viewer-spin-ativo');
        };
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
    var activeFilters = { tipo: '', genero: '', categoria: '' };
    var CATEGORIA_LABELS = { vestuario: 'Vestuário', decor3d: 'Decor 3D' };
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
    // [VZ] Busca sempre visível (2026-09-15) — o campo não colapsa mais atrás
    // de um ícone (ver catalogo.css). O ícone só dá foco ao campo; o estado
    // "aberto" que sobra é puramente visual, pra destacar quando há foco ou
    // texto digitado.
    function toggleSearch() {
        var input = document.getElementById('searchInput');
        input.focus();
    }

    function fecharSearchSeVazio() {
        var input = document.getElementById('searchInput');
        if (!input.value.trim()) {
            setTimeout(fecharResultados, 200);
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
    var freteAtual = null; // último resultado de /api/frete pro CEP digitado

    function comprarItem(nome, preco, tamanho) {
        var freteTexto = '';
        if (freteAtual && freteAtual.atendido) {
            freteTexto = '\n*Frete estimado:* R$ ' + freteAtual.valor.toFixed(2) +
                ' (' + freteAtual.endereco.cidade + '/' + freteAtual.endereco.uf +
                ', ' + freteAtual.prazoDias + ' dias úteis)\n';
        }
        // [VZ] Decor 3D não tem tamanho de vestuário — comprarItem() é chamado
        // sem tamanho (string vazia) pra essa categoria, e a linha some da
        // mensagem em vez de mandar "Tamanho:" em branco pro WhatsApp da loja.
        var temTamanho = !!tamanho;
        var texto = 'Olá, equipe Trip Visuals! 🛸\n\n' +
            'Vim pelo catálogo e tenho interesse neste item:\n\n' +
            '*Item:* ' + nome + '\n' +
            (temTamanho ? '*Tamanho:* ' + tamanho + '\n' : '') +
            '*Valor base:* R$ ' + Number(preco).toFixed(2) + '\n' +
            freteTexto + '\n' +
            (temTamanho ? 'Poderia me confirmar a disponibilidade nesse tamanho' : 'Poderia me confirmar a disponibilidade') +
            (freteAtual && freteAtual.atendido ? '?' : ' e calcular o frete para o meu CEP?');
        window.open(
            'https://wa.me/' + NUMERO_LOJA + '?text=' + encodeURIComponent(texto),
            '_blank', 'noopener'
        );
    }

    // [VZ] Fase 7 — cálculo de frete direto no modal, debounced, só chama
    // a API quando o CEP já tem 8 dígitos.
    var freteDebounce = null;
    function consultarFreteModal(cepDigitado) {
        var resultEl = document.getElementById('freteResultado');
        var limpo = String(cepDigitado || '').replace(/\D/g, '');
        clearTimeout(freteDebounce);
        if (limpo.length !== 8) {
            freteAtual = null;
            if (resultEl) resultEl.textContent = '';
            return;
        }
        if (resultEl) resultEl.textContent = 'Calculando frete…';
        freteDebounce = setTimeout(function () {
            fetch('/api/frete?cep=' + limpo)
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    freteAtual = d;
                    if (!resultEl) return;
                    if (!d.encontrado) {
                        resultEl.textContent = 'CEP não encontrado. Confira e tente de novo.';
                    } else if (!d.atendido) {
                        resultEl.textContent = 'Frete pra ' + d.endereco.cidade + '/' + d.endereco.uf + ' combinado direto pelo WhatsApp.';
                    } else {
                        resultEl.textContent = 'Frete pra ' + d.endereco.cidade + '/' + d.endereco.uf +
                            ': R$ ' + d.valor.toFixed(2) + ', ' + d.prazoDias + ' dias úteis.';
                    }
                })
                .catch(function () {
                    freteAtual = null;
                    if (resultEl) resultEl.textContent = 'Não foi possível calcular agora. Frete combinado pelo WhatsApp.';
                });
        }, 500);
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
            var matchTipo      = !f.tipo      || (p.tipo   || '').toLowerCase() === f.tipo.toLowerCase();
            var matchGenero    = !f.genero    || (p.genero || '').toLowerCase() === f.genero.toLowerCase();
            var matchCategoria = !f.categoria || (p.categoria || 'vestuario') === f.categoria;
            return matchTipo && matchGenero && matchCategoria;
        });
    }

    // [VZ] Card de produto — um único builder reaproveitado pela grade
    // completa (renderProdutos) e pelas prateleiras da tela de overview
    // (renderOverview), pra manter o mesmo card, o mesmo clique-pra-abrir-
    // modal e o mesmo fallback de imagem em vez de duas versões divergindo
    // com o tempo. `badgeExtra` deixa a prateleira anexar um selo próprio
    // (ex.: "Mais procurado") sem duplicar todo o innerHTML por causa disso.
    function montarCardProduto(p, i, badgeExtra) {
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
            (badgeExtra || (p.destaque ? '<span class="destaque-badge">Novidade</span>' : '')) +
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
        return btn;
    }

    // [VZ] Renderização em lotes (2026-09-16): antes disso, a vitrine
    // inteira (hoje 404+ produtos) entrava no DOM de uma vez só — pesado no
    // primeiro paint e a sensação de "rolo sem fim" reportada pelo cliente,
    // já que nunca havia um ponto de pausa. Sem mexer na API (ainda busca
    // tudo em /api/produtos numa chamada só — ok pro volume atual do
    // acervo), a lista já filtrada passa a entrar em lotes de VITRINE_LOTE
    // itens. O próximo lote só é montado quando o usuário de fato chega
    // perto do fim da vitrine, via IntersectionObserver numa sentinela —
    // sem listener de scroll manual, sem polling.
    var VITRINE_LOTE = 24;
    var vitrineState = { lista: [], proximoIndex: 0 };
    var vitrineObserver = null;

    function pegarSentinelaVitrine() {
        var wrap = document.querySelector('.vitrine-wrap');
        if (!wrap) return null;
        var sentinela = document.getElementById('vitrineSentinel');
        if (!sentinela) {
            sentinela = document.createElement('div');
            sentinela.id = 'vitrineSentinel';
            sentinela.className = 'vitrine-sentinel';
            sentinela.setAttribute('aria-hidden', 'true');
            wrap.appendChild(sentinela);
        }
        return sentinela;
    }

    function renderProximoLoteVitrine() {
        var vitrine = document.getElementById('vitrine');
        if (!vitrine) return;
        var inicio = vitrineState.proximoIndex;
        var fim = Math.min(inicio + VITRINE_LOTE, vitrineState.lista.length);
        var frag = document.createDocumentFragment();
        for (var i = inicio; i < fim; i++) {
            frag.appendChild(montarCardProduto(vitrineState.lista[i], i - inicio));
        }
        vitrine.appendChild(frag);
        vitrineState.proximoIndex = fim;

        var sentinela = document.getElementById('vitrineSentinel');
        if (vitrineState.proximoIndex >= vitrineState.lista.length) {
            if (vitrineObserver) { vitrineObserver.disconnect(); vitrineObserver = null; }
            if (sentinela) sentinela.hidden = true;
        } else if (sentinela) {
            sentinela.hidden = false;
        }
    }

    function renderProdutos(lista) {
        var vitrine = document.getElementById('vitrine');
        var filtered = applyFilters(lista);
        vitrine.innerHTML = '';

        if (vitrineObserver) { vitrineObserver.disconnect(); vitrineObserver = null; }

        // Update active count
        var countEl = document.getElementById('filterCount');
        if (countEl) {
            var hasFilter = activeFilters.tipo || activeFilters.genero || activeFilters.categoria;
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
            var sentinelaVazia = document.getElementById('vitrineSentinel');
            if (sentinelaVazia) sentinelaVazia.hidden = true;
            return;
        }

        vitrineState = { lista: filtered, proximoIndex: 0 };
        renderProximoLoteVitrine();

        if (filtered.length > VITRINE_LOTE) {
            var sentinela = pegarSentinelaVitrine();
            if (sentinela && 'IntersectionObserver' in window) {
                vitrineObserver = new IntersectionObserver(function (entries) {
                    if (entries[0].isIntersecting) renderProximoLoteVitrine();
                }, { rootMargin: '600px 0px' });
                vitrineObserver.observe(sentinela);
            } else {
                // Sem suporte a IntersectionObserver: renderiza tudo de uma
                // vez, igual ao comportamento anterior — nunca deixa
                // produto escondido esperando um scroll que não dispara.
                while (vitrineState.proximoIndex < vitrineState.lista.length) renderProximoLoteVitrine();
            }
        }
    }

    // [VZ] Tela de overview (2026-09-16) — a primeira coisa visível depois
    // da animação de entrada deixa de ser a ordem crua do banco (decorativo
    // 3D, depois camiseta, por acaso do id) e passa a ser três prateleiras
    // com propósito: Destaques (curadoria manual via campo 'destaque',
    // mesmo flag que já existia pro selo "Novidade"), Mais Procurados (por
    // cliques — dado real já rastreado; NÃO é "mais vendidos", pedidos não
    // têm vínculo com produto_id hoje, então rotular como vendas seria
    // inventar um dado que não temos) e Novidades (por criado_em). Cada
    // prateleira só aparece se tiver conteúdo de verdade pra mostrar, e a
    // seção inteira some em lojas pequenas, onde ela só repetiria a grade.
    var OVERVIEW_MIN_PRODUTOS = 6;
    var OVERVIEW_ITENS_POR_SECAO = 8;

    function renderOverview(lista) {
        var wrap = document.getElementById('catalogOverview');
        if (!wrap) return;

        if (!lista || lista.length < OVERVIEW_MIN_PRODUTOS) {
            wrap.innerHTML = '';
            wrap.hidden = true;
            return;
        }

        var destaques = lista.filter(function (p) { return p.destaque; }).slice(0, OVERVIEW_ITENS_POR_SECAO);

        var procurados = lista
            .filter(function (p) { return Number(p.cliques) > 0; })
            .slice()
            .sort(function (a, b) { return Number(b.cliques) - Number(a.cliques); })
            .slice(0, OVERVIEW_ITENS_POR_SECAO);
        // Sinal fraco demais pra virar prateleira — menos de 3 produtos com
        // algum clique registrado não é "popularidade", é ruído.
        if (procurados.length < 3) procurados = [];

        var novidades = lista
            .filter(function (p) { return p.criado_em; })
            .slice()
            .sort(function (a, b) { return new Date(b.criado_em) - new Date(a.criado_em); })
            .slice(0, OVERVIEW_ITENS_POR_SECAO);

        var secoes = [
            { titulo: 'Destaques',        itens: destaques,  badge: null },
            { titulo: 'Mais Procurados',  itens: procurados, badge: '<span class="overview-badge overview-badge-procurado">Popular</span>' },
            { titulo: 'Novidades',        itens: novidades,  badge: '<span class="overview-badge overview-badge-novo">Novo</span>' }
        ].filter(function (s) { return s.itens.length >= 3; });

        if (!secoes.length) {
            wrap.innerHTML = '';
            wrap.hidden = true;
            return;
        }

        wrap.hidden = false;
        wrap.innerHTML = '';

        secoes.forEach(function (secao) {
            var section = document.createElement('section');
            section.className = 'overview-section';
            section.innerHTML =
                '<div class="overview-header">' +
                '<h2>' + esc(secao.titulo) + '</h2>' +
                '</div>';
            var row = document.createElement('div');
            row.className = 'overview-row';
            secao.itens.forEach(function (p, i) {
                row.appendChild(montarCardProduto(p, i, secao.badge));
            });
            section.appendChild(row);
            wrap.appendChild(section);
        });

        var cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'overview-cta';
        cta.textContent = 'Ver catálogo completo ↓';
        cta.addEventListener('click', function () {
            var alvo = document.getElementById('filterBar') || document.getElementById('vitrine');
            if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        wrap.appendChild(cta);
    }

    function limparFiltros() {
        activeFilters = { tipo: '', genero: '', categoria: '' };
        renderFiltros(todosProdutos);
        renderProdutos(todosProdutos);
    }

    function renderFiltros(lista) {
        var bar = document.getElementById('filterBar');
        if (!bar) return;

        var f = activeFilters;

        // [VZ] Categoria (Vestuário / Decor 3D) é a divisão de mais alto
        // nível — só faz sentido oferecer o toggle quando as duas existem de
        // fato no acervo (se ainda não há nenhum Decor 3D cadastrado, o
        // toggle não aparece e o catálogo se comporta exatamente como antes).
        var categoriasPresentes = [...new Set(lista.map(p => p.categoria || 'vestuario'))];
        var categoriaHtml = '';
        if (categoriasPresentes.length > 1) {
            categoriaHtml = '<div class="filter-group filter-group-categoria" role="group" aria-label="Filtrar por categoria">';
            categoriaHtml += '<button class="filter-chip' + (!f.categoria ? ' active' : '') + '" data-filter="categoria" data-value="">Todos</button>';
            ['vestuario', 'decor3d'].forEach(function (c) {
                if (categoriasPresentes.indexOf(c) === -1) return;
                categoriaHtml += '<button class="filter-chip' + (f.categoria === c ? ' active' : '') + '" data-filter="categoria" data-value="' + c + '">' + esc(CATEGORIA_LABELS[c]) + '</button>';
            });
            categoriaHtml += '</div>';
        }

        // [VZ] Filtro progressivo (faceted filtering): as opções de "tipo"
        // refletem os produtos já filtrados por gênero e categoria (ignorando
        // o filtro de tipo em si), e vice-versa. Isso evita o cliente cair
        // numa combinação que sempre dá zero resultados sem entender o
        // motivo — problema real quando os filtros eram calculados sobre a
        // lista inteira, sem considerar o que já estava selecionado.
        var lojaFiltradaPorCategoria = lista.filter(function (p) {
            return !f.categoria || (p.categoria || 'vestuario') === f.categoria;
        });
        var lojaFiltradaPorGenero = lojaFiltradaPorCategoria.filter(function (p) {
            return !f.genero || (p.genero || '').toLowerCase() === f.genero.toLowerCase();
        });
        var lojaFiltradaPorTipo = lojaFiltradaPorCategoria.filter(function (p) {
            return !f.tipo || (p.tipo || '').toLowerCase() === f.tipo.toLowerCase();
        });

        var tipos   = [...new Set(lojaFiltradaPorGenero.map(p => p.tipo   || '').filter(Boolean))].sort();
        var generos = [...new Set(lojaFiltradaPorTipo.map(p => p.genero || '').filter(Boolean))].sort();

        // [VZ] Contagem por chip (2026-09-15) — mostra quantos produtos tem em
        // cada tipo sem precisar clicar, e junto com o destaque visual abaixo
        // é o que faz "Camiseta" pular aos olhos entre as opções, resolvendo o
        // pedido de reposicionar a barra pra dar mais visibilidade às camisetas.
        var tipoHtml = '';
        if (tipos.length > 0) {
            tipoHtml  = '<div class="filter-group filter-group-tipo" role="group" aria-label="Filtrar por tipo de peça">';
            tipoHtml += '<button class="filter-chip filter-chip-tipo' + (!f.tipo ? ' active' : '') + '" data-filter="tipo" data-value="">Todos</button>';
            tipos.forEach(function (t) {
                var qtd = lojaFiltradaPorGenero.filter(function (p) { return (p.tipo || '').toLowerCase() === t.toLowerCase(); }).length;
                tipoHtml += '<button class="filter-chip filter-chip-tipo' + (f.tipo === t ? ' active' : '') + '" data-filter="tipo" data-value="' + esc(t) + '">' + esc(t) + ' <span class="filter-chip-count">' + qtd + '</span></button>';
            });
            // Se o tipo ativo não existe mais nessa combinação, ele some da lista
            // mas continua selecionado — adiciona como chip extra pra não travar
            // o usuário sem saída visível (clique em "Todos" pra resetar).
            if (f.tipo && tipos.indexOf(f.tipo) === -1) {
                tipoHtml += '<button class="filter-chip active" data-filter="tipo" data-value="' + esc(f.tipo) + '">' + esc(f.tipo) + ' (0)</button>';
            }
            tipoHtml += '</div>';
        }

        // [VZ] Filtro colapsável (2026-09-07): qualquer grupo de filtro com mais
        // opções que LIMITE_CHIPS_VISIVEIS vira um botão único ("Gênero ▾") que
        // abre uma folha em vez de poluir a barra inteira com dezenas de chips
        // sempre visíveis (era o caso do gênero, hoje 21 opções, mas a regra é
        // genérica — qualquer filtro que cresça passa a se comportar assim
        // sozinho, sem precisar mexer aqui de novo). No mobile é o problema real
        // reportado: os chips ocupavam a tela inteira antes de qualquer produto
        // aparecer.
        var LIMITE_CHIPS_VISIVEIS = 6;
        var generoHtml = '';
        var generoSheetHtml = '';
        if (generos.length > 0 && generos.length <= LIMITE_CHIPS_VISIVEIS) {
            generoHtml  = '<div class="filter-group" role="group" aria-label="Filtrar por gênero">';
            generoHtml += '<button class="filter-chip' + (!f.genero ? ' active' : '') + '" data-filter="genero" data-value="">Todos</button>';
            generos.forEach(function (g) {
                generoHtml += '<button class="filter-chip' + (f.genero === g ? ' active' : '') + '" data-filter="genero" data-value="' + esc(g) + '">' + esc(g) + '</button>';
            });
            if (f.genero && generos.indexOf(f.genero) === -1) {
                generoHtml += '<button class="filter-chip active" data-filter="genero" data-value="' + esc(f.genero) + '">' + esc(f.genero) + ' (0)</button>';
            }
            generoHtml += '</div>';
        } else if (generos.length > LIMITE_CHIPS_VISIVEIS) {
            var rotuloBotao = f.genero ? ('Gênero: ' + f.genero) : ('Gênero (' + generos.length + ')');
            generoHtml = '<div class="filter-group filter-group-collapsed">' +
                '<button type="button" class="filter-more-trigger' + (f.genero ? ' active' : '') + '" id="filterMoreGenero">' +
                esc(rotuloBotao) + ' <span aria-hidden="true">▾</span>' +
                '</button>' +
                (f.genero ? '<button type="button" class="filter-chip-clear-x" id="filterGeneroClearX" aria-label="Limpar filtro de gênero">×</button>' : '') +
                '</div>';
            generoSheetHtml =
                '<div class="filter-sheet-overlay" id="filterSheetOverlay">' +
                '<div class="filter-sheet" role="dialog" aria-modal="true" aria-label="Filtrar por gênero">' +
                '<div class="filter-sheet-header"><h3>Gênero</h3><button type="button" class="filter-sheet-close" id="filterSheetClose" aria-label="Fechar">×</button></div>' +
                '<div class="filter-sheet-chips">' +
                '<button class="filter-chip' + (!f.genero ? ' active' : '') + '" data-filter="genero" data-value="">Todos</button>' +
                generos.map(function (g) {
                    return '<button class="filter-chip' + (f.genero === g ? ' active' : '') + '" data-filter="genero" data-value="' + esc(g) + '">' + esc(g) + '</button>';
                }).join('') +
                '</div></div></div>';
        }

        var clearHtml = (f.tipo || f.genero || f.categoria)
            ? '<button class="filter-clear" type="button" aria-label="Limpar todos os filtros">× Limpar</button>'
            : '';

        var countHtml = '<span class="filter-count" id="filterCount"></span>';

        bar.innerHTML =
            '<div class="filter-bar-inner">' +
            categoriaHtml + tipoHtml + generoHtml + clearHtml + countHtml +
            '</div>' + generoSheetHtml;

        // Wire chip clicks (inline chips e chips dentro da folha, mesmo seletor)
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

        // Wire o botão colapsado de gênero: abre a folha, fecha no X, no
        // backdrop ou ao escolher uma opção (o listener de .filter-chip acima
        // já dispara o re-render, que recria a folha fechada por padrão).
        var moreTrigger = bar.querySelector('#filterMoreGenero');
        var sheetOverlay = bar.querySelector('#filterSheetOverlay');
        if (moreTrigger && sheetOverlay) {
            moreTrigger.addEventListener('click', function () { sheetOverlay.classList.add('open'); });
            sheetOverlay.addEventListener('click', function (e) { if (e.target === sheetOverlay) sheetOverlay.classList.remove('open'); });
            var sheetClose = bar.querySelector('#filterSheetClose');
            if (sheetClose) sheetClose.addEventListener('click', function () { sheetOverlay.classList.remove('open'); });
        }
        var generoClearX = bar.querySelector('#filterGeneroClearX');
        if (generoClearX) generoClearX.addEventListener('click', function (e) {
            e.stopPropagation();
            activeFilters.genero = '';
            renderFiltros(todosProdutos);
            renderProdutos(todosProdutos);
        });

        // Update count
        var countEl = document.getElementById('filterCount');
        if (countEl) {
            var filtered = applyFilters(lista);
            var hasFilter = f.tipo || f.genero || f.categoria;
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

        // [VZ] Decor 3D não tem tamanho de vestuário — esconde o seletor
        // inteiro (campo + erro) em vez de deixar um "Selecione o tamanho"
        // sem sentido pra um objeto decorativo.
        var isDecor3d = (p.categoria || 'vestuario') === 'decor3d';
        var tamanhoField = tamanhoEl && tamanhoEl.closest('.product-modal-size-field');
        if (tamanhoField) tamanhoField.hidden = isDecor3d;

        // [VZ] Fase 7 — CEP e frete não persistem entre produtos diferentes
        var cepEl = document.getElementById('modalCep');
        var freteResultEl = document.getElementById('freteResultado');
        if (cepEl) cepEl.value = '';
        if (freteResultEl) freteResultEl.textContent = '';
        freteAtual = null;

        // Tira os listeners de flip/giro do produto anterior antes de trocar de
        // imagem — sem isso eles ficam grudados em #modalImg (elemento fixo,
        // nunca recriado) e se acumulam a cada produto aberto.
        limparViewerAnterior();
        limparViewerAnterior = function () {};

        img.src    = p.imagem_url || '';
        img.alt    = p.nome;
        setImgFallback(img);
        titleEl.textContent = p.nome;
        corEl.textContent    = p.cor    || '';
        priceEl.textContent  = 'R$ ' + Number(p.preco).toFixed(2);
        // Custom description if available
        var descEl = modal.querySelector('.product-modal-desc');
        if (descEl) descEl.textContent = p.descricao || (isDecor3d
            ? 'Peça decorativa impressa em 3D. Detalhes de acabamento e prazo combinados pelo WhatsApp.'
            : 'Estampa disponível em camiseta, regata, babylook ou moletom. Modelo, cor e tamanho são combinados pelo WhatsApp.');
        if (tipoEl)   tipoEl.textContent   = p.tipo   || '';
        if (generoEl) generoEl.textContent = p.genero || '';

        // [VZ] Only offer PIX when the backend confirms it's actually live
        var buyPixBtn = document.getElementById('modalBuyPix');
        if (buyPixBtn) buyPixBtn.hidden = !checkoutAutomaticoHabilitado;

        // Load extra photos for gallery — e, quando o produto tiver fotos marcadas
        // com papel (frente/verso ou angulo), troca a galeria simples por um
        // visualizador multi-ângulo (flip pra vestuário, giro pra decor 3D).
        // Ver docs internos combinados com Rory em 2026-09-07.
        var gallery = document.getElementById('modalGallery');
        var hint = document.getElementById('modalViewerHint');
        if (hint) { hint.hidden = true; hint.onclick = null; }
        if (gallery && p.id) {
            gallery.innerHTML = '';
            fetch('/api/produtos/' + p.id + '/fotos').then(function(r){ return r.json(); }).then(function(fotos){
                if (!fotos.length) return;

                var frente = fotos.find(function(f){ return f.papel === 'frente'; });
                var verso  = fotos.find(function(f){ return f.papel === 'verso'; });
                var angulos = fotos.filter(function(f){ return f.papel === 'angulo'; })
                    .sort(function(a, b){ return a.posicao - b.posicao; });
                var semPapel = fotos.filter(function(f){ return !f.papel; });

                if (frente && verso) {
                    initFlipViewer(img, hint, frente.url, verso.url);
                } else if (angulos.length >= 3) {
                    initSpinViewer(img, hint, angulos.map(function(f){ return f.url; }));
                }

                // Fotos sem papel (produtos antigos, ou extras além do flip/giro)
                // continuam como galeria de thumb simples, igual antes.
                if (semPapel.length > 0) {
                    gallery.innerHTML = semPapel.map(function(f){
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

    // [VZ] abrirManual/fecharManual precisam existir em escopo de módulo
    // porque o botão de manual da tela de intro (mostrarIntro) dispara
    // abrirManual() antes de initManualModal() ter necessariamente
    // terminado de rodar — na prática bootCatalog() chama mostrarIntro()
    // e depois initEventListeners() de forma síncrona, então quando o
    // clique de fato acontece a função já foi atribuída, mas mantemos as
    // referências aqui pra não depender dessa ordem por acidente.
    var abrirManual = function () {};
    var fecharManual = function () {};

    function initManualModal() {
        var manualModal    = document.getElementById('manualModal');
        var manualBtn       = document.getElementById('manualBtn');
        var manualBackdrop  = document.getElementById('manualBackdrop');
        var manualClose     = document.getElementById('manualClose');
        if (!manualModal) return;

        abrirManual = function () {
            manualModal.classList.add('open');
            manualModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            marcarBotaoModalAtivo(manualBtn, true);
            if (manualClose) setTimeout(function () { manualClose.focus(); }, 50);
        };
        fecharManual = function () {
            manualModal.classList.remove('open');
            manualModal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            marcarBotaoModalAtivo(manualBtn, false);
        };

        if (manualBtn)      manualBtn.addEventListener('click', abrirManual);
        if (manualClose)    manualClose.addEventListener('click', fecharManual);
        if (manualBackdrop) manualBackdrop.addEventListener('click', fecharManual);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && manualModal.classList.contains('open')) fecharManual();
        });
    }

    // [VZ] Feedback do cliente final — modal com tema "portal" (mesma
    // linguagem visual da tela de entrada), anônimo por padrão. Segue o
    // mesmo padrão de abrir/fechar dos outros modais (open/aria-hidden/
    // overflow lock/Escape), só que com um estado extra ("success") pra
    // flip de tela igual ao modal de produto depois da compra.
    function initFeedbackModal() {
        var modal      = document.getElementById('feedbackModal');
        var btn        = document.getElementById('feedbackBtn');
        var backdrop   = document.getElementById('feedbackBackdrop');
        var closeBtn   = document.getElementById('feedbackClose');
        var card       = modal ? modal.querySelector('.feedback-modal-card') : null;
        var form       = document.getElementById('feedbackForm');
        var mensagemEl = document.getElementById('feedbackMensagem');
        var charCount  = document.getElementById('feedbackCharCount');
        var anonimoEl  = document.getElementById('feedbackAnonimo');
        var identifyEl = document.getElementById('feedbackIdentify');
        var instaEl    = document.getElementById('feedbackInstagram');
        var repostEl   = document.getElementById('feedbackAutorizaRepost');
        var errorEl    = document.getElementById('feedbackError');
        var submitBtn  = document.getElementById('feedbackSubmit');
        var successClose = document.getElementById('feedbackSuccessClose');
        var starsWrap  = document.getElementById('feedbackStars');
        if (!modal || !btn || !card) return;

        var notaSelecionada = 0;
        var stars = Array.prototype.slice.call(starsWrap.querySelectorAll('.feedback-star'));

        function pintarEstrelas(valor) {
            stars.forEach(function (s) {
                var n = parseInt(s.getAttribute('data-star'), 10);
                s.classList.toggle('filled', n <= valor);
                s.setAttribute('aria-checked', n === notaSelecionada ? 'true' : 'false');
            });
        }
        stars.forEach(function (s) {
            s.addEventListener('click', function () {
                var n = parseInt(s.getAttribute('data-star'), 10);
                // Clicar na mesma estrela já selecionada desmarca (nota é opcional).
                notaSelecionada = (notaSelecionada === n) ? 0 : n;
                pintarEstrelas(notaSelecionada);
            });
            s.addEventListener('mouseenter', function () {
                pintarEstrelas(parseInt(s.getAttribute('data-star'), 10));
            });
        });
        starsWrap.addEventListener('mouseleave', function () { pintarEstrelas(notaSelecionada); });

        function abrirFeedback() {
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            marcarBotaoModalAtivo(btn, true);
            if (mensagemEl) setTimeout(function () { mensagemEl.focus(); }, 50);
        }
        function fecharFeedback() {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            marcarBotaoModalAtivo(btn, false);
        }
        function resetarForm() {
            card.setAttribute('data-state', 'form');
            form.reset();
            notaSelecionada = 0;
            pintarEstrelas(0);
            if (charCount) charCount.textContent = '0/1000';
            if (identifyEl) identifyEl.hidden = true;
            if (errorEl) errorEl.textContent = '';
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enviar pro portal'; }
        }

        btn.addEventListener('click', abrirFeedback);
        if (closeBtn)  closeBtn.addEventListener('click', fecharFeedback);
        if (backdrop)  backdrop.addEventListener('click', fecharFeedback);
        if (successClose) successClose.addEventListener('click', function () {
            fecharFeedback();
            resetarForm();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modal.classList.contains('open')) fecharFeedback();
        });

        if (mensagemEl && charCount) mensagemEl.addEventListener('input', function () {
            charCount.textContent = mensagemEl.value.length + '/1000';
        });

        if (anonimoEl && identifyEl) anonimoEl.addEventListener('change', function () {
            identifyEl.hidden = anonimoEl.checked;
            // Voltar a ser anônimo limpa qualquer identificação já digitada —
            // ninguém quer descobrir depois que um dado "esquecido" no campo
            // foi enviado junto por engano.
            if (anonimoEl.checked) {
                if (instaEl)  instaEl.value = '';
                if (repostEl) repostEl.checked = false;
            }
        });

        if (form) form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var mensagem = mensagemEl ? mensagemEl.value.trim() : '';
            if (mensagem.length < 3) {
                if (errorEl) errorEl.textContent = 'Escreva uma mensagem um pouco maior antes de enviar.';
                if (mensagemEl) mensagemEl.focus();
                return;
            }
            if (errorEl) errorEl.textContent = '';
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Enviando...'; }

            var anonimo = anonimoEl ? anonimoEl.checked : true;
            var payload = {
                mensagem: mensagem,
                nota: notaSelecionada || null,
                anonimo: anonimo,
                instagramHandle: (!anonimo && instaEl) ? instaEl.value.trim() : '',
                autorizaRepost: (!anonimo && repostEl) ? repostEl.checked : false
            };

            try {
                var res = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                var data = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(data.error || 'Não foi possível enviar seu feedback agora.');
                card.setAttribute('data-state', 'success');
            } catch (err) {
                if (errorEl) errorEl.textContent = err.message || 'Não foi possível enviar seu feedback agora. Tente de novo em um instante.';
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enviar pro portal'; }
            }
        });
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
            marcarBotaoModalAtivo(faqBtn, true);
            if (faqClose) setTimeout(function () { faqClose.focus(); }, 50);
        }
        function fecharFaq() {
            faqModal.classList.remove('open');
            faqModal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            marcarBotaoModalAtivo(faqBtn, false);
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

        // [VZ] Fase 7 — CEP: formata enquanto digita e calcula com debounce
        var cepEl = document.getElementById('modalCep');
        if (cepEl) {
            cepEl.addEventListener('input', function () {
                var digitos = cepEl.value.replace(/\D/g, '').slice(0, 8);
                cepEl.value = digitos.length > 5 ? digitos.slice(0, 5) + '-' + digitos.slice(5) : digitos;
                consultarFreteModal(digitos);
            });
        }

        if (buyBtn)   buyBtn.addEventListener('click', function () {
            if (!modalProduto) return;
            var isDecor3d = (modalProduto.categoria || 'vestuario') === 'decor3d';
            var tamanhoEl = document.getElementById('modalTamanho');
            var sizeErrorEl = document.getElementById('modalSizeError');
            var tamanho = tamanhoEl ? tamanhoEl.value : '';
            if (!isDecor3d && !tamanho) {
                if (sizeErrorEl) sizeErrorEl.textContent = 'Selecione o tamanho antes de continuar.';
                if (tamanhoEl) tamanhoEl.focus();
                return;
            }
            if (sizeErrorEl) sizeErrorEl.textContent = '';
            comprarItem(modalProduto.nome, modalProduto.preco, isDecor3d ? '' : tamanho);
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
            var isDecor3d = (modalProduto.categoria || 'vestuario') === 'decor3d';
            var tamanhoEl = document.getElementById('modalTamanho');
            var sizeErrorEl = document.getElementById('modalSizeError');
            if (!isDecor3d && (!tamanhoEl || !tamanhoEl.value)) {
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
            var isDecor3d = (modalProduto.categoria || 'vestuario') === 'decor3d';
            var tamanho  = (document.getElementById('modalTamanho') || {}).value || '';
            var nome     = (document.getElementById('pixNome') || {}).value || '';
            var whatsapp = (document.getElementById('pixWhatsapp') || {}).value || '';
            var cpf      = (pixCpfInput || {}).value || '';
            nome = nome.trim(); whatsapp = whatsapp.replace(/\D/g, ''); cpf = cpf.replace(/\D/g, '');

            if (!isDecor3d && !tamanho) { pixFormError.textContent = 'Tamanho não selecionado — volte e selecione antes de continuar.'; return; }
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
        initManualModal();
        initFeedbackModal();
        initAmbientGlow();
        initPixCheckout();
        var searchToggle = document.getElementById('searchToggle');
        var searchInput  = document.getElementById('searchInput');
        var layoutBtns   = document.querySelectorAll('.lt-btn');
        var logoEl       = document.getElementById('landingLogo');

        var searchClear = document.getElementById('searchClear');
        if (searchToggle) searchToggle.addEventListener('click', toggleSearch);
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                filtrarProdutos(this.value);
                if (searchClear) searchClear.hidden = !this.value;
            });
            searchInput.addEventListener('blur', fecharSearchSeVazio);
        }
        if (searchClear) searchClear.addEventListener('click', function () {
            searchInput.value = '';
            searchClear.hidden = true;
            fecharResultados();
            searchInput.focus();
        });
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
            renderOverview(todosProdutos);
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

        // [VZ] Controle explícito (2026-09-15) — clicar em qualquer lugar que
        // não seja um dos botões de ação ainda fecha (atalho pra quem já
        // conhece o site), mas os botões são o caminho principal agora, não
        // um hint passivo escondido atrás de um clique genérico.
        el.addEventListener('click', function (e) {
            if (e.target.closest('.catalog-intro-actions')) return;
            esconderIntro();
        });
        var enterBtn = document.getElementById('introEnterBtn');
        if (enterBtn) enterBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            esconderIntro();
        });
        var manualBtn = document.getElementById('introManualBtn');
        if (manualBtn) manualBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            esconderIntro();
            abrirManual();
        });

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
