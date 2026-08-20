// admin-guia-pedidos.js — fluxo real do guia contextual pra Pedidos
(function () {
    'use strict';

    var totalInicial = null;

    var PASSOS = [
        {
            seletor: '#btnNovoPedido',
            mensagem: 'Clique aqui pra registrar uma venda manualmente, ou use "Novo via comprovante" se já tiver o PIX em mãos.',
            condicaoAvanco: function () {
                var total = document.querySelectorAll('#pedidosList .pedido-card').length;
                if (totalInicial === null) { totalInicial = total; return false; }
                return total > totalInicial;
            },
        },
        {
            seletor: '#freteConfigPanel summary',
            mensagem: 'Sem regiões configuradas, o frete não calcula sozinho no catálogo. Vale configurar pelo menos as UFs onde você mais vende.',
            condicaoAvanco: function () {
                var painel = document.getElementById('freteConfigPanel');
                return !!painel && painel.open === true;
            },
        },
    ];

    function iniciar () {
        if (!window.VZGuia) return;
        // o passo de frete só faz sentido se ainda não existe região
        // configurada — checa isso antes de decidir incluir o passo 2
        var lista = document.getElementById('freteConfigLista');
        var passosFinal = PASSOS;
        if (lista && lista.children.length > 0) {
            passosFinal = [PASSOS[0]]; // já tem frete configurado, pula o passo 2
        }
        window.VZGuia.iniciarFluxo('pedidos', passosFinal, { tempoInatividade: 8000 });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            // freteConfigLista é populado de forma assíncrona — dá uma
            // folga antes de checar, senão sempre pareceria vazio
            setTimeout(iniciar, 800);
        });
    } else {
        setTimeout(iniciar, 800);
    }
})();
