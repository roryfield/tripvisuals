// [VZ] admin-hub — extracted from admin-hub.html
(function () {
    'use strict';

    function init() {
        var btnClaro  = document.getElementById('btnClaro');
        var btnEscuro = document.getElementById('btnEscuro');
        if (btnClaro)  btnClaro.addEventListener('click',  function () { setTema('claro'); });
        if (btnEscuro) btnEscuro.addEventListener('click', function () { setTema('escuro'); });
        loadStats();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function mostrarToast(msg, erro) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.innerText = msg;
        t.style.background  = erro ? 'rgba(255,77,77,0.12)' : 'rgba(0,229,255,0.12)';
        t.style.borderColor = erro ? 'rgba(255,77,77,0.3)'  : 'rgba(0,229,255,0.3)';
        t.style.color       = erro ? 'var(--danger)'        : 'var(--cyan)';
        t.classList.add('show');
        clearTimeout(t._to);
        t._to = setTimeout(function () { t.classList.remove('show'); }, 2500);
    }

    // ── Cada stat carrega independentemente e em paralelo ────────
    // (antes: 4 awaits sequenciais — um lento atrasava todos os outros)

    async function loadConfigStats() {
        try {
            const res = await fetch('/api/config', { credentials: 'include' });
            if (!res.ok) throw new Error('config');
            const configs = await res.json();

            const layoutLabels = { 'grid-1': 'Lista', 'grid-2': 'Duo', 'grid-3': 'Grade' };
            document.getElementById('statLayout').innerText =
                layoutLabels[configs.layout_padrao] || '—';
            document.getElementById('statTema').innerText =
                configs.tema_admin === 'claro' ? '☀️ Claro' : '🌑 Escuro';
            marcarTemaBtn(configs.tema_admin || 'escuro');
        } catch (e) {
            document.getElementById('statLayout').innerHTML = '<span class="stat-error">Erro ao carregar</span>';
            document.getElementById('statTema').innerHTML   = '<span class="stat-error">Erro ao carregar</span>';
            marcarTemaBtn(document.body.classList.contains('tema-claro') ? 'claro' : 'escuro');
        }
    }

    async function loadProdutosStats() {
        try {
            const res  = await fetch('/api/produtos', { credentials: 'include' });
            if (!res.ok) throw new Error('produtos');
            const data = await res.json();
            document.getElementById('statProdutos').innerText = data.length;
        } catch (e) {
            document.getElementById('statProdutos').innerHTML = '<span class="stat-error">Erro</span>';
        }
    }

    async function loadPedidosStats() {
        try {
            const resPed = await fetch('/api/pedidos', { credentials: 'include' });
            if (resPed.ok) {
                const ped     = await resPed.json();
                const abertos = ped.filter(p => p.status !== 'entregue').length;
                const el      = document.getElementById('statPedidos');
                if (el) el.innerText = abertos;
            }
        } catch (_) {
            const el = document.getElementById('statPedidos');
            if (el) el.innerHTML = '<span class="stat-error">?</span>';
        }
    }

    async function loadPagamentosStats() {
        try {
            const resChk = await fetch('/api/checkout/status', { credentials: 'include' });
            const chk    = resChk.ok ? await resChk.json() : { enabled: false };
            const el     = document.getElementById('statPagamentos');
            if (el) {
                el.innerHTML = chk.enabled
                    ? '<span class="stat-pagamentos-on">🟢 Ativo</span>'
                    : '<span class="stat-pagamentos-off">⚪ Inativo</span>';
            }
            const card = document.getElementById('statPagamentosCard');
            if (card && !chk.enabled) card.title = 'Aguardando CNPJ + chave Asaas. Veja ATIVACAO_PAGAMENTOS.md.';
        } catch (_) {
            const el = document.getElementById('statPagamentos');
            if (el) el.innerHTML = '<span class="stat-error">?</span>';
        }
    }

    async function loadStats() {
        // allSettled: cada stat já tem seu próprio try/catch — uma falha
        // não deve bloquear nem atrasar as outras três.
        await Promise.allSettled([
            loadConfigStats(),
            loadProdutosStats(),
            loadPedidosStats(),
            loadPagamentosStats()
        ]);
    }

    function marcarTemaBtn(tema) {
        document.getElementById('btnClaro').classList.toggle('active',  tema === 'claro');
        document.getElementById('btnEscuro').classList.toggle('active', tema === 'escuro');
    }

    async function setTema(tema) {
        // Guarda o estado anterior pra reverter visualmente se o save falhar.
        const temaAnterior = document.body.classList.contains('tema-claro') ? 'claro' : 'escuro';
        if (temaAnterior === tema) return; // já está nesse tema, nada a fazer

        document.body.classList.toggle('tema-claro', tema === 'claro');
        marcarTemaBtn(tema);
        document.getElementById('statTema').innerText = tema === 'claro' ? '☀️ Claro' : '🌑 Escuro';

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ chave: 'tema_admin', valor: tema })
            });
            if (res.status === 401) { window.location.replace('/login.html'); return; }
            if (!res.ok) throw new Error('save failed');
        } catch (e) {
            // Rollback visual: reverte pro tema anterior já que o servidor não confirmou.
            document.body.classList.toggle('tema-claro', temaAnterior === 'claro');
            marcarTemaBtn(temaAnterior);
            document.getElementById('statTema').innerText = temaAnterior === 'claro' ? '☀️ Claro' : '🌑 Escuro';
            mostrarToast('⚠️ Não foi possível salvar o tema. Tente novamente.', true);
        }
    }
})();
