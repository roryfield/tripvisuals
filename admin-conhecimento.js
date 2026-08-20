(function () {
    'use strict';
    var home = document.getElementById('kbHome');
    var artigosWrap = document.getElementById('kbArtigos');
    var todosArtigos = Array.prototype.slice.call(document.querySelectorAll('.kb-artigo'));

    function mostrarArtigo(id) {
        var alvo = document.getElementById('artigo-' + id);
        if (!alvo) return false;
        home.hidden = true;
        todosArtigos.forEach(function (a) { a.hidden = true; });
        alvo.hidden = false;
        window.scrollTo(0, 0);
        return true;
    }

    function mostrarHome() {
        todosArtigos.forEach(function (a) { a.hidden = true; });
        home.hidden = false;
        window.scrollTo(0, 0);
    }

    function tratarHash() {
        var id = location.hash.replace('#', '');
        if (id && mostrarArtigo(id)) return;
        mostrarHome();
    }

    window.addEventListener('hashchange', tratarHash);
    tratarHash();

    artigosWrap.addEventListener('click', function (e) {
        var voltar = e.target.closest('[data-voltar]');
        if (voltar) {
            e.preventDefault();
            location.hash = '';
        }
    });

    // ── Busca — filtra os cards visíveis, esconde categoria inteira se vazia ──
    var busca = document.getElementById('kbSearch');
    var semResultado = document.getElementById('kbSemResultado');
    busca.addEventListener('input', function () {
        var termo = busca.value.trim().toLowerCase();
        var totalVisivel = 0;
        document.querySelectorAll('.kb-categoria').forEach(function (cat) {
            var algumVisivelNaCategoria = false;
            cat.querySelectorAll('.kb-card').forEach(function (card) {
                var bate = !termo ||
                    card.dataset.titulo.indexOf(termo) !== -1 ||
                    card.dataset.resumo.indexOf(termo) !== -1;
                card.hidden = !bate;
                if (bate) { algumVisivelNaCategoria = true; totalVisivel++; }
            });
            cat.hidden = !algumVisivelNaCategoria;
        });
        semResultado.hidden = totalVisivel > 0;
    });
})();
