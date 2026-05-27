// [VZ] admin-help — extracted from admin-help.html
(function () {
    'use strict';

const links    = document.querySelectorAll('.help-sidenav a');
    const sections = Array.from(links).map(a => document.querySelector(a.getAttribute('href')));

    function activeSection() {
        const y = window.scrollY + 100;
        let current = sections[0];
        for (const sec of sections) {
            if (sec && sec.offsetTop <= y) current = sec;
        }
        return current ? current.id : sections[0].id;
    }
    let lastId = null;
    function syncNav() {
        const id = activeSection();
        if (id === lastId) return;
        lastId = id;
        links.forEach(a => a.classList.toggle('current', a.getAttribute('href') === '#' + id));
    }
    window.addEventListener('scroll', syncNav, { passive: true });
    syncNav();

    links.forEach(a => {
        a.addEventListener('click', e => {
            const target = document.querySelector(a.getAttribute('href'));
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', a.getAttribute('href'));
        });
    });
})();