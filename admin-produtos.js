// [VZ] admin-produtos — extracted from admin-produtos.html
(function () {
    'use strict';

let produtos = [];

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
            document.getElementById('totalCount').innerText = lista.length;

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
            area.innerHTML = '<div class="produtos-grid" id="grid"></div>';
            const grid = document.getElementById('grid');

            lista.forEach(p => {
                const card = document.createElement('div');
                card.className = 'produto-card';
                card.id = `card-${p.id}`;
                card.innerHTML = `
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
                        </div>
                        <p class="card-status" id="st-${p.id}" role="status" aria-live="polite"></p>
                        <div class="produto-actions">
                            <button class="btn-salvar-item" id="btn-${p.id}" data-id="${p.id}" data-action="salvar">Salvar</button>
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

            // Event delegation (safer than inline onclick with template strings)
            grid.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                const id     = parseInt(btn.dataset.id, 10);
                const action = btn.dataset.action;
                if (action === 'salvar')  salvar(id);
                if (action === 'remover') remover(id, btn.dataset.nome);
            });
        }

        async function carregar() {
            try {
                const res = await fetch('/api/produtos');
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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nome: nome.toUpperCase(), preco })
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
                const res = await fetch(`/api/produtos/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    const card = document.getElementById(`card-${id}`);
                    card.style.transition = 'opacity 0.3s, transform 0.3s';
                    card.style.opacity    = '0';
                    card.style.transform  = 'scale(0.95)';
                    setTimeout(() => {
                        card.remove();
                        produtos = produtos.filter(p => p.id !== id);
                        document.getElementById('totalCount').innerText = produtos.length;
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
})();