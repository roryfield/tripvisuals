// admin-guia-catalogador.js — fluxo real do guia contextual pro Catalogador IA
//
// Só ativa quando a aba Catalogador está de verdade em foco (ouve o mesmo
// evento 'vz-oficina-tab' que a Oficina já dispara ao trocar de aba).
// Reaproveita os contadores que o próprio Catalogador já mantém
// atualizados na tela — não faz nenhuma chamada de rede extra.
(function () {
    'use strict';

    function numeroDoTexto (el) {
        if (!el) return 0;
        var n = parseInt(el.textContent.trim(), 10);
        return isNaN(n) ? 0 : n;
    }

    function totalAtual () {
        var wrap = document.getElementById('statTotal');
        return wrap ? numeroDoTexto(wrap.querySelector('.cat-stat-n')) : 0;
    }

    function identificadosAtual () {
        return numeroDoTexto(document.getElementById('statDone'));
    }

    var PASSOS = [
        {
            seletor: '#dropzoneCatalogador',
            mensagem: 'Comece arrastando as fotos aqui, ou clique pra escolher do computador.',
            condicaoAvanco: function () { return totalAtual() > 0; },
        },
        {
            seletor: '#btnStart',
            mensagem: 'Agora clique aqui pra IA começar a identificar as bandas.',
            condicaoAvanco: function () { return identificadosAtual() > 0; },
        },
        {
            seletor: '#btnToggleResults',
            mensagem: 'Os resultados já estão prontos — clique aqui pra revisar e confirmar.',
            condicaoAvanco: function () {
                var btn = document.getElementById('btnToggleResults');
                return btn && btn.getAttribute('aria-expanded') === 'true';
            },
        },
    ];

    document.addEventListener('vz-oficina-tab', function (e) {
        if (!window.VZGuia) return;
        if (e.detail && e.detail.tab === 'catalogador') {
            window.VZGuia.iniciarFluxo('catalogador', PASSOS, { tempoInatividade: 8000 });
        } else {
            window.VZGuia.pararFluxo();
        }
    });

    // se a página já carregou direto na aba Catalogador (via ?tab=catalogador),
    // o evento de troca não dispara sozinho — checa uma vez ao carregar.
    if (window.VZGuia && new URLSearchParams(location.search).get('tab') === 'catalogador') {
        window.VZGuia.iniciarFluxo('catalogador', PASSOS, { tempoInatividade: 8000 });
    }
})();
