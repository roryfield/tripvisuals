// admin-guia.js — motor de guia contextual, reutilizável em qualquer fluxo
//
// Inspirado no padrão do MTG Arena: quando o usuário fica parado depois de
// começar um processo, um balão de dica aparece perto do elemento certo,
// com um destaque sutil (não bloqueia a tela, não impede outras ações —
// só aponta o caminho). Quando a ação certa acontece, uma confirmação
// rápida aparece e o guia avança pro próximo passo sozinho.
//
// Uso básico:
//   VZGuia.iniciarFluxo('catalogador-primeira-vez', [
//     { seletor: '#dropzoneCatalogador', mensagem: 'Comece arrastando ou clicando aqui.',
//       condicaoAvanco: function () { return statsAtuais().total > 0; } },
//     { seletor: '#btnStart', mensagem: 'Agora clique aqui pra IA começar a identificar.',
//       condicaoAvanco: function () { return statsAtuais().done > 0; } },
//   ], { tempoInatividade: 8000, poll: 1000 });
//
(function () {
    'use strict';

    var TEMPO_PADRAO_INATIVIDADE = 8000; // 8s parado = mostra a dica
    var POLL_PADRAO = 1000;

    var estado = null; // fluxo ativo, ou null se nenhum

    function agora () { return Date.now(); }

    // ── Memória por navegador (Fase 24) ─────────────────────────────
    // Uma vez que a pessoa termina um fluxo até o fim, ele não deve mais
    // disparar sozinho por inatividade nas próximas visitas àquela tela
    // — só se ela pedir explicitamente via VZGuia.iniciarFluxo(nome, passos,
    // { forcar: true }) (usado pelo índice de "relembrar fluxo").
    function chaveVisto (nome) { return 'vz-guia-visto-' + nome; }

    function jaVisto (nome) {
        try { return localStorage.getItem(chaveVisto(nome)) === '1'; }
        catch (_) { return false; } // localStorage indisponível (modo privado etc.) — trata como não visto
    }

    function marcarComoVisto (nome) {
        try { localStorage.setItem(chaveVisto(nome), '1'); } catch (_) { /* sem persistência, sem problema */ }
    }

    function limparEstadoVisual () {
        var existente = document.getElementById('vzGuiaBalao');
        if (existente) existente.remove();
        document.querySelectorAll('.vz-guia-destaque').forEach(function (el) {
            el.classList.remove('vz-guia-destaque');
        });
    }

    function mostrarDica (passo) {
        limparEstadoVisual();
        var alvo = document.querySelector(passo.seletor);
        if (!alvo) return; // elemento não existe nesta tela agora — silencioso, não quebra nada

        alvo.classList.add('vz-guia-destaque');

        var balao = document.createElement('div');
        balao.id = 'vzGuiaBalao';
        balao.className = 'vz-guia-balao';
        balao.innerHTML =
            '<span class="vz-guia-balao-texto">' + passo.mensagem + '</span>' +
            '<button type="button" class="vz-guia-balao-fechar" aria-label="Dispensar dica">\u2715</button>';
        document.body.appendChild(balao);

        var rect = alvo.getBoundingClientRect();
        var top = rect.top + window.scrollY - balao.offsetHeight - 14;
        var left = rect.left + window.scrollX;
        // se não coube em cima (perto do topo da tela), mostra embaixo do elemento
        if (top < window.scrollY + 8) top = rect.bottom + window.scrollY + 14;
        // não deixa vazar pra fora da tela na direita
        var maxLeft = window.scrollX + document.documentElement.clientWidth - balao.offsetWidth - 16;
        if (left > maxLeft) left = Math.max(16, maxLeft);

        balao.style.top = top + 'px';
        balao.style.left = left + 'px';

        balao.querySelector('.vz-guia-balao-fechar').addEventListener('click', function () {
            limparEstadoVisual();
            if (estado) estado.dispensadoNestePasso = true;
        });
    }

    function mostrarConfirmacaoPositiva (alvoSeletor) {
        var alvo = document.querySelector(alvoSeletor);
        if (!alvo) return;
        var check = document.createElement('div');
        check.className = 'vz-guia-check';
        check.textContent = '\u2713';
        var rect = alvo.getBoundingClientRect();
        check.style.top = (rect.top + window.scrollY + rect.height / 2) + 'px';
        check.style.left = (rect.right + window.scrollX + 10) + 'px';
        document.body.appendChild(check);
        setTimeout(function () { check.remove(); }, 1200);
    }

    function tick () {
        if (!estado) return;
        var passo = estado.passos[estado.indice];
        if (!passo) { pararFluxo(); return; }

        if (passo.condicaoAvanco && passo.condicaoAvanco()) {
            limparEstadoVisual();
            mostrarConfirmacaoPositiva(passo.seletor);
            estado.indice++;
            estado.ultimaAcao = agora();
            estado.dispensadoNestePasso = false;
            if (estado.indice >= estado.passos.length) {
                // Fluxo completo do início ao fim — só isso conta como "já visto".
                // Sair da tela no meio, trocar de aba, etc. (que também chamam
                // pararFluxo por fora) não marca nada, o fluxo continua elegível
                // pra disparar sozinho na próxima vez.
                marcarComoVisto(estado.nome);
                pararFluxo();
                return;
            }
        }

        if (!estado.dispensadoNestePasso && (agora() - estado.ultimaAcao) >= estado.tempoInatividade) {
            mostrarDica(estado.passos[estado.indice]);
        }
    }

    function iniciarFluxo (nome, passos, opcoes) {
        opcoes = opcoes || {};
        // Já visto nesta tela, neste navegador, e ninguém pediu explicitamente
        // pra ver de novo (forcar: true) — não inicia, silencioso.
        if (!opcoes.forcar && jaVisto(nome)) return;
        pararFluxo();
        estado = {
            nome: nome,
            passos: passos,
            indice: 0,
            ultimaAcao: agora(),
            tempoInatividade: opcoes.tempoInatividade || TEMPO_PADRAO_INATIVIDADE,
            dispensadoNestePasso: false,
            intervalo: setInterval(tick, opcoes.poll || POLL_PADRAO),
        };
        // qualquer clique real do usuário reseta o relógio de inatividade —
        // se ela está mexendo na tela, não precisa de dica ainda
        document.addEventListener('click', resetarInatividade, true);
    }

    function resetarInatividade () {
        if (estado) { estado.ultimaAcao = agora(); estado.dispensadoNestePasso = false; }
    }

    function pararFluxo () {
        if (estado && estado.intervalo) clearInterval(estado.intervalo);
        document.removeEventListener('click', resetarInatividade, true);
        limparEstadoVisual();
        estado = null;
    }

    window.VZGuia = { iniciarFluxo: iniciarFluxo, pararFluxo: pararFluxo, jaVisto: jaVisto };
})();
