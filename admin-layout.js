// [VZ] admin-layout — extracted from admin-layout.html
(function () {
    'use strict';

    function init() {
        document.querySelectorAll('.opt').forEach(function (btn) {
            btn.addEventListener('click', function () {
                definirLayout(this.id.replace('opt-', ''));
            });
        });
        loadConfig();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function mostrarToast(msg, erro) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.style.background  = erro ? 'rgba(255,77,77,0.12)' : 'rgba(0,229,255,0.12)';
        t.style.borderColor = erro ? 'rgba(255,77,77,0.3)'  : 'rgba(0,229,255,0.3)';
        t.style.color       = erro ? 'var(--danger)'        : 'var(--cyan)';
        t.classList.add('show');
        setTimeout(function () { t.classList.remove('show'); }, 2500);
    }

    async function definirLayout(layout) {
        // Guarda o estado anterior pra reverter visualmente se o save falhar.
        const anterior = Array.from(document.querySelectorAll('.opt'))
            .find(o => o.classList.contains('active'));
        const layoutAnterior = anterior ? anterior.id.replace('opt-', '') : null;

        document.querySelectorAll('.opt').forEach(function (o) {
            const active = o.id === 'opt-' + layout;
            o.classList.toggle('active', active);
            o.setAttribute('aria-checked', active ? 'true' : 'false');
        });

        let mensagemErro = null;
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chave: 'layout_padrao', valor: layout })
            });
            const labels = { 'grid-1': 'Lista', 'grid-2': 'Duo', 'grid-3': 'Grade' };
            if (res.ok) {
                mostrarToast('✓ Layout "' + (labels[layout] || layout) + '" aplicado para todos!');
            } else if (res.status === 401) {
                window.location.replace('/login.html');
                return;
            } else {
                mensagemErro = '⚠️ Erro ao salvar. Tente novamente.';
            }
        } catch (e) {
            mensagemErro = '⚠️ Sem conexão com o servidor.';
        }

        if (mensagemErro) {
            // Rollback visual: reverte pro layout anterior já que o servidor não confirmou.
            if (layoutAnterior) {
                document.querySelectorAll('.opt').forEach(function (o) {
                    const active = o.id === 'opt-' + layoutAnterior;
                    o.classList.toggle('active', active);
                    o.setAttribute('aria-checked', active ? 'true' : 'false');
                });
            }
            mostrarToast(mensagemErro, true);
        }
    }

    async function loadConfig() {
        try {
            const res  = await fetch('/api/config');
            if (!res.ok) return;
            const data = await res.json();
            const layout = data.layout_padrao || 'grid-3';
            const el = document.getElementById('opt-' + layout);
            if (el) {
                el.classList.add('active');
                el.setAttribute('aria-checked', 'true');
            }
        } catch (e) { /* silent */ }
    }
})();
