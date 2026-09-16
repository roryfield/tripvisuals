// [VZ] admin-feedback.js — painel de triagem dos feedbacks recebidos no
// catálogo público. Mesmo padrão dos outros módulos do admin: IIFE,
// credentials: 'include' em toda chamada, delegação de evento em vez de
// handler inline, window.showToast pro feedback visual (vindo de admin-shared.js).
'use strict';

(function () {
    function mostrarToast(msg, erro) { window.showToast(msg, erro); }

    var listEl    = document.getElementById('feedbackList');
    var countEl   = document.getElementById('feedbackCount');
    var chipsWrap = document.querySelector('.pedidos-filter-chips');
    var filtroAtual = '';

    var STATUS_LABEL = { novo: 'Novo', lido: 'Lido', respondido: 'Respondido', arquivado: 'Arquivado' };
    // [VZ] Próximo passo sugerido por status — cada card só mostra o botão
    // que faz sentido a partir de onde ele está, em vez dos 4 sempre juntos.
    var PROXIMO_STATUS = { novo: 'lido', lido: 'respondido', respondido: 'arquivado' };
    var PROXIMO_LABEL  = { novo: 'Marcar como lido', lido: 'Marcar como respondido', respondido: 'Arquivar' };

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatarData(iso) {
        try {
            return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch (_) { return ''; }
    }

    function estrelasHtml(nota) {
        if (!nota) return '<span class="feedback-admin-sem-nota">sem nota</span>';
        var cheias = '★'.repeat(nota);
        var vazias = '☆'.repeat(5 - nota);
        return '<span class="feedback-admin-estrelas">' + cheias + vazias + '</span>';
    }

    function identidadeHtml(fb) {
        if (fb.anonimo || !fb.instagram_handle) {
            return '<span class="feedback-admin-anon">Anônimo</span>';
        }
        var link = 'https://instagram.com/' + encodeURIComponent(fb.instagram_handle);
        var repost = fb.autoriza_repost
            ? '<span class="payment-badge payment-pago">autorizou repost</span>'
            : '<span class="payment-badge payment-pendente">sem autorização de repost</span>';
        return '<a href="' + link + '" target="_blank" rel="noopener" class="feedback-admin-insta">@' +
            escapeHtml(fb.instagram_handle) + '</a> ' + repost;
    }

    function renderFeedbacks(lista) {
        if (!lista.length) {
            listEl.innerHTML = '<div class="vz-empty-state">Nenhum feedback' +
                (filtroAtual ? (' com status "' + STATUS_LABEL[filtroAtual] + '"') : '') + ' por aqui ainda.</div>';
            return;
        }
        listEl.innerHTML = '';
        lista.forEach(function (fb) {
            var card = document.createElement('div');
            card.className = 'pedido-card feedback-admin-card';
            var proximo = PROXIMO_STATUS[fb.status];
            card.innerHTML =
                '<div class="pedido-card-header">' +
                    '<div class="pedido-card-left">' +
                        '<p class="pedido-notas" style="font-style:normal; color:#ddd; font-size:0.88rem; white-space:pre-wrap;">' + escapeHtml(fb.mensagem) + '</p>' +
                        '<p style="margin-top:8px;">' + estrelasHtml(fb.nota) + '</p>' +
                        '<p style="margin-top:4px;">' + identidadeHtml(fb) + '</p>' +
                    '</div>' +
                    '<div class="pedido-card-right">' +
                        '<span class="status-chip status-' + fb.status + '">' + STATUS_LABEL[fb.status] + '</span>' +
                        '<p class="pedido-data">' + formatarData(fb.criado_em) + '</p>' +
                    '</div>' +
                '</div>' +
                (proximo ?
                    '<div class="pedido-card-actions">' +
                        '<button type="button" class="pedido-btn-avançar" data-acao="avancar" data-id="' + fb.id + '" data-proximo="' + proximo + '">' +
                            PROXIMO_LABEL[fb.status] +
                        '</button>' +
                        (fb.status !== 'arquivado' ? '<button type="button" class="pedido-btn-del" data-acao="arquivar" data-id="' + fb.id + '">Arquivar direto</button>' : '') +
                    '</div>'
                : '');
            listEl.appendChild(card);
        });
    }

    async function carregarFeedbacks() {
        listEl.innerHTML = '<div class="vz-empty-state">Carregando feedbacks...</div>';
        try {
            var url = '/api/feedback' + (filtroAtual ? ('?status=' + filtroAtual) : '');
            var res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error('Erro ao carregar.');
            var lista = await res.json();
            renderFeedbacks(lista);

            // Contagem de "novos" sempre reflete o total real, não a lista filtrada —
            // busca sem filtro só quando o filtro atual não é 'novo', pra economizar
            // uma chamada extra no caso comum de já estar olhando pros novos.
            if (filtroAtual === 'novo') {
                countEl.textContent = String(lista.length);
            } else {
                var resNovos = await fetch('/api/feedback?status=novo', { credentials: 'include' });
                var novos = resNovos.ok ? await resNovos.json() : [];
                countEl.textContent = String(novos.length);
            }
        } catch (e) {
            listEl.innerHTML = '<div class="vz-empty-state">Não foi possível carregar os feedbacks.</div>';
            mostrarToast('Erro ao carregar feedbacks.', true);
        }
    }

    async function atualizarStatus(id, novoStatus) {
        try {
            var res = await fetch('/api/feedback/' + id, {
                method: 'PUT', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: novoStatus })
            });
            if (!res.ok) throw new Error('Erro ao atualizar.');
            mostrarToast('Feedback atualizado.', false);
            carregarFeedbacks();
        } catch (e) {
            mostrarToast('Erro ao atualizar feedback.', true);
        }
    }

    if (chipsWrap) chipsWrap.addEventListener('click', function (e) {
        var chip = e.target.closest('.status-filter-chip');
        if (!chip) return;
        chipsWrap.querySelectorAll('.status-filter-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        filtroAtual = chip.getAttribute('data-status') || '';
        carregarFeedbacks();
    });

    listEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-acao]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        var acao = btn.getAttribute('data-acao');
        var novoStatus = acao === 'arquivar' ? 'arquivado' : btn.getAttribute('data-proximo');
        atualizarStatus(id, novoStatus);
    });

    carregarFeedbacks();
})();
