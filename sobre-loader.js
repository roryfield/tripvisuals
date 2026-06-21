// [VZ] sobre-loader.js — carrega conteúdo dinâmico do /api/config e ativa
// efeitos de scroll reveal na página Sobre.
(function () {
    'use strict';

    // ── DOM helpers ────────────────────────────────────────────
    function setText(id, val) {
        if (!val) return;
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }
    function setHref(id, val) {
        if (!val) return;
        var el = document.getElementById(id);
        if (el) el.href = val;
    }

    // ── Hydrate from /api/config ────────────────────────────────
    fetch('/api/config')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfg) {
            if (!cfg) return;

            // Hero
            if (cfg.landing_logo_url) {
                var logo = document.getElementById('sobreLogo');
                if (logo) logo.src = cfg.landing_logo_url;
            }
            setText('sobreManifesto', cfg.sobre_manifesto);
            setText('sobreHistoria',  cfg.sobre_historia);
            setText('sobreMissao',    cfg.sobre_missao);

            // Pilares
            setText('pilar1Titulo', cfg.sobre_pilar1_titulo);
            setText('pilar1Desc',   cfg.sobre_pilar1_desc);
            setText('pilar2Titulo', cfg.sobre_pilar2_titulo);
            setText('pilar2Desc',   cfg.sobre_pilar2_desc);
            setText('pilar3Titulo', cfg.sobre_pilar3_titulo);
            setText('pilar3Desc',   cfg.sobre_pilar3_desc);

            // WhatsApp CTA
            setHref('sobreWhatsapp', cfg.landing_whatsapp);
        })
        .catch(function () { /* conteúdo padrão estático permanece */ });

    // ── Scroll reveal via IntersectionObserver ─────────────────
    var els = document.querySelectorAll(
        '.sobre-pilares, .sobre-historia, .sobre-missao, .sobre-cta, .pilar-card'
    );
    if (typeof IntersectionObserver === 'undefined') {
        // Fallback: sem suporte → tudo visível
        els.forEach(function (el) { el.classList.add('revealed'); });
        return;
    }
    // Adiciona a classe de partida antes de observar
    els.forEach(function (el) { el.classList.add('reveal-on-scroll'); });

    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                // Delay escalonado para os cards dos pilares
                var el = entry.target;
                var delay = 0;
                if (el.classList.contains('pilar-card')) {
                    var cards = Array.from(document.querySelectorAll('.pilar-card'));
                    delay = cards.indexOf(el) * 120;
                }
                setTimeout(function () { el.classList.add('revealed'); }, delay);
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    els.forEach(function (el) { observer.observe(el); });
})();
