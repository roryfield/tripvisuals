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

        // Update filter chips
        document.querySelectorAll('.status-filter-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.status === filterStatus);
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
                        (p.cliente_nome ? '<p class="pedido-cliente">' + esc(p.cliente_nome) + (p.cliente_whatsapp ? ' · ' + esc(p.cliente_whatsapp) : '') + '</p>' : '') +
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
        document.getElementById('fStatus').value    = pedido?.status || 'novo';
        document.getElementById('fNotas').value     = pedido?.notas || '';
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        const fp = document.getElementById('fProduto');
        if (fp) { fp.setAttribute('aria-required', 'true'); fp.focus(); }
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
        const data = {
            produto_nome:       document.getElementById('fProduto').value.trim(),
            cliente_nome:       document.getElementById('fCliente').value.trim(),
            cliente_whatsapp:   document.getElementById('fWhatsapp').value.trim(),
            tamanho:            document.getElementById('fTamanho').value.trim(),
            valor:              document.getElementById('fValor').value,
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
            fCep.addEventListener('input', async function () {
                const cep = fCep.value.replace(/\D/g, '');
                if (cep.length === 8 && cepInfo) {
                    try {
                        const r = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
                        const d = await r.json();
                        if (d.erro) { cepInfo.textContent = 'CEP não encontrado'; return; }
                        cepInfo.textContent = d.localidade + ' / ' + d.uf + ' — ' + (d.bairro || '');
                    } catch (_) { cepInfo.textContent = ''; }
                } else if (cepInfo) { cepInfo.textContent = ''; }
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
