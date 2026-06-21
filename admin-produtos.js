// [VZ] admin-produtos — extracted from admin-produtos.html
(function () {
    'use strict';

let produtos = [];
let bulkSelection = new Set();
let currentView = (function(){try{return localStorage.getItem('vz-produtos-view')||'grid';}catch(_){return'grid';}}());
let currentFilter = '';

        // XSS-safe helpers
        const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
        const escapeAttr = s => escapeHTML(s);

        function mostrarToast(msg, erro = false) {
            const t = document.getElementById('toast');
            t.innerText = msg;
            t.style.background  = erro ? 'rgba(255,77,77,0.12)' : 'rgba(0,229,255,0.12)';
            t.style.borderColor = erro ? 'rgba(255,77,77,0.3)'  : 'rgba(0,229,255,0.3)';
            t.style.color       = erro ? 'var(--danger)'       : 'var(--cyan)';
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2500);
        }

        function renderProdutos(lista) {
            const area = document.getElementById('listaArea');
            (function(){
                const arr = lista;
                const ocultos = arr.filter(p => p.oculto).length;
                const ativos  = arr.length - ocultos;
                const numEl   = document.getElementById('totalCount');
                const labEl   = document.getElementById('totalLabel');
                if (ocultos > 0) {
                    numEl.innerText = ativos;
                    if (labEl) labEl.innerText = 'ativos · ' + ocultos + ' ocultos';
                } else {
                    numEl.innerText = arr.length;
                    if (labEl) labEl.innerText = 'produtos no acervo';
                }
            })();

            if (lista.length === 0) {
                area.innerHTML = `
                    <div class="state-msg">
                        <span class="icon" aria-hidden="true">📭</span>
                        <p>Nenhum produto cadastrado ainda.</p>
                        <p><a href="/admin.html">Adicionar produtos →</a></p>
                    </div>`;
                return;
            }

            // Build cards via DOM creation (safer than innerHTML with interpolation)
            const filtered = currentFilter
                ? lista.filter(p => {
                    const q = currentFilter.toLowerCase();
                    return (p.nome || '').toLowerCase().includes(q) ||
                           (p.cor  || '').toLowerCase().includes(q);
                })
                : lista;

            if (filtered.length === 0) {
                area.innerHTML = '<div class="vz-empty-state">Nenhum produto encontrado para "' + escapeAttr(currentFilter) + '".</div>';
                return;
            }

            const isGallery = currentView === 'gallery';
            area.innerHTML = '<div class="produtos-grid view-' + currentView + '" id="grid"></div>' +
                (isGallery ? '<p class="gallery-hint">Mosaico visual · alterne para Grade ou Lista para editar</p>' : '');
            const grid = document.getElementById('grid');

            filtered.forEach(p => {
                const card = document.createElement('div');
                card.className = 'produto-card';
                card.id = `card-${p.id}`;
                card.dataset.oculto = p.oculto ? 'true' : 'false';
                card.dataset.prodId = p.id;
                card.dataset.nome = p.nome; // used by gallery mode CSS ::after
                card.innerHTML = `
                    ${p.oculto ? '<span class="oculto-badge">OCULTO</span>' : ''}
                    <img src="${escapeAttr(p.imagem_url || '')}" alt="${escapeAttr(p.nome)}">
                    <div class="produto-card-body">
                        <div class="produto-fields">
                            <div class="field-group">
                                <label class="field-label" for="nome-${p.id}">Nome</label>
                                <input type="text" id="nome-${p.id}" value="${escapeAttr(p.nome)}">
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="preco-${p.id}">Preço (R$)</label>
                                <input type="number" id="preco-${p.id}" value="${Number(p.preco).toFixed(2)}" step="0.01" min="0" max="999999">
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="cor-${p.id}">Cor</label>
                                <input type="text" id="cor-${p.id}" list="coresList" value="${escapeAttr(p.cor || '')}" maxlength="50" placeholder="ex: Preta">
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="tipo-${p.id}">Tipo</label>
                                <select id="tipo-${p.id}" aria-label="Tipo">
                                    <option value="Camiseta"  ${p.tipo === 'Camiseta'  ? 'selected' : ''}>Camiseta</option>
                                    <option value="Regata"    ${p.tipo === 'Regata'    ? 'selected' : ''}>Regata</option>
                                    <option value="Babylook"  ${p.tipo === 'Babylook'  ? 'selected' : ''}>Babylook</option>
                                    <option value="Moletom"   ${p.tipo === 'Moletom'   ? 'selected' : ''}>Moletom</option>
                                </select>
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="genero-${p.id}">Gênero</label>
                                <input type="text" id="genero-${p.id}" list="generosList" value="${escapeAttr(p.genero || '')}" maxlength="50" placeholder="ex: Metal">
                            </div>
                            <div class="field-group field-full">
                                <label class="field-label" for="desc-${p.id}">Descrição (opcional)</label>
                                <textarea id="desc-${p.id}" maxlength="500" rows="2" placeholder="Blurb personalizado no catálogo...">${escapeAttr(p.descricao || '')}</textarea>
                            </div>
                            <div class="field-group field-stats">
                                <span class="stat-cliques">${p.cliques || 0} cliques</span>
                            </div>
                        </div>
                        <p class="card-status" id="st-${p.id}" role="status" aria-live="polite"></p>
                        <div class="produto-actions">
                            <button class="btn-salvar-item" id="btn-${p.id}" data-id="${p.id}" data-action="salvar">Salvar</button>
                            <button class="btn-destaque-item" data-id="${p.id}" data-destaque="${p.destaque ? 'true' : 'false'}" data-action="destaque">${p.destaque ? '★ Destacado' : '☆ Destacar'}</button>
                            <button class="btn-duplicar-item" data-id="${p.id}" data-action="duplicar">Duplicar</button>
                            <button class="btn-ocultar-item" data-id="${p.id}" data-oculto="${p.oculto ? 'true' : 'false'}" data-action="visibility">${p.oculto ? 'Mostrar' : 'Ocultar'}</button>
                            <button class="btn-remover-item" data-id="${p.id}" data-nome="${escapeAttr(p.nome)}" data-action="remover">Remover</button>
                        </div>
                    </div>
                `;
                grid.appendChild(card);

                // Set onerror via JS property (not attribute) — CSP-safe
                const img = card.querySelector('img');
                if (img) img.onerror = function () {
                    this.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">' +
                        '<rect fill="#0a0a0a" width="300" height="200"/>' +
                        '<text x="150" y="100" fill="#444" text-anchor="middle" dy=".3em" font-family="sans-serif">SEM IMAGEM</text>' +
                        '</svg>'
                    );
                };
            });

            // Event delegation — all button actions
            grid.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                const id     = parseInt(btn.dataset.id, 10);
                const action = btn.dataset.action;
                if (action === 'salvar')     salvar(id);
                if (action === 'remover')    remover(id, btn.dataset.nome);
                if (action === 'visibility') toggleVisibility(id, btn);
                if (action === 'destaque')   toggleDestaque(id, btn);
                if (action === 'duplicar')   duplicarProduto(id);
            });

            // Bulk checkboxes — separate listener for change events
            grid.addEventListener('change', function(e) {
                if (!e.target.classList.contains('bulk-check')) return;
                const id = parseInt(e.target.dataset.id, 10);
                if (e.target.checked) bulkSelection.add(id);
                else bulkSelection.delete(id);
                renderBulkBar();
            });
        }

        async function toggleDestaque(id, btn) {
            const novoEstado = btn.dataset.destaque !== 'true';
            btn.disabled = true;
            try {
                const p = produtos.find(x => x.id === id);
                if (!p) return;
                const res = await fetch('/api/produtos/' + id, {
                    method: 'PUT', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...p, destaque: novoEstado })
                });
                if (!res.ok) throw new Error();
                mostrarToast(novoEstado ? 'Produto em destaque!' : 'Destaque removido.');
                carregar();
            } catch (_) { btn.disabled = false; mostrarToast('Erro.', true); }
        }

        async function duplicarProduto(id) {
            try {
                const res = await fetch('/api/produtos/' + id + '/duplicate', {
                    method: 'POST', credentials: 'include'
                });
                if (!res.ok) throw new Error();
                mostrarToast('Produto duplicado!');
                carregar();
            } catch (_) { mostrarToast('Erro ao duplicar.', true); }
        }

        async function toggleVisibility(id, btn) {
            const novoEstado = btn.dataset.oculto !== 'true';
            const labelOriginal = btn.textContent;
            btn.disabled = true;
            btn.textContent = '...';
            try {
                const res = await fetch('/api/produtos/' + id + '/visibility', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ oculto: novoEstado })
                });
                if (!res.ok) throw new Error();
                mostrarToast(novoEstado ? 'Produto oculto do catálogo.' : 'Produto visível no catálogo.');
                carregar();
            } catch (_) {
                btn.disabled = false;
                btn.textContent = labelOriginal;
                mostrarToast('Erro ao alterar visibilidade.', true);
            }
        }

        function renderBulkBar() {
            let bar = document.getElementById('bulkBar');
            if (bulkSelection.size === 0) {
                if (bar) bar.remove();
                return;
            }
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'bulkBar';
                bar.className = 'bulk-bar';
                document.body.appendChild(bar);
            }
            bar.innerHTML =
                '<span class="bulk-count">' + bulkSelection.size + ' selecionado' + (bulkSelection.size > 1 ? 's' : '') + '</span>' +
                '<button type="button" class="bulk-btn bulk-btn-hide">Ocultar</button>' +
                '<button type="button" class="bulk-btn bulk-btn-show">Mostrar</button>' +
                '<button type="button" class="bulk-btn bulk-btn-cancel">Cancelar</button>';
            bar.querySelector('.bulk-btn-hide').addEventListener('click', () => bulkAction(true));
            bar.querySelector('.bulk-btn-show').addEventListener('click', () => bulkAction(false));
            bar.querySelector('.bulk-btn-cancel').addEventListener('click', () => {
                bulkSelection.clear();
                renderBulkBar();
                carregar();
            });
        }

        async function bulkAction(oculto) {
            const ids = [...bulkSelection];
            if (ids.length === 0) return;
            try {
                const res = await fetch('/api/produtos/bulk-visibility', {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids, oculto })
                });
                if (!res.ok) throw new Error();
                mostrarToast(oculto
                    ? ids.length + ' produto(s) ocultado(s).'
                    : ids.length + ' produto(s) visível(is).');
                bulkSelection.clear();
                renderBulkBar();
                carregar();
            } catch (_) {
                mostrarToast('Erro na operação em lote.', true);
            }
        }

        async function carregar() {
            try {
                const res = await fetch('/api/produtos', { credentials: 'include' });
                if (!res.ok) throw new Error();
                produtos = await res.json();
                renderProdutos(produtos);
            } catch (e) {
                document.getElementById('listaArea').innerHTML = `
                    <div class="state-msg">
                        <span class="icon" aria-hidden="true">⚠️</span>
                        <p>Erro ao carregar produtos. Verifique o servidor.</p>
                    </div>`;
            }
        }

        async function salvar(id) {
            const nome  = document.getElementById(`nome-${id}`).value.trim();
            const preco = parseFloat(document.getElementById(`preco-${id}`).value);
            const cor   = document.getElementById(`cor-${id}`)?.value.trim() || '';
            const st    = document.getElementById(`st-${id}`);
            const btn   = document.getElementById(`btn-${id}`);

            if (!nome || !Number.isFinite(preco) || preco < 0) {
                st.innerText = '⚠️ Nome e preço válidos são obrigatórios.';
                st.className = 'card-status erro';
                return;
            }

            btn.disabled  = true;
            btn.innerText = 'Salvando...';
            st.innerText  = '';
            st.className  = 'card-status';

            try {
                const res = await fetch(`/api/produtos/${id}`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nome: nome.toUpperCase(),
                        preco,
                        cor,
                        tipo:      document.getElementById(`tipo-${id}`)?.value || 'Camiseta',
                        genero:    (document.getElementById(`genero-${id}`)?.value || '').trim(),
                        descricao: (document.getElementById(`desc-${id}`)?.value || '').trim(),
                        destaque:  document.querySelector(`[data-id="${id}"][data-action="destaque"]`)?.dataset.destaque === 'true'
                    })
                });
                if (res.ok) {
                    st.innerText = '✅ Salvo!';
                    mostrarToast('✓ Produto atualizado');
                } else if (res.status === 401) {
                    window.location.replace('/login.html');
                } else {
                    st.innerText = '❌ Erro ao salvar.';
                    st.className = 'card-status erro';
                }
            } catch (e) {
                st.innerText = '⚠️ Sem conexão com o servidor.';
                st.className = 'card-status erro';
            } finally {
                btn.disabled  = false;
                btn.innerText = 'Salvar';
            }
        }

        async function remover(id, nome) {
            if (!confirm(`Remover o produto "${nome}" permanentemente?\n\nEsta ação não pode ser desfeita.`)) return;

            try {
                const res = await fetch(`/api/produtos/${id}`, { method: 'DELETE', credentials: 'include' });
                if (res.ok) {
                    const card = document.getElementById(`card-${id}`);
                    card.style.transition = 'opacity 0.3s, transform 0.3s';
                    card.style.opacity    = '0';
                    card.style.transform  = 'scale(0.95)';
                    setTimeout(() => {
                        card.remove();
                        produtos = produtos.filter(p => p.id !== id);
                        (function(){
                const arr = produtos;
                const ocultos = arr.filter(p => p.oculto).length;
                const ativos  = arr.length - ocultos;
                const numEl   = document.getElementById('totalCount');
                const labEl   = document.getElementById('totalLabel');
                if (ocultos > 0) {
                    numEl.innerText = ativos;
                    if (labEl) labEl.innerText = 'ativos · ' + ocultos + ' ocultos';
                } else {
                    numEl.innerText = arr.length;
                    if (labEl) labEl.innerText = 'produtos no acervo';
                }
            })();
                    }, 300);
                    mostrarToast(`✓ "${nome}" removido`);
                } else if (res.status === 401) {
                    window.location.replace('/login.html');
                } else {
                    mostrarToast('❌ Erro ao remover produto.', true);
                }
            } catch (e) {
                mostrarToast('⚠️ Sem conexão com o servidor.', true);
            }
        }

        carregar();

        // View toggle
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                try { localStorage.setItem('vz-produtos-view', currentView); } catch (_) {}
                renderProdutos(produtos);
            });
            if (btn.dataset.view === currentView) {
                document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });

        // Search filter (debounced)
        const searchInput = document.getElementById('produtosSearch');
        if (searchInput) {
            let searchTimer;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    currentFilter = searchInput.value.trim();
                    renderProdutos(produtos);
                }, 180);
            });
        }
})();