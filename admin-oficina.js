// [VZ] admin-oficina — coordenador de abas. Upload, Catalogador e Produtos
// continuam sendo três scripts independentes (admin-upload.js,
// admin-catalogador.js, admin-produtos.js), cada um sua própria IIFE, sem
// nenhuma variável vazando entre eles. Este arquivo só troca qual painel
// fica visível — não sabe nada sobre o que cada aba faz por dentro.
(function () {
    'use strict';

    var TABS = ['upload', 'catalogador', 'produtos'];

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    function irPara(tab) {
        if (TABS.indexOf(tab) === -1) tab = 'upload';
        TABS.forEach(function (t) {
            var painel = document.getElementById('tab' + cap(t));
            var botao  = document.getElementById('btnTab' + cap(t));
            var ativo  = t === tab;
            if (painel) painel.hidden = !ativo;
            if (botao) {
                botao.classList.toggle('active', ativo);
                botao.setAttribute('aria-selected', ativo ? 'true' : 'false');
            }
        });
        try { sessionStorage.setItem('vz-oficina-aba', tab); } catch (_) {}

        // [VZ] Fase 24 — bug real encontrado ao testar o guia contextual ao
        // vivo: o Catalogador escuta este evento pra saber quando entrar/sair
        // da própria aba, mas ninguém disparava. Guia contextual do Catalogador
        // só ligava via ?tab=catalogador na URL (redirect antigo); clicar na
        // aba manualmente, do jeito que qualquer pessoa realmente usa a tela,
        // nunca ativava o guia. Confirmado com evento real antes da correção.
        document.dispatchEvent(new CustomEvent('vz-oficina-tab', { detail: { tab: tab } }));
    }

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-oficina-tab]');
        if (!btn) return;
        irPara(btn.dataset.oficinaTab);
    });

    // Prioridade: ?tab= na URL (usado pelos redirects de admin.html,
    // admin-catalogador.html e admin-produtos.html) > última aba usada
    // nesta sessão > padrão (Upload).
    var params      = new URLSearchParams(window.location.search);
    var tabDaUrl     = params.get('tab');
    var tabInicial   = TABS.indexOf(tabDaUrl) !== -1 ? tabDaUrl : null;
    if (!tabInicial) {
        try { tabInicial = sessionStorage.getItem('vz-oficina-aba'); } catch (_) {}
    }
    irPara(tabInicial || 'upload');

    // Hook global — permite outro script (admin-upload.js, por exemplo)
    // trocar de aba sem precisar saber como esse coordenador funciona por dentro.
    window.vzOficinaIrPara = irPara;
})();
