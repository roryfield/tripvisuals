// [VZ] admin-pedidos — Order tracking
(function () {
    'use strict';

    const STATUS_LABELS = {
        novo:       'Novo',
        confirmado: 'Confirmado',
        producao:   'Em Produção',
        enviado:    'Enviado',
        entregue:   'Entregue'
    };
    const STATUS_NEXT = {
        novo: 'confirmado', confirmado: 'producao',
        producao: 'enviado', enviado: 'entregue', entregue: 'entregue'
    };

    const esc = s => String(s||'').replace(/[&<>"']/g,
        c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    function mostrarToast(msg, erro) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.innerText = msg;
        t.style.background  = erro ? 'rgba(255,77,77,0.12)' : 'rgba(0,229,255,0.12)';
        t.style.borderColor = erro ? 'rgba(255,77,77,0.3)'  : 'rgba(0,229,255,0.3)';
        t.style.color       = erro ? 'var(--danger)'        : 'var(--cyan)';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    let pedidos = [];
    let filterStatus = '';
    let formOpen = false;
    let editingId = null;

    async function carregar() {
        try {
            const res  = await fetch('/api/pedidos', { credentials: 'include' });
            if (res.status === 401) { window.location.replace('/login.html'); return; }
            pedidos = res.ok ? await res.json() : [];
            renderLista();
        } catch (_) {
            mostrarToast('Erro ao carregar pedidos.', true);
        }
    }

    function renderLista() {
        const area  = document.getElementById('pedidosList');
        const count = document.getElementById('pedidosCount');
        if (!area) return;

        const lista = filterStatus
            ? pedidos.filter(p => p.status === filterStatus)
            : pedidos;

        const abertos = pedidos.filter(p => p.status !== 'entregue').length;
        if (count) count.textContent = abertos + ' aberto' + (abertos !== 1 ? 's' : '');

        // Update filter chips (pega tanto os do topo quanto os replicados
        // no painel lateral — mesma classe, mesmo estado ativo)
        document.querySelectorAll('.status-filter-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.status === filterStatus);
        });

        // [VZ] Fase 24 — contadores por status do painel lateral
        const porStatus = {};
        pedidos.forEach(p => { porStatus[p.status] = (porStatus[p.status] || 0) + 1; });
        document.querySelectorAll('[data-status-count]').forEach(el => {
            el.textContent = porStatus[el.dataset.statusCount] || 0;
        });

        if (lista.length === 0) {
            area.innerHTML = '<div class="vz-empty-state">' +
                (filterStatus ? 'Nenhum pedido com status "' + STATUS_LABELS[filterStatus] + '".' : 'Nenhum pedido registrado ainda.') +
                '</div>';
            return;
        }

        area.innerHTML = '';
        lista.forEach(p => {
            const card = document.createElement('div');
            card.className = 'pedido-card';
            card.dataset.id = p.id;
            const data = new Date(p.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
            card.innerHTML =
                '<div class="pedido-card-header">' +
                    '<div class="pedido-card-left">' +
                        '<p class="pedido-produto">' + esc(p.produto_nome) + (p.tamanho ? ' · ' + esc(p.tamanho) : '') + '</p>' +
                        (p.cliente_nome ? '<p class="pedido-cliente">' + esc(p.cliente_nome) + (p.cliente_whatsapp ? ' · ' + esc(p.cliente_whatsapp) : '') + (p.cep ? ' · CEP ' + esc(p.cep) : '') + '</p>' : '') +
                        (p.notas ? '<p class="pedido-notas">' + esc(p.notas) + '</p>' : '') +
                    '</div>' +
                    '<div class="pedido-card-right">' +
                        (p.valor ? '<p class="pedido-valor">R$ ' + Number(p.valor).toFixed(2) + '</p>' : '') +
                        '<p class="pedido-data">' + data + '</p>' +
                        '<span class="status-chip status-' + p.status + '">' + STATUS_LABELS[p.status] + '</span>' +
                        (p.payment_status === 'pago'     ? '<span class="payment-badge payment-pago">✓ PIX pago</span>' : '') +
                        (p.payment_status === 'pendente' ? '<span class="payment-badge payment-pendente">PIX pendente</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="pedido-card-actions">' +
                    '<button type="button" class="pedido-btn-edit" data-id="' + p.id + '">Editar</button>' +
                    (p.status !== 'entregue' ? '<button type="button" class="pedido-btn-avançar" data-id="' + p.id + '" data-next="' + STATUS_NEXT[p.status] + '">→ ' + STATUS_LABELS[STATUS_NEXT[p.status]] + '</button>' : '') +
                    '<button type="button" class="pedido-btn-del" data-id="' + p.id + '">Remover</button>' +
                '</div>';
            area.appendChild(card);
        });
    }

    async function avancarStatus(id, novoStatus) {
        const p = pedidos.find(x => x.id === id);
        if (!p) return;
        try {
            const res = await fetch(`/api/pedidos/${id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                produto_nome:     p.produto_nome,
                valor:            p.valor,
                tamanho:          p.tamanho,
                cliente_nome:     p.cliente_nome,
                cliente_whatsapp: p.cliente_whatsapp,
                cep:              p.cep,
                notas:            p.notas,
                status:           novoStatus
            })
            });
            if (!res.ok) throw new Error();
            mostrarToast('Status atualizado: ' + STATUS_LABELS[novoStatus]);
            await carregar();
        } catch (_) {
            mostrarToast('Erro ao atualizar status.', true);
        }
    }

    async function removerPedido(id) {
        if (!confirm('Remover este pedido? Ação irreversível.')) return;
        try {
            const res = await fetch(`/api/pedidos/${id}`, {
                method: 'DELETE', credentials: 'include'
            });
            if (!res.ok) throw new Error();
            mostrarToast('Pedido removido.');
            await carregar();
        } catch (_) {
            mostrarToast('Erro ao remover pedido.', true);
        }
    }

    // ── FORM ─────────────────────────────────────────────────────
    function abrirForm(pedido) {
        const modal = document.getElementById('pedidoFormModal');
        if (!modal) return;
        editingId = pedido ? pedido.id : null;
        document.getElementById('formTitle').textContent = pedido ? 'Editar pedido' : 'Novo pedido';
        document.getElementById('fProduto').value    = pedido?.produto_nome || '';
        document.getElementById('fCliente').value   = pedido?.cliente_nome || '';
        document.getElementById('fWhatsapp').value  = pedido?.cliente_whatsapp || '';
        document.getElementById('fTamanho').value   = pedido?.tamanho || '';
        document.getElementById('fValor').value     = pedido?.valor || '';
        document.getElementById('fCep').value       = pedido?.cep || '';
        document.getElementById('fStatus').value    = pedido?.status || 'novo';
        document.getElementById('fNotas').value     = pedido?.notas || '';
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        const fp = document.getElementById('fProduto');
        if (fp) { fp.setAttribute('aria-required', 'true'); fp.focus(); }

        // Se o pedido já tem CEP salvo, busca a cidade/UF pra exibir
        // (em vez de deixar o campo preenchido sem o contexto visual).
        const cepInfo = document.getElementById('cepInfo');
        if (cepInfo) {
            if (pedido?.cep) consultarCep(pedido.cep, cepInfo);
            else cepInfo.textContent = '';
        }

        // [VZ] Fase 8 — comprovante só faz sentido num pedido que já existe
        const comprovanteField = document.getElementById('comprovanteField');
        const comprovanteResultado = document.getElementById('comprovanteResultado');
        const btnConfirmarPagamento = document.getElementById('btnConfirmarPagamento');
        const fComprovante = document.getElementById('fComprovante');
        if (comprovanteField) comprovanteField.hidden = !pedido;
        if (comprovanteResultado) {
            if (pedido?.payment_status === 'pago') {
                comprovanteResultado.textContent = '✓ Pagamento já confirmado.';
                comprovanteResultado.className = 'comprovante-resultado ok';
            } else if (pedido?.comprovante_valor_detectado != null) {
                comprovanteResultado.textContent = '⚠ Comprovante já anexado — R$ ' +
                    Number(pedido.comprovante_valor_detectado).toFixed(2) + ' detectado, aguardando confirmação.';
                comprovanteResultado.className = 'comprovante-resultado alerta';
            } else {
                comprovanteResultado.textContent = '';
                comprovanteResultado.className = 'comprovante-resultado';
            }
        }
        if (btnConfirmarPagamento) {
            btnConfirmarPagamento.hidden = !(pedido?.comprovante_valor_detectado != null && pedido?.payment_status !== 'pago');
        }
        if (fComprovante) fComprovante.value = '';
    }

    async function consultarCep(cepValue, cepInfo) {
        const cep = String(cepValue).replace(/\D/g, '');
        if (cep.length !== 8) { cepInfo.textContent = ''; return; }
        try {
            const r = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
            const d = await r.json();
            if (d.erro) { cepInfo.textContent = 'CEP não encontrado'; return; }
            cepInfo.textContent = d.localidade + ' / ' + d.uf + ' — ' + (d.bairro || '');
        } catch (_) { cepInfo.textContent = ''; }
    }

    function fecharForm() {
        const modal = document.getElementById('pedidoFormModal');
        if (!modal) return;
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        editingId = null;
    }

    async function salvarForm(e) {
        e.preventDefault();
        const valorRaw = document.getElementById('fValor').value.trim();
        const valorNum = valorRaw === '' ? null : parseFloat(valorRaw);
        if (valorRaw !== '' && (!Number.isFinite(valorNum) || valorNum < 0)) {
            mostrarToast('Valor inválido. Use um número positivo ou deixe em branco.', true);
            document.getElementById('fValor').focus();
            return;
        }
        const data = {
            produto_nome:       document.getElementById('fProduto').value.trim(),
            cliente_nome:       document.getElementById('fCliente').value.trim(),
            cliente_whatsapp:   document.getElementById('fWhatsapp').value.trim(),
            tamanho:            document.getElementById('fTamanho').value.trim(),
            valor:              valorRaw === '' ? '' : valorNum,
            cep:                document.getElementById('fCep').value.trim(),
            status:             document.getElementById('fStatus').value,
            notas:              document.getElementById('fNotas').value.trim()
        };
        if (!data.produto_nome) {
            mostrarToast('Nome do produto é obrigatório.', true);
            return;
        }
        const isEdit  = editingId !== null;
        const url     = isEdit ? `/api/pedidos/${editingId}` : '/api/pedidos';
        const method  = isEdit ? 'PUT' : 'POST';
        try {
            const res = await fetch(url, {
                method, credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error();
            mostrarToast(isEdit ? 'Pedido atualizado.' : 'Pedido criado!');
            fecharForm();
            await carregar();
        } catch (_) {
            mostrarToast('Erro ao salvar pedido.', true);
        }
    }

    // ── INIT ─────────────────────────────────────────────────────
    function init() {
        initFreteConfig();
        initComprovantePagamento();
        initNovoViaComprovante();

        // Filter chips
        document.querySelectorAll('.status-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const s = chip.dataset.status;
                filterStatus = (filterStatus === s) ? '' : s;
                renderLista();
            });
        });

        // New pedido button
        const btnNovo = document.getElementById('btnNovoPedido');
        if (btnNovo) btnNovo.addEventListener('click', () => abrirForm(null));

        // Form submit
        // CEP lookup via ViaCEP
        const fCep = document.getElementById('fCep');
        const cepInfo = document.getElementById('cepInfo');
        if (fCep) {
            fCep.addEventListener('input', function () {
                const cep = fCep.value.replace(/\D/g, '');
                if (cep.length === 8 && cepInfo) {
                    consultarCep(cep, cepInfo);
                } else if (cepInfo) {
                    cepInfo.textContent = '';
                }
            });
        }

        const form = document.getElementById('pedidoForm');
        if (form) form.addEventListener('submit', salvarForm);

        // Form cancel / backdrop
        const cancelBtn  = document.getElementById('btnCancelarForm');
        const closeXBtn  = document.getElementById('btnFecharForm');
        if (cancelBtn)  cancelBtn.addEventListener('click', fecharForm);
        if (closeXBtn)  closeXBtn.addEventListener('click', fecharForm);
        const backdrop = document.getElementById('formBackdrop');
        if (backdrop) backdrop.addEventListener('click', fecharForm);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') fecharForm();
        });

        // Event delegation for card actions
        const lista = document.getElementById('pedidosList');
        if (lista) {
            lista.addEventListener('click', e => {
                const btn = e.target.closest('button[data-id]');
                if (!btn) return;
                const id = parseInt(btn.dataset.id, 10);
                if (btn.classList.contains('pedido-btn-edit')) {
                    const p = pedidos.find(x => x.id === id);
                    if (p) abrirForm(p);
                } else if (btn.classList.contains('pedido-btn-avançar')) {
                    avancarStatus(id, btn.dataset.next);
                } else if (btn.classList.contains('pedido-btn-del')) {
                    removerPedido(id);
                }
            });
        }

        // Logout
        if (typeof wireLogout === 'function') wireLogout();

        carregar();

        // CSV export
        const btnExport = document.getElementById('btnExportCsv');
        if (btnExport) {
            btnExport.addEventListener('click', async function () {
                try {
                    const res = await fetch('/api/pedidos/export', { credentials: 'include' });
                    if (!res.ok) throw new Error();
                    const blob = await res.blob();
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = 'pedidos-tripvisuals.csv';
                    document.body.appendChild(a); a.click(); a.remove();
                    URL.revokeObjectURL(url);
                    mostrarToast('CSV exportado!');
                } catch (_) { mostrarToast('Erro ao exportar.', true); }
            });
        }
    }

    // [VZ] Fase 7 — painel de frete por região
    function initFreteConfig() {
        const lista = document.getElementById('freteConfigLista');
        const ufEl = document.getElementById('freteUf');
        const valorEl = document.getElementById('freteValor');
        const prazoEl = document.getElementById('fretePrazo');
        const btnSalvar = document.getElementById('btnSalvarFrete');
        if (!lista || !btnSalvar) return;

        async function carregarFrete() {
            try {
                const res = await fetch('/api/frete/regioes', { credentials: 'include' });
                if (!res.ok) throw new Error();
                const regioes = await res.json();
                if (!regioes.length) {
                    lista.innerHTML = '<p class="frete-config-vazio">Nenhuma região configurada ainda. O frete de todo estado continua sendo combinado pelo WhatsApp até você adicionar um valor aqui.</p>';
                    return;
                }
                lista.innerHTML = regioes.map(r =>
                    '<div class="frete-config-item">' +
                        '<span class="frete-config-uf">' + esc(r.uf) + '</span>' +
                        '<span>R$ ' + Number(r.valor).toFixed(2) + '</span>' +
                        '<span>' + r.prazo_dias + ' dias</span>' +
                        '<button type="button" class="frete-config-remover" data-uf="' + esc(r.uf) + '" aria-label="Remover ' + esc(r.uf) + '">remover</button>' +
                    '</div>'
                ).join('');
            } catch (_) {
                lista.innerHTML = '<p class="frete-config-vazio">Erro ao carregar as regiões configuradas.</p>';
            }
        }

        btnSalvar.addEventListener('click', async () => {
            const uf = ufEl.value;
            const valor = parseFloat(valorEl.value);
            const prazoDias = parseInt(prazoEl.value, 10);
            if (!uf) { mostrarToast('Escolha um estado.', true); return; }
            if (!Number.isFinite(valor) || valor < 0) { mostrarToast('Valor de frete inválido.', true); return; }
            if (!Number.isInteger(prazoDias) || prazoDias < 1) { mostrarToast('Prazo inválido.', true); return; }
            try {
                const res = await fetch('/api/frete/regioes/' + uf, {
                    method: 'PUT', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ valor, prazoDias }),
                });
                if (!res.ok) throw new Error();
                mostrarToast('Frete de ' + uf + ' salvo.');
                ufEl.value = ''; valorEl.value = ''; prazoEl.value = '';
                carregarFrete();
            } catch (_) { mostrarToast('Erro ao salvar frete.', true); }
        });

        lista.addEventListener('click', async (e) => {
            const btn = e.target.closest('.frete-config-remover');
            if (!btn) return;
            const uf = btn.dataset.uf;
            if (!confirm('Remover o frete configurado para ' + uf + '? Esse estado volta a ser combinado pelo WhatsApp.')) return;
            try {
                const res = await fetch('/api/frete/regioes/' + uf, { method: 'DELETE', credentials: 'include' });
                if (!res.ok) throw new Error();
                carregarFrete();
            } catch (_) { mostrarToast('Erro ao remover.', true); }
        });

        carregarFrete();
    }

    // [VZ] Fase 8 — conferência de comprovante assistida por IA
    function initComprovantePagamento() {
        const btnAnalisar = document.getElementById('btnAnalisarComprovante');
        const btnConfirmar = document.getElementById('btnConfirmarPagamento');
        const resultadoEl = document.getElementById('comprovanteResultado');
        const fComprovante = document.getElementById('fComprovante');
        if (!btnAnalisar || !resultadoEl || !fComprovante) return;

        btnAnalisar.addEventListener('click', async () => {
            if (!editingId) return;
            const file = fComprovante.files[0];
            if (!file) { mostrarToast('Escolha uma imagem do comprovante primeiro.', true); return; }

            btnAnalisar.disabled = true;
            resultadoEl.className = 'comprovante-resultado';
            resultadoEl.textContent = 'Analisando comprovante…';
            if (btnConfirmar) btnConfirmar.hidden = true;

            try {
                const form = new FormData();
                form.append('comprovante', file);
                const res = await fetch('/api/pedidos/' + editingId + '/comprovante', {
                    method: 'POST', credentials: 'include', body: form,
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Erro ao analisar.');

                if (d.naoEComprovante) {
                    resultadoEl.textContent = '⚠ Essa imagem não parece um comprovante de pagamento. Confira o arquivo.';
                    resultadoEl.className = 'comprovante-resultado alerta';
                } else if (d.valor == null) {
                    resultadoEl.textContent = '⚠ Não consegui ler o valor nessa imagem. Confira manualmente e confirme se estiver certo.';
                    resultadoEl.className = 'comprovante-resultado alerta';
                    if (btnConfirmar) btnConfirmar.hidden = false;
                } else if (d.confere) {
                    resultadoEl.textContent = '✓ Valor confere: R$ ' + d.valor.toFixed(2) +
                        (d.nomePagador ? ', pago por ' + d.nomePagador : '') +
                        (d.dataHora ? ' em ' + d.dataHora : '') + '.';
                    resultadoEl.className = 'comprovante-resultado ok';
                    if (btnConfirmar) btnConfirmar.hidden = false;
                } else {
                    resultadoEl.textContent = '⚠ Valor lido (R$ ' + d.valor.toFixed(2) + ') diferente do esperado (R$ ' + d.valorEsperado.toFixed(2) + '). Confira antes de confirmar.';
                    resultadoEl.className = 'comprovante-resultado alerta';
                    if (btnConfirmar) btnConfirmar.hidden = false;
                }
            } catch (err) {
                resultadoEl.textContent = '✗ ' + (err.message || 'Erro ao analisar comprovante.');
                resultadoEl.className = 'comprovante-resultado erro';
            } finally {
                btnAnalisar.disabled = false;
            }
        });

        if (btnConfirmar) {
            btnConfirmar.addEventListener('click', async () => {
                if (!editingId) return;
                if (!confirm('Confirmar que o pagamento deste pedido foi recebido? O status vai avançar pra "Confirmado".')) return;
                btnConfirmar.disabled = true;
                try {
                    const res = await fetch('/api/pedidos/' + editingId + '/confirmar-pagamento', {
                        method: 'POST', credentials: 'include',
                    });
                    if (!res.ok) throw new Error();
                    mostrarToast('Pagamento confirmado!');
                    resultadoEl.textContent = '✓ Pagamento confirmado.';
                    resultadoEl.className = 'comprovante-resultado ok';
                    btnConfirmar.hidden = true;
                    carregar();
                } catch (_) {
                    mostrarToast('Erro ao confirmar pagamento.', true);
                    btnConfirmar.disabled = false;
                }
            });
        }
    }

    // [VZ] Fase 17 — criar pedido a partir de comprovante, sem precisar de
    // pedido já existente. Reaproveita abrirForm() e initComprovantePagamento()
    // — depois de criado, o pedido novo se comporta como qualquer outro que já
    // tem comprovante anexado aguardando confirmação.
    function initNovoViaComprovante() {
        const btn        = document.getElementById('btnNovoViaComprovante');
        const dlg        = document.getElementById('dlgNovoComprovante');
        const input      = document.getElementById('inputNovoComprovante');
        const status     = document.getElementById('statusNovoComprovante');
        const btnCancelar = document.getElementById('btnCancelarNovoComprovante');
        if (!btn || !dlg || !input || !status) return;

        btn.addEventListener('click', () => {
            status.textContent = '';
            status.className = 'comprovante-resultado';
            input.value = '';
            dlg.showModal();
        });

        if (btnCancelar) btnCancelar.addEventListener('click', () => dlg.close());

        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;

            status.textContent = 'Analisando comprovante…';
            status.className = 'comprovante-resultado';

            try {
                const form = new FormData();
                form.append('comprovante', file);
                const res = await fetch('/api/pedidos/novo-via-comprovante', {
                    method: 'POST', credentials: 'include', body: form,
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Erro ao processar comprovante.');

                status.textContent = '✓ Pedido #' + d.pedidoId + ' criado' +
                    (d.valor != null ? ' — R$ ' + d.valor.toFixed(2) + ' detectado' : ' — valor não identificado, confira manualmente') + '.';
                status.className = 'comprovante-resultado ok';

                setTimeout(async () => {
                    dlg.close();
                    await carregar();
                    abrirForm({
                        id:                          d.pedidoId,
                        produto_nome:                '(preencher produto)',
                        cliente_nome:                d.nomePagador || '',
                        cliente_whatsapp:             '',
                        tamanho:                      '',
                        valor:                        d.valor,
                        cep:                          '',
                        status:                       'novo',
                        notas:                        '',
                        payment_status:               'manual',
                        comprovante_valor_detectado:  d.valor,
                        comprovante_url:              d.comprovanteUrl,
                    });
                }, 900);
            } catch (err) {
                status.textContent = '✗ ' + (err.message || 'Erro ao processar comprovante.');
                status.className = 'comprovante-resultado erro';
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
