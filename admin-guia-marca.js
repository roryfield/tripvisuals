// admin-guia-marca.js — fluxo real do guia contextual pra Marca & Vitrine
//
// Página dedicada (não tabs fundidas como a Oficina), então inicia direto
// no carregamento, sem precisar ouvir evento de troca de aba.
(function () {
    'use strict';

    var slugInicial = null; // capturado no primeiro tick, comparado depois

    var PASSOS = [
        {
            seletor: '#themesGrid .vz-card[aria-checked="true"]',
            mensagem: 'Experimenta clicar num estilo diferente pra ver a mudança.',
            condicaoAvanco: function () {
                var atual = document.querySelector('#themesGrid .vz-card[aria-checked="true"]');
                var slugAtual = atual ? atual.dataset.slug : null;
                if (slugInicial === null) { slugInicial = slugAtual; return false; }
                return !!slugAtual && slugAtual !== slugInicial;
            },
        },
        {
            seletor: '#catalogoPreviewPanel summary',
            mensagem: 'Clique aqui pra ver como o catálogo fica de verdade, sem sair da tela.',
            condicaoAvanco: function () {
                var painel = document.getElementById('catalogoPreviewPanel');
                return !!painel && painel.open === true;
            },
        },
    ];

    function iniciar () {
        if (!window.VZGuia) return;
        // espera o grid de temas existir de verdade antes de começar —
        // ele é montado de forma assíncrona pelo admin-landing.js
        var tentativas = 0;
        var esperar = setInterval(function () {
            tentativas++;
            var pronto = document.querySelector('#themesGrid .vz-card');
            if (pronto || tentativas > 20) {
                clearInterval(esperar);
                if (pronto) {
                    var forcar = new URLSearchParams(location.search).get('vzguia') === 'relembrar';
                    window.VZGuia.iniciarFluxo('marca-vitrine', PASSOS, { tempoInatividade: 8000, forcar: forcar });
                }
            }
        }, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
