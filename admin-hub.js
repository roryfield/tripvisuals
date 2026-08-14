// [VZ] admin-hub — extracted from admin-hub.html
(function () {
    'use strict';

    function init() {
        var btnClaro  = document.getElementById('btnClaro');
        var btnEscuro = document.getElementById('btnEscuro');
        if (btnClaro)  btnClaro.addEventListener('click',  function () { setTema('claro'); });
        if (btnEscuro) btnEscuro.addEventListener('click', function () { setTema('escuro'); });
        loadStats();
        loadCharts();
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

    const ESTAGIOS = [
        { chave: 'novo',       label: 'Novo'         },
        { chave: 'confirmado', label: 'Confirmado'   },
        { chave: 'producao',   label: 'Em produção'  },
        { chave: 'enviado',    label: 'Enviado'      },
        { chave: 'entregue',   label: 'Entregue'     },
    ];

    async function loadPedidosStats() {
        try {
            const resPed = await fetch('/api/pedidos', { credentials: 'include' });
            if (resPed.ok) {
                const ped     = await resPed.json();
                const abertos = ped.filter(p => p.status !== 'entregue').length;
                const el      = document.getElementById('statPedidos');
                if (el) el.innerText = abertos;
                renderProducaoRow(ped);
            } else {
                renderProducaoRow(null);
            }
        } catch (_) {
            const el = document.getElementById('statPedidos');
            if (el) el.innerHTML = '<span class="stat-error">?</span>';
            renderProducaoRow(null);
        }
    }

    function renderProducaoRow(pedidos) {
        const row = document.getElementById('producaoRow');
        if (!row) return;
        if (!pedidos) {
            row.innerHTML = '<span class="stat-error">Erro ao carregar produção</span>';
            return;
        }
        if (pedidos.length === 0) {
            row.innerHTML = '<span class="producao-vazio">Nenhum pedido ainda.</span>';
            return;
        }
        row.innerHTML = ESTAGIOS.map(function (e) {
            const n = pedidos.filter(function (p) { return p.status === e.chave; }).length;
            return '<div class="producao-stage producao-stage-' + e.chave + '">' +
                       '<span class="producao-n">' + n + '</span>' +
                       '<span class="producao-label">' + e.label + '</span>' +
                   '</div>';
        }).join('');
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

    const SEVERIDADE_ICON = { sucesso: '✅', erro: '⚠️', info: 'ℹ️' };

    function formatarQuando(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } catch (_) { return iso; }
    }

    async function loadAtividadeRecente() {
        const el = document.getElementById('atividadeLista');
        if (!el) return;
        try {
            const res = await fetch('/api/eventos?limite=12', { credentials: 'include' });
            if (!res.ok) throw new Error('eventos');
            const eventos = await res.json();
            if (eventos.length === 0) {
                el.innerHTML = '<span class="atividade-vazia">Nenhuma atividade registrada ainda.</span>';
                return;
            }
            el.innerHTML = eventos.map(function (ev) {
                const icone = SEVERIDADE_ICON[ev.severidade] || 'ℹ️';
                const podeDesfazer = ev.tipo === 'edicao_em_massa' && !(ev.detalhes && ev.detalhes.desfeito);
                const botao = podeDesfazer
                    ? '<button type="button" class="btn-desfazer-evento" data-evento-id="' + ev.id + '">desfazer</button>'
                    : '';
                return '<div class="atividade-item atividade-' + ev.severidade + '">' +
                           '<span class="atividade-icone" aria-hidden="true">' + icone + '</span>' +
                           '<span class="atividade-texto">' + escapeHTMLLocal(ev.resumo) + '</span>' +
                           botao +
                           '<span class="atividade-quando">' + formatarQuando(ev.criado_em) + '</span>' +
                       '</div>';
            }).join('');
        } catch (_) {
            el.innerHTML = '<span class="atividade-vazia">Erro ao carregar atividade recente.</span>';
        }
    }

    // [VZ] Fase 6 — desfazer edição em massa direto da atividade recente.
    // Delegação de evento no container, não um listener por botão (a lista
    // é recriada inteira a cada carregamento).
    const atividadeListaEl = document.getElementById('atividadeLista');
    if (atividadeListaEl) {
        atividadeListaEl.addEventListener('click', async function (e) {
            const btn = e.target.closest('.btn-desfazer-evento');
            if (!btn) return;
            const eventoId = btn.dataset.eventoId;
            if (!confirm('Desfazer essa edição em massa? Produtos que já foram alterados de novo depois não serão mexidos.')) return;
            btn.disabled = true;
            btn.textContent = 'desfazendo…';
            try {
                const res = await fetch('/api/produtos/bulk-campo/desfazer/' + eventoId, {
                    method: 'POST', credentials: 'include',
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Erro ao desfazer.');
                await loadAtividadeRecente();
            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'desfazer';
                mostrarToast(err.message || 'Erro ao desfazer edição em massa.', true);
            }
        });
    }

    // Escape local — admin-hub não tinha esse helper antes (Fase 4).
    function escapeHTMLLocal(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    async function loadStats() {
        // allSettled: cada stat já tem seu próprio try/catch — uma falha
        // não deve bloquear nem atrasar as outras três.
        await Promise.allSettled([
            loadConfigStats(),
            loadProdutosStats(),
            loadPedidosStats(),
            loadPagamentosStats(),
            loadAtividadeRecente()
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
    function loadCharts() {
        fetch('/api/hub/estatisticas', { credentials: 'include' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (d) {
                renderChart('chartAtividade', 'line', d.atividadePorDia, 'dia', 'Eventos', 'cyan');
                renderChart('chartCatalogador', 'bar', d.catalogadorPorSemana, 'semana', 'Produtos catalogados', 'purple');
            })
            .catch(function (e) { console.error('Erro ao carregar gráficos do Hub:', e.message); });
    }

    function chartColors() {
        var s = getComputedStyle(document.documentElement);
        return {
            cyan:   (s.getPropertyValue('--cyan').trim())   || '#00e5ff',
            purple: (s.getPropertyValue('--purple').trim()) || '#9d00ff',
            muted:  (s.getPropertyValue('--text-muted').trim()) || '#888888',
            border: (s.getPropertyValue('--border').trim())     || 'rgba(255,255,255,0.07)',
        };
    }

    function fmtLabel(iso) {
        var d = new Date(iso + 'T00:00:00');
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }

    function renderChart(canvasId, tipo, rows, keyField, label, corNome) {
        var el = document.getElementById(canvasId);
        if (!el || typeof Chart === 'undefined' || !Array.isArray(rows)) return;
        var c    = chartColors();
        var cor  = c[corNome] || c.cyan;
        var base = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: c.muted, font: { size: 10 } }, grid: { display: false } },
                y: {
                    ticks: { color: c.muted, font: { size: 10 }, precision: 0 },
                    grid: { color: c.border },
                    beginAtZero: true,
                },
            },
        };
        var dataset = tipo === 'line'
            ? { label: label, data: rows.map(function (r) { return r.total; }), borderColor: cor, backgroundColor: cor + '22', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }
            : { label: label, data: rows.map(function (r) { return r.total; }), backgroundColor: cor, borderRadius: 4 };
        new Chart(el, {
            type: tipo,
            data: { labels: rows.map(function (r) { return fmtLabel(r[keyField]); }), datasets: [dataset] },
            options: base,
        });
    }

})();
