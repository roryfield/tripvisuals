// [VZ] admin-oficina-side — Fase 24, painel lateral do Catalogador IA.
//
// Espelha as últimas 5 identificações que já aparecem na tabela de
// resultados (#resultTbody, mantida por admin-catalogador.js) num log
// compacto no painel lateral. De propósito, não toca em admin-catalogador.js
// nem duplica nenhuma chamada de rede — só observa o DOM que já existe e
// já é a fonte de verdade da tela.
(function () {
    'use strict';

    const esc = s => String(s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const sh = name => name && name.length > 30 ? '…' + name.slice(-28) : (name || '');

    function render() {
        const alvo = document.getElementById('sideCatalogadorLog');
        if (!alvo) return; // painel não existe nesta tela — não deveria acontecer, mas não quebra nada
        const linhas = Array.from(document.querySelectorAll('#resultTbody tr')).slice(-5).reverse();

        if (!linhas.length) {
            alvo.innerHTML = '<p class="vz-side-log-vazio">Nenhuma ainda.</p>';
            return;
        }

        alvo.innerHTML = linhas.map(function (tr) {
            const arquivo = tr.dataset.file || '';
            const bandaInput = tr.querySelector('.cat-band-input');
            const banda = bandaInput ? bandaInput.value : '';
            return '<div class="vz-side-log-item">' +
                '<span class="vz-side-log-file" title="' + esc(arquivo) + '">' + esc(sh(arquivo)) + '</span>' +
                '<span class="vz-side-log-band">' + esc(banda || '—') + '</span>' +
                '</div>';
        }).join('');
    }

    function iniciar() {
        const wrap = document.getElementById('tableWrap');
        if (!wrap) return;
        render();
        // #resultTbody é recriado inteiro em todo refresh (buildTable faz
        // wrap.innerHTML = ...), então observa o container estável (#tableWrap)
        // com subtree, não o tbody em si.
        new MutationObserver(render).observe(wrap, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
