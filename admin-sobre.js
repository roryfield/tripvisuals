// [VZ] admin-sobre.js — gestão da página Sobre
(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    // ── Toast ────────────────────────────────────────────────────
    function showToast(msg, isError) {
        const t = $('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast' + (isError ? ' toast-error' : ' toast-success') + ' show';
        clearTimeout(t._to);
        t._to = setTimeout(() => { t.classList.remove('show'); }, 3000);
    }

    // ── API helpers ──────────────────────────────────────────────
    async function saveConfig(chave, valor) {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chave, valor })
        });
        if (res.status === 401) { window.location.href = '/login.html'; throw new Error('auth'); }
        if (!res.ok) throw new Error('server');
    }

    // ── Load existing values ─────────────────────────────────────
    async function loadConfig() {
        try {
            const r = await fetch('/api/config');
            if (!r.ok) return;
            const cfg = await r.json();

            const fill = (id, key) => {
                const el = $(id);
                if (el && cfg[key] !== undefined) el.value = cfg[key];
            };

            fill('cf-sobre-manifesto', 'sobre_manifesto');
            fill('cf-sobre-historia',  'sobre_historia');
            fill('cf-sobre-missao',    'sobre_missao');
            fill('cf-pilar1-titulo',   'sobre_pilar1_titulo');
            fill('cf-pilar1-desc',     'sobre_pilar1_desc');
            fill('cf-pilar2-titulo',   'sobre_pilar2_titulo');
            fill('cf-pilar2-desc',     'sobre_pilar2_desc');
            fill('cf-pilar3-titulo',   'sobre_pilar3_titulo');
            fill('cf-pilar3-desc',     'sobre_pilar3_desc');
        } catch (_) { /* silent */ }
    }

    // ── Auto-save on blur for all [data-key] fields ──────────────
    function bindFields() {
        document.querySelectorAll('[data-key]').forEach(input => {
            const key = input.dataset.key;
            if (!key) return;
            const statusEl = $('st-' + input.id);
            let lastSaved = input.value;

            const doSave = async () => {
                const val = input.value.trim();
                if (val === lastSaved) return;
                if (statusEl) {
                    statusEl.textContent = 'salvando…';
                    statusEl.className = 'field-status show saving';
                }
                try {
                    await saveConfig(key, val);
                    lastSaved = val;
                    if (statusEl) {
                        statusEl.textContent = '✓ salvo';
                        statusEl.className = 'field-status show success';
                        setTimeout(() => statusEl.classList.remove('show'), 1500);
                    }
                } catch (e) {
                    if (e.message === 'auth') return;
                    if (statusEl) {
                        statusEl.textContent = '✗ erro';
                        statusEl.className = 'field-status show error';
                    }
                    showToast('Erro ao salvar', true);
                }
            };

            input.addEventListener('blur', doSave);
            // Enter em single-line confirma
            if (input.tagName !== 'TEXTAREA') {
                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                });
            }
        });
    }

    // ── Logout ───────────────────────────────────────────────────
    const btnLogout = $('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
            } finally {
                window.location.href = '/login.html';
            }
        });
    }

    // ── Init ─────────────────────────────────────────────────────
    loadConfig().then(() => {
        bindFields();
    });

})();
