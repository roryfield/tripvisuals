// [VZ] admin-produtos — extracted from admin-produtos.html
(function () {
    'use strict';

let produtos = [];
let bulkSelection = new Set();
let currentView = (function(){
    var valid = ['grid', 'compact', 'gallery'];
    try {
        var saved = localStorage.getItem('vz-produtos-view');
        return valid.indexOf(saved) !== -1 ? saved : 'grid';
    } catch (_) { return 'grid'; }
}());
let currentFilter = '';
let currentFilters = { tipo: '', banda: '', genero: '', rapido: '' }; // rapido: '' | 'semBanda' | 'ocultos' | 'precoZero'
let currentPage = 1;
const PRODUTOS_POR_PAGINA = 24;

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

        // [VZ] Fase 24 — fonte única pros contadores do topo (ativos/ocultos)
        // e pros três contadores clicáveis do painel lateral (sem banda,
        // ocultos, preço zero). Antes existiam duas cópias quase idênticas
        // deste cálculo (uma em renderProdutos, outra em remover()) — unificado
        // aqui, chamado dos dois lugares. Sempre calcula sobre o acervo
        // completo (não filtrado), porque o ponto do painel lateral é servir
        // de atalho pra filtro, não de resumo do que já está sendo mostrado.
        function atualizarContadores(arr) {
            const ocultos   = arr.filter(p => p.oculto).length;
            const semBanda  = arr.filter(p => !(p.banda || '').trim()).length;
            const precoZero = arr.filter(p => !(Number(p.preco) > 0)).length;
            const ativos    = arr.length - ocultos;

            const numEl = document.getElementById('totalCount');
            const labEl = document.getElementById('totalLabel');
            if (ocultos > 0) {
                if (numEl) numEl.innerText = ativos;
                if (labEl) labEl.innerText = 'ativos · ' + ocultos + ' ocultos';
            } else {
                if (numEl) numEl.innerText = arr.length;
                if (labEl) labEl.innerText = 'produtos no acervo';
            }

            [['semBanda', semBanda], ['ocultos', ocultos], ['precoZero', precoZero]].forEach(function (par) {
                const el = document.getElementById('sideCount-' + par[0]);
                if (el) el.textContent = par[1];
                const btn = document.getElementById('sideChip-' + par[0]);
                if (btn) btn.classList.toggle('active', currentFilters.rapido === par[0]);
            });
        }

        function renderPaginacaoHTML(totalPaginas, totalFiltrado, inicio, qtdNaPagina) {
            const de = totalFiltrado === 0 ? 0 : inicio + 1;
            const ate = inicio + qtdNaPagina;
            return '<div class="produtos-paginacao">' +
                '<button type="button" class="pagina-btn" data-page-action="prev" ' + (currentPage <= 1 ? 'disabled' : '') + '>← Anterior</button>' +
                '<span class="pagina-info">' + de + '–' + ate + ' de ' + totalFiltrado + ' · página ' + currentPage + ' de ' + totalPaginas + '</span>' +
                '<button type="button" class="pagina-btn" data-page-action="next" ' + (currentPage >= totalPaginas ? 'disabled' : '') + '>Próxima →</button>' +
                '</div>';
        }

        function renderProdutos(lista) {
            const area = document.getElementById('listaArea');
            atualizarContadores(lista);

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
            const filtered = lista.filter(p => {
                if (currentFilter) {
                    const q = currentFilter.toLowerCase();
                    const match = (p.nome || '').toLowerCase().includes(q) ||
                                  (p.cor  || '').toLowerCase().includes(q);
                    if (!match) return false;
                }
                if (currentFilters.tipo && p.tipo !== currentFilters.tipo) return false;
                if (currentFilters.banda && !(p.banda || '').toLowerCase().includes(currentFilters.banda.toLowerCase())) return false;
                if (currentFilters.genero && !(p.genero || '').toLowerCase().includes(currentFilters.genero.toLowerCase())) return false;
                if (currentFilters.rapido === 'semBanda'  && (p.banda || '').trim())   return false;
                if (currentFilters.rapido === 'ocultos'   && !p.oculto)                return false;
                if (currentFilters.rapido === 'precoZero' && Number(p.preco) > 0)      return false;
                return true;
            });

            if (filtered.length === 0) {
                const msg = currentFilter
                    ? 'Nenhum produto encontrado para "' + escapeAttr(currentFilter) + '".'
                    : 'Nenhum produto encontrado com os filtros aplicados.';
                area.innerHTML = '<div class="vz-empty-state">' + msg + '</div>';
                return;
            }

            const totalPaginas = Math.max(1, Math.ceil(filtered.length / PRODUTOS_POR_PAGINA));
            if (currentPage > totalPaginas) currentPage = totalPaginas;
            if (currentPage < 1) currentPage = 1;
            const inicio = (currentPage - 1) * PRODUTOS_POR_PAGINA;
            const pageItems = filtered.slice(inicio, inicio + PRODUTOS_POR_PAGINA);

            const isGallery = currentView === 'gallery';
            area.innerHTML = '<div class="produtos-grid view-' + currentView + '" id="grid"></div>' +
                (isGallery ? '<p class="gallery-hint">Mosaico visual · alterne para Grade ou Lista para editar</p>' : '') +
                (totalPaginas > 1 ? renderPaginacaoHTML(totalPaginas, filtered.length, inicio, pageItems.length) : '');
            const grid = document.getElementById('grid');

            pageItems.forEach(p => {
                const card = document.createElement('div');
                card.className = 'produto-card';
                card.id = `card-${p.id}`;
                card.dataset.oculto = p.oculto ? 'true' : 'false';
                card.dataset.prodId = p.id;
                card.dataset.nome = p.nome; // used by gallery mode CSS ::after
                card.innerHTML = `
                    ${p.oculto ? '<span class="oculto-badge">OCULTO</span>' : ''}
                    <label class="bulk-check-wrap">
                        <input type="checkbox" class="bulk-check" data-id="${p.id}" ${bulkSelection.has(p.id) ? 'checked' : ''} aria-label="Selecionar ${escapeAttr(p.nome)}">
                    </label>
                    <div class="produto-img-wrap">
                        <img src="${escapeAttr(p.imagem_url || '')}" alt="${escapeAttr(p.nome)}">
                    </div>
                    <div class="produto-card-body">
                        <div class="produto-fields">
                            <div class="field-group field-primary">
                                <label class="field-label" for="nome-${p.id}">Nome</label>
                                <input type="text" id="nome-${p.id}" value="${escapeAttr(p.nome)}">
                            </div>
                            <div class="field-group field-primary">
                                <label class="field-label" for="preco-${p.id}">Preço (R$)</label>
                                <input type="number" id="preco-${p.id}" value="${Number(p.preco).toFixed(2)}" step="0.01" min="0" max="999999">
                            </div>
                            <div class="field-classificacao-label">Classificação</div>
                            <div class="field-group field-compact">
                                <label class="field-label" for="cor-${p.id}">Cor</label>
                                <input type="text" id="cor-${p.id}" list="coresList" value="${escapeAttr(p.cor || '')}" maxlength="50" placeholder="ex: Preta">
                            </div>
                            <div class="field-group field-compact">
                                <label class="field-label" for="tipo-${p.id}">Tipo</label>
                                <select id="tipo-${p.id}" aria-label="Tipo">
                                    <option value="Camiseta"  ${p.tipo === 'Camiseta'  ? 'selected' : ''}>Camiseta</option>
                                    <option value="Regata"    ${p.tipo === 'Regata'    ? 'selected' : ''}>Regata</option>
                                    <option value="Babylook"  ${p.tipo === 'Babylook'  ? 'selected' : ''}>Babylook</option>
                                    <option value="Moletom"   ${p.tipo === 'Moletom'   ? 'selected' : ''}>Moletom</option>
                                </select>
                            </div>
                            <div class="field-group field-compact">
                                <label class="field-label" for="genero-${p.id}">Gênero</label>
                                <input type="text" id="genero-${p.id}" list="generosList" value="${escapeAttr(p.genero || '')}" maxlength="50" placeholder="ex: Metal">
                            </div>
                            <div class="field-group field-compact">
                                <label class="field-label" for="banda-${p.id}">Banda</label>
                                <input type="text" id="banda-${p.id}" value="${escapeAttr(p.banda || '')}" maxlength="80" placeholder="ex: iron-maiden">
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

        // Fonte única de valores fixos por campo — reaproveita o que já
        // existe no projeto em vez de duplicar uma segunda lista solta.
        function valoresFixosPara(campo) {
            if (campo === 'tipo') {
                // Mesma lista fixa usada no editor individual (admin-produtos.js, ~linha 114-117)
                return ['Camiseta', 'Regata', 'Babylook', 'Moletom'];
            }
            if (campo === 'genero') {
                // Mesma datalist já cadastrada em admin-produtos.html (#generosList)
                return Array.from(document.querySelectorAll('#generosList option')).map(o => o.value);
            }
            if (campo === 'banda') {
                // Bandas não têm lista fixa cadastrada (catálogo aberto) — deriva
                // dos valores já em uso nos produtos carregados, evita erro de
                // digitação criando uma banda nova sem querer.
                return [...new Set(produtos.map(p => (p.banda || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
            }
            return [];
        }

        function renderBulkValorControl(campo) {
            const wrap = document.querySelector('.bulk-campo-valor-wrap');
            if (!wrap) return;
            const valores = valoresFixosPara(campo);
            const options = valores.map(v => `<option value="${escapeAttr(v)}">${escapeHTML(v)}</option>`).join('');
            wrap.innerHTML =
                `<select class="bulk-campo-valor" aria-label="Novo valor">` +
                    `<option value="">Selecione...</option>` +
                    options +
                    `<option value="__outro__">Outro (digitar)...</option>` +
                `</select>` +
                `<input type="text" class="bulk-campo-valor-outro" placeholder="novo valor" maxlength="80" hidden>`;
            const select = wrap.querySelector('.bulk-campo-valor');
            const outroInput = wrap.querySelector('.bulk-campo-valor-outro');
            select.addEventListener('change', () => {
                const isOutro = select.value === '__outro__';
                outroInput.hidden = !isOutro;
                if (isOutro) outroInput.focus();
            });
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
                '<span class="bulk-sep" aria-hidden="true"></span>' +
                '<select class="bulk-campo-select" aria-label="Campo para alterar em massa">' +
                    '<option value="tipo">Tipo</option>' +
                    '<option value="genero">Gênero</option>' +
                    '<option value="banda">Banda</option>' +
                '</select>' +
                '<span class="bulk-campo-valor-wrap"></span>' +
                '<button type="button" class="bulk-btn bulk-btn-campo">Aplicar a todos</button>' +
                '<button type="button" class="bulk-btn bulk-btn-cancel">Cancelar</button>';
            bar.querySelector('.bulk-btn-hide').addEventListener('click', () => bulkAction(true));
            bar.querySelector('.bulk-btn-show').addEventListener('click', () => bulkAction(false));
            bar.querySelector('.bulk-btn-campo').addEventListener('click', bulkCampoAction);
            bar.querySelector('.bulk-btn-cancel').addEventListener('click', () => {
                bulkSelection.clear();
                renderBulkBar();
                carregar();
            });
            const campoSelect = bar.querySelector('.bulk-campo-select');
            campoSelect.addEventListener('change', () => renderBulkValorControl(campoSelect.value));
            renderBulkValorControl(campoSelect.value);
        }

        async function bulkCampoAction() {
            const select     = document.querySelector('.bulk-campo-select');
            const valorSelect = document.querySelector('.bulk-campo-valor');
            const outroInput  = document.querySelector('.bulk-campo-valor-outro');
            const campo  = select ? select.value : '';
            const usandoOutro = valorSelect && valorSelect.value === '__outro__';
            const valor  = usandoOutro
                ? (outroInput ? outroInput.value.trim() : '')
                : (valorSelect ? valorSelect.value.trim() : '');
            const ids    = [...bulkSelection];

            if (!valor) { mostrarToast('Selecione ou informe o novo valor antes de aplicar.', true); return; }
            const nomeCampo = { genero: 'gênero', tipo: 'tipo', banda: 'banda' }[campo] || campo;
            if (!confirm(`Alterar o ${nomeCampo} de ${ids.length} produto(s) selecionado(s) para "${valor}"?\n\nEsta ação afeta todos os produtos marcados, não só um.`)) return;

            try {
                const res = await fetch('/api/produtos/bulk-campo', {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids, campo, valor })
                });
                if (!res.ok) throw new Error();
                mostrarToast(ids.length + ' produto(s) atualizado(s).');
                bulkSelection.clear();
                renderBulkBar();
                carregar();
            } catch (_) {
                mostrarToast('Erro na edição em massa.', true);
            }
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
                if (!res.ok) {
                    const corpo = await res.text().catch(() => '');
                    throw new Error('HTTP ' + res.status + (corpo ? ' — ' + corpo.slice(0, 200) : ''));
                }
                produtos = await res.json();
                renderProdutos(produtos);
            } catch (e) {
                console.error('[Oficina/Produtos] Falha ao carregar produtos:', e.message);
                document.getElementById('listaArea').innerHTML = `
                    <div class="state-msg">
                        <span class="icon" aria-hidden="true">⚠️</span>
                        <p>Erro ao carregar produtos. Verifique o servidor.</p>
                        <p style="font-size:0.75rem;opacity:0.6;margin-top:6px;">${e.message ? String(e.message).replace(/[<>]/g, '') : ''}</p>
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
                        banda:     (document.getElementById(`banda-${id}`)?.value || '').trim(),
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
                        atualizarContadores(produtos);
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

        // Paginação — delegação uma única vez no container persistente,
        // já que #listaArea nunca é recriado, só seu innerHTML muda.
        document.getElementById('listaArea').addEventListener('click', function(e) {
            const btn = e.target.closest('button[data-page-action]');
            if (!btn) return;
            if (btn.dataset.pageAction === 'prev') currentPage -= 1;
            if (btn.dataset.pageAction === 'next') currentPage += 1;
            renderProdutos(produtos);
            document.getElementById('listaArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

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
                    currentPage = 1;
                    renderProdutos(produtos);
                }, 180);
            });
        }

        // Filtros estruturados (Fase 3): tipo, banda, gênero
        const filtroTipo   = document.getElementById('filtroTipo');
        const filtroBanda  = document.getElementById('filtroBanda');
        const filtroGenero = document.getElementById('filtroGenero');
        const btnLimpar    = document.getElementById('btnLimparFiltros');
        let filtroTimer;
        function aplicarFiltrosDebounced() {
            clearTimeout(filtroTimer);
            filtroTimer = setTimeout(() => { currentPage = 1; renderProdutos(produtos); }, 180);
        }
        if (filtroTipo) filtroTipo.addEventListener('change', () => {
            currentFilters.tipo = filtroTipo.value;
            currentPage = 1;
            renderProdutos(produtos);
        });
        if (filtroBanda) filtroBanda.addEventListener('input', () => {
            currentFilters.banda = filtroBanda.value.trim();
            aplicarFiltrosDebounced();
        });
        if (filtroGenero) filtroGenero.addEventListener('input', () => {
            currentFilters.genero = filtroGenero.value.trim();
            aplicarFiltrosDebounced();
        });
        if (btnLimpar) btnLimpar.addEventListener('click', () => {
            currentFilters = { tipo: '', banda: '', genero: '', rapido: '' };
            currentFilter  = '';
            currentPage    = 1;
            if (searchInput)  searchInput.value  = '';
            if (filtroTipo)   filtroTipo.value    = '';
            if (filtroBanda)  filtroBanda.value   = '';
            if (filtroGenero) filtroGenero.value  = '';
            renderProdutos(produtos);
        });

        // Painel lateral (Fase 24) — três contadores clicáveis que já filtram
        // a lista, não só mostram o número. Clicar de novo no mesmo desliga o
        // filtro rápido; clicar em outro troca (são mutuamente exclusivos —
        // não faz sentido cruzar "sem banda" com "preço zero" aqui, cada um
        // é um atalho de triagem separado).
        ['semBanda', 'ocultos', 'precoZero'].forEach(function (chave) {
            const btn = document.getElementById('sideChip-' + chave);
            if (!btn) return;
            btn.addEventListener('click', function () {
                currentFilters.rapido = currentFilters.rapido === chave ? '' : chave;
                currentPage = 1;
                renderProdutos(produtos);
            });
        });
})();