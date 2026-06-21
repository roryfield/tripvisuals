// [VZ] admin-landing — extracted from admin-landing.html
(function () {
    'use strict';

// ═════════════════════════ HELPERS ═══════════════════════════
    const $ = id => document.getElementById(id);
    const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
    const escapeAttr = escapeHTML;

    function showToast(msg, isError = false) {
        const t = $('toast');
        t.innerText = msg;
        t.style.background  = isError ? 'rgba(255,77,77,0.12)' : 'rgba(0,229,255,0.12)';
        t.style.borderColor = isError ? 'rgba(255,77,77,0.3)'  : 'rgba(0,229,255,0.3)';
        t.style.color       = isError ? 'var(--danger)'       : 'var(--cyan)';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    async function saveConfig(chave, valor) {
        const res = await fetch('/api/config', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chave, valor })
        });
        if (res.status === 401) { window.location.replace('/login.html'); throw new Error('auth'); }
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Erro ao salvar');
        }
        return res.json();
    }

    // ═════════════════════════ REGISTRIES ═══════════════════════
    // Add a theme: drop landing-<slug>.html in the repo + one entry below.
    // Add a preset: drop /defaults/<file> + one entry below.
    const THEMES = [
        { slug: 'classico', name: 'Clássico', description: 'Original com botões neon.' },
        { slug: 'retro',    name: 'Retro',    description: 'Psicodélico, CRT, anos 70.' }
    ];
    const PRESET_LOGOS = [
        { url: '/defaults/logo-estatica-escura.jpeg', name: 'Logo 1' },
        { url: '/defaults/logo-estatica-clara.jpeg',  name: 'Logo 2' },
        { url: '/defaults/logo-drippy.jpeg',          name: 'Logo 3' },
        { url: '/defaults/logo-adesivo.jpeg',         name: 'Logo 4' }
    ];

    // ═════════════════════════ STATE ═════════════════════════════
    let currentTheme   = 'classico';
    let currentLogoUrl = '';
    let currentBgColor = '';
    let currentBgImage = '';
    let pendingLogo    = null;
    let pendingBg      = null;

    // ═════════════════════════ THEMES ════════════════════════════
    const themesGrid  = $('themesGrid');
    const themeStatus = $('themeStatus');

    function renderThemes() {
        themesGrid.innerHTML = '';
        THEMES.forEach(t => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'vz-card theme' + (t.slug === currentTheme ? ' active' : '');
            card.setAttribute('role', 'radio');
            card.setAttribute('aria-checked', t.slug === currentTheme ? 'true' : 'false');
            card.tabIndex = t.slug === currentTheme ? 0 : -1;
            card.dataset.slug = t.slug;
            card.innerHTML = `
                <div class="theme-thumb theme-thumb-${escapeAttr(t.slug)}" aria-hidden="true"></div>
                <div class="theme-body">
                    <div>
                        <div class="theme-name">${escapeHTML(t.name)}</div>
                        <div class="section-hint">${escapeHTML(t.description)}</div>
                    </div>
                    <span class="theme-active-tag" aria-hidden="true">Ativo</span>
                </div>
            `;
            themesGrid.appendChild(card);
        });
        themesGrid.querySelectorAll('.vz-card').forEach(card => {
            card.addEventListener('click', () => selectTheme(card.dataset.slug));
            card.addEventListener('keydown', e => handleRadioKeys(e, themesGrid, slug => selectTheme(slug), 'slug'));
        });
    }

    async function selectTheme(slug) {
        if (slug === currentTheme) return;
        const previous = currentTheme;
        currentTheme = slug;
        renderThemes();
        themeStatus.innerText = 'Salvando…';
        themeStatus.className = 'save-status';
        try {
            await saveConfig('landing_theme', slug);
            themeStatus.innerText = `✓ Estilo "${slug}" ativo. Atualize a aba "Ver ao vivo" pra conferir.`;
            themeStatus.className = 'save-status success';
            showToast('✓ Estilo atualizado');
        } catch (e) {
            if (e.message === 'auth') return;
            currentTheme = previous;
            renderThemes();
            themeStatus.innerText = '❌ Falha ao salvar.';
            themeStatus.className = 'save-status error';
        }
    }

    // ═════════════════════════ ARSENAL (presets) ═════════════════
    const presetsGrid = $('presetsGrid');

    function renderPresets() {
        presetsGrid.innerHTML = '';
        PRESET_LOGOS.forEach((p, idx) => {
            const card = document.createElement('button');
            card.type = 'button';
            const active = p.url === currentLogoUrl;
            card.className = 'vz-card preset' + (active ? ' active' : '');
            card.setAttribute('role', 'radio');
            card.setAttribute('aria-checked', active ? 'true' : 'false');
            card.tabIndex = (active || (!currentLogoUrl && idx === 0)) ? 0 : -1;
            card.dataset.url = p.url;
            card.innerHTML = `
                <div class="preset-thumb"><img src="${escapeAttr(p.url)}" alt="" loading="lazy"></div>
                <span class="preset-label">${escapeHTML(p.name)}</span>
            `;
            presetsGrid.appendChild(card);
        });
        presetsGrid.querySelectorAll('.vz-card').forEach(card => {
            card.addEventListener('click', () => selectPreset(card.dataset.url));
            card.addEventListener('keydown', e => handleRadioKeys(e, presetsGrid, url => selectPreset(url), 'url'));
        });
    }

    async function selectPreset(url) {
        const previous = currentLogoUrl;
        currentLogoUrl = url;
        renderPresets();
        renderLogoPreview(url);
        updateRevertButton();
        try {
            await saveConfig('landing_logo_url', url);
            showToast('✓ Logo trocada');
        } catch (e) {
            if (e.message === 'auth') return;
            currentLogoUrl = previous;
            renderPresets();
            renderLogoPreview(previous);
            updateRevertButton();
            showToast('Erro ao trocar logo', true);
        }
    }

    // ═════════════════════════ LOGO (custom upload) ══════════════
    const logoUploadArea = $('logoUploadArea');
    const logoPreview    = $('logoPreview');
    const logoFile       = $('logoFile');
    const btnUploadLogo  = $('btnUploadLogo');
    const btnRevertLogo  = $('btnRevertLogo');
    const logoFilename   = $('logoFilename');
    const logoStatus     = $('logoStatus');

    function renderLogoPreview(src) {
        logoPreview.innerHTML = src
            ? `<img src="${escapeAttr(src)}" alt="Logo atual">`
            : '<img src="/logo.jpeg" alt="Logo padrão do repositório">';
    }
    function updateRevertButton() { btnRevertLogo.disabled = !currentLogoUrl; }

    setupUploadZone({
        area: logoUploadArea, input: logoFile,
        onSelect: file => {
            pendingLogo = file;
            logoFilename.innerText = file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)';
            btnUploadLogo.disabled = false;
            logoStatus.innerText = '';
            previewLocal(file, src => renderLogoPreview(src));
        },
        onError: msg => { logoStatus.innerText = msg; logoStatus.className = 'save-status error'; }
    });

    btnUploadLogo.addEventListener('click', async () => {
        if (!pendingLogo) return;
        btnUploadLogo.disabled = true;
        btnUploadLogo.innerText = 'Enviando…';
        try {
            const fd = new FormData(); fd.append('imagem', pendingLogo);
            const res = await fetch('/api/landing/logo', { method: 'POST', credentials: 'include', body: fd });
            if (res.status === 401) { window.location.replace('/login.html'); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            currentLogoUrl = data.url;
            renderLogoPreview(currentLogoUrl);
            renderPresets();
            updateRevertButton();
            logoStatus.innerText = '✓ Logo personalizada ativa.';
            logoStatus.className = 'save-status success';
            showToast('✓ Logo enviada');
            pendingLogo = null;
            logoFile.value = '';
            logoFilename.innerText = '';
        } catch (e) {
            logoStatus.innerText = '❌ ' + e.message;
            logoStatus.className = 'save-status error';
            showToast('Erro ao enviar logo', true);
        } finally {
            btnUploadLogo.innerText = 'Enviar';
            btnUploadLogo.disabled = !pendingLogo;
        }
    });

    btnRevertLogo.addEventListener('click', async () => {
        if (!currentLogoUrl) return;
        if (!confirm('Reverter para a logo padrão do repositório (/logo.jpeg)?')) return;
        btnRevertLogo.disabled = true;
        try {
            await saveConfig('landing_logo_url', '');
            currentLogoUrl = '';
            renderLogoPreview('');
            renderPresets();
            updateRevertButton();
            logoStatus.innerText = '✓ Revertido para o padrão.';
            logoStatus.className = 'save-status success';
            showToast('✓ Revertido');
        } catch {
            updateRevertButton();
            showToast('Erro ao reverter', true);
        }
    });

    // ═════════════════════════ AMBIENTE (background) ═════════════
    const bgUploadArea   = $('bgUploadArea');
    const bgPreview      = $('bgPreview');
    const bgFile         = $('bgFile');
    const btnUploadBg    = $('btnUploadBg');
    const btnClearBgImage= $('btnClearBgImage');
    const bgFilename     = $('bgFilename');
    const bgStatus       = $('bgStatus');
    const stBgColor      = $('st-bg-color');
    const stBgPos        = $('st-bg-position');
    const btnClearBgColor= $('btnClearBgColor');

    function renderBgPreview(src) {
        bgPreview.innerHTML = src
            ? `<img src="${escapeAttr(src)}" alt="Imagem de fundo atual">`
            : '<span class="placeholder">SEM IMAGEM</span>';
    }

    function flashColorStatus(state) {
        stBgColor.textContent = state === 'saving' ? 'salvando…'
                              : state === 'success' ? '✓ salvo'
                              : state === 'error'   ? '✗ erro' : '';
        stBgColor.className = 'field-status ' + (state ? 'show ' + state : '');
        if (state === 'success') setTimeout(() => stBgColor.classList.remove('show'), 1500);
    }

    // ═════════════════════════ FIGMA-STYLE COLOR PICKER ══════════
    // HSV-based picker: 2D area = saturation × value, slider = hue.
    // Hex round-trips through HSV so the cursor + thumb always reflect the
    // current value. Save is debounced (400ms after last change).
    const cp = {
        root:   $('vzColorPicker'),
        trigger:$('cpTrigger'),
        panel:  $('cpPanel'),
        swatch: $('cpSwatch'),
        hexLab: $('cpHexLabel'),
        area:   $('cpArea'),
        cursor: $('cpAreaCursor'),
        hue:    $('cpHue'),
        thumb:  $('cpHueThumb'),
        hexIn:  $('cpHexInput'),
        eyed:   $('cpEyedropper'),
        h: 0, s: 0, v: 3, // initial = near-black #050505
        open: false,
        saveTimer: null
    };

    // ---- color math ----
    function hsvToRgb(h, s, v) {
        // h in [0,360), s+v in [0,100]
        s /= 100; v /= 100;
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        let r = 0, g = 0, b = 0;
        if (h <  60) { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else              { r = c; g = 0; b = x; }
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }
    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    function hexToRgb(hex) {
        const m = /^#?([a-f0-9]{6})$/i.exec(hex.trim());
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if      (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else                h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        const s = max === 0 ? 0 : (d / max) * 100;
        const v = max * 100;
        return [h, s, v];
    }

    function cpCurrentHex() {
        const [r, g, b] = hsvToRgb(cp.h, cp.s, cp.v);
        return rgbToHex(r, g, b);
    }

    function cpRender() {
        // Area background = current hue at full S+V; cursor at (S, 100-V)
        const [hr, hg, hb] = hsvToRgb(cp.h, 100, 100);
        cp.area.style.setProperty('--hue', `rgb(${hr}, ${hg}, ${hb})`);
        cp.cursor.style.left = cp.s + '%';
        cp.cursor.style.top  = (100 - cp.v) + '%';
        cp.thumb.style.left  = (cp.h / 360 * 100) + '%';
        const hex = cpCurrentHex();
        cp.swatch.style.background = hex;
        cp.hexLab.textContent = hex;
        if (document.activeElement !== cp.hexIn) cp.hexIn.value = hex;
        cp.cursor.style.background = hex;
        cp.area.setAttribute('aria-valuenow', Math.round(cp.s));
        cp.hue.setAttribute('aria-valuenow', Math.round(cp.h));
    }

    function cpSetFromHex(hex, persist = true) {
        const rgb = hexToRgb(hex);
        if (!rgb) return false;
        const [h, s, v] = rgbToHsv(...rgb);
        cp.h = h; cp.s = s; cp.v = v;
        cpRender();
        if (persist) cpScheduleSave();
        return true;
    }

    function cpScheduleSave() {
        clearTimeout(cp.saveTimer);
        flashColorStatus('saving');
        cp.saveTimer = setTimeout(async () => {
            try {
                const hex = cpCurrentHex();
                await saveConfig('landing_bg_color', hex);
                currentBgColor = hex;
                flashColorStatus('success');
            } catch (e) {
                if (e.message === 'auth') return;
                flashColorStatus('error');
            }
        }, 400);
    }

    // ---- open/close panel ----
    function cpOpen() {
        cp.panel.hidden = false;
        cp.open = true;
        cp.trigger.setAttribute('aria-expanded', 'true');
    }
    function cpClose() {
        cp.panel.hidden = true;
        cp.open = false;
        cp.trigger.setAttribute('aria-expanded', 'false');
    }
    cp.trigger.addEventListener('click', e => {
        e.stopPropagation();
        cp.open ? cpClose() : cpOpen();
    });
    document.addEventListener('click', e => {
        if (cp.open && !cp.root.contains(e.target)) cpClose();
    });
    document.addEventListener('keydown', e => {
        if (cp.open && e.key === 'Escape') { cpClose(); cp.trigger.focus(); }
    });

    // ---- 2D area drag (saturation × value) ----
    function cpAreaUpdate(clientX, clientY) {
        const r = cp.area.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        const y = Math.max(0, Math.min(1, (clientY - r.top)  / r.height));
        cp.s = x * 100;
        cp.v = (1 - y) * 100;
        cpRender();
        cpScheduleSave();
    }
    function cpAreaPointerDown(e) {
        e.preventDefault();
        cpAreaUpdate(e.clientX, e.clientY);
        const move = ev => cpAreaUpdate(ev.clientX, ev.clientY);
        const up   = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }
    cp.area.addEventListener('pointerdown', cpAreaPointerDown);
    cp.area.addEventListener('keydown', e => {
        let changed = false;
        if (e.key === 'ArrowLeft')  { cp.s = Math.max(0, cp.s - 2); changed = true; }
        if (e.key === 'ArrowRight') { cp.s = Math.min(100, cp.s + 2); changed = true; }
        if (e.key === 'ArrowDown')  { cp.v = Math.max(0, cp.v - 2); changed = true; }
        if (e.key === 'ArrowUp')    { cp.v = Math.min(100, cp.v + 2); changed = true; }
        if (changed) { e.preventDefault(); cpRender(); cpScheduleSave(); }
    });

    // ---- Hue slider ----
    function cpHueUpdate(clientX) {
        const r = cp.hue.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        cp.h = x * 360;
        cpRender();
        cpScheduleSave();
    }
    cp.hue.addEventListener('pointerdown', e => {
        e.preventDefault();
        cpHueUpdate(e.clientX);
        const move = ev => cpHueUpdate(ev.clientX);
        const up   = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
    cp.hue.addEventListener('keydown', e => {
        let changed = false;
        if (e.key === 'ArrowLeft')  { cp.h = (cp.h - 5 + 360) % 360; changed = true; }
        if (e.key === 'ArrowRight') { cp.h = (cp.h + 5) % 360; changed = true; }
        if (changed) { e.preventDefault(); cpRender(); cpScheduleSave(); }
    });

    // ---- Hex input ----
    cp.hexIn.addEventListener('input', e => {
        let v = e.target.value.trim();
        if (!v.startsWith('#')) v = '#' + v;
        if (/^#[0-9a-fA-F]{6}$/.test(v)) cpSetFromHex(v);
    });
    cp.hexIn.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });

    // ---- Eyedropper (Chromium-only API; gracefully hidden elsewhere) ----
    if (window.EyeDropper) {
        cp.eyed.addEventListener('click', async () => {
            try {
                const ed = new window.EyeDropper();
                const r = await ed.open();
                if (r && r.sRGBHex) cpSetFromHex(r.sRGBHex);
            } catch (_) { /* user canceled */ }
        });
    } else {
        cp.eyed.style.display = 'none';
    }

    // ---- Clear button ----
    btnClearBgColor.addEventListener('click', async () => {
        flashColorStatus('saving');
        try {
            await saveConfig('landing_bg_color', '');
            currentBgColor = '';
            // Visually reset to default
            cpSetFromHex('#050505', false);
            flashColorStatus('success');
            showToast('✓ Cor limpa');
        } catch {
            flashColorStatus('error');
        }
    });

    // ═════════════════════════ BG POSITION (radio) ═══════════════
    function flashPosStatus(state) {
        stBgPos.textContent = state === 'saving' ? 'salvando…'
                            : state === 'success' ? '✓ salvo'
                            : state === 'error'   ? '✗ erro' : '';
        stBgPos.className = 'field-status ' + (state ? 'show ' + state : '');
        if (state === 'success') setTimeout(() => stBgPos.classList.remove('show'), 1500);
    }
    document.querySelectorAll('input[name="bgPosition"]').forEach(r => {
        r.addEventListener('change', async () => {
            if (!r.checked) return;
            flashPosStatus('saving');
            try {
                await saveConfig('landing_bg_position', r.value);
                flashPosStatus('success');
            } catch (e) {
                if (e.message === 'auth') return;
                flashPosStatus('error');
            }
        });
    });

    setupUploadZone({
        area: bgUploadArea, input: bgFile,
        onSelect: file => {
            pendingBg = file;
            bgFilename.innerText = file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)';
            btnUploadBg.disabled = false;
            bgStatus.innerText = '';
            previewLocal(file, src => renderBgPreview(src));
        },
        onError: msg => { bgStatus.innerText = msg; bgStatus.className = 'save-status error'; }
    });

    btnUploadBg.addEventListener('click', async () => {
        if (!pendingBg) return;
        btnUploadBg.disabled = true;
        btnUploadBg.innerText = 'Enviando…';
        try {
            const fd = new FormData(); fd.append('imagem', pendingBg);
            const res = await fetch('/api/landing/bg', { method: 'POST', credentials: 'include', body: fd });
            if (res.status === 401) { window.location.replace('/login.html'); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            currentBgImage = data.url;
            renderBgPreview(currentBgImage);
            bgStatus.innerText = '✓ Imagem de fundo ativa.';
            bgStatus.className = 'save-status success';
            showToast('✓ Fundo enviado');
            pendingBg = null;
            bgFile.value = '';
            bgFilename.innerText = '';
        } catch (e) {
            bgStatus.innerText = '❌ ' + e.message;
            bgStatus.className = 'save-status error';
            showToast('Erro ao enviar fundo', true);
        } finally {
            btnUploadBg.innerText = 'Enviar';
            btnUploadBg.disabled = !pendingBg;
        }
    });

    btnClearBgImage.addEventListener('click', async () => {
        if (!currentBgImage && !pendingBg) return;
        if (currentBgImage && !confirm('Remover a imagem de fundo da landing?')) return;
        try {
            await saveConfig('landing_bg_image_url', '');
            currentBgImage = '';
            renderBgPreview('');
            bgStatus.innerText = '✓ Imagem removida.';
            bgStatus.className = 'save-status success';
            showToast('✓ Imagem removida');
            pendingBg = null;
            bgFile.value = '';
            bgFilename.innerText = '';
        } catch {
            showToast('Erro ao remover imagem', true);
        }
    });

    // ═════════════════════════ CONTENT EDITOR ════════════════════
    // Single unified handler: covers all inputs + textareas with data-key
    // (landing content, about title/bio, howto steps)
    document.querySelectorAll('[data-key]').forEach(input => {
        const key = input.dataset.key;
        if (!key) return;
        const statusEl = $('st-' + input.id);
        let lastSaved = input.value;
        const doSave = async () => {
            const val = input.value.trim();
            if (val === lastSaved) return;
            if (statusEl) { statusEl.textContent = 'salvando…'; statusEl.className = 'field-status show saving'; }
            try {
                await saveConfig(key, val);
                lastSaved = val;
                if (statusEl) { statusEl.textContent = '✓ salvo'; statusEl.className = 'field-status show success'; setTimeout(() => statusEl.classList.remove('show'), 1500); }
            } catch (e) {
                if (e.message === 'auth') return;
                if (statusEl) { statusEl.textContent = '✗ erro'; statusEl.className = 'field-status show error'; }
            }
        };
        input.addEventListener('blur', doSave);
        // Enter in single-line inputs blurs (saves); Enter in textareas inserts newline as normal
        if (input.tagName !== 'TEXTAREA') {
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
        }
    });

    // ═════════════════════════ SHARED HELPERS ════════════════════
    function previewLocal(file, cb) {
        const reader = new FileReader();
        reader.onload = ev => cb(ev.target.result);
        reader.readAsDataURL(file);
    }

    function setupUploadZone({ area, input, onSelect, onError }) {
        function handle(file) {
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                onError('Arquivo precisa ser uma imagem.');
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                onError('Imagem muito grande (máx. 10MB).');
                return;
            }
            onSelect(file);
        }
        input.addEventListener('change', e => handle(e.target.files[0]));
        ['dragenter','dragover'].forEach(ev => {
            area.addEventListener(ev, e => {
                e.preventDefault(); e.stopPropagation();
                area.classList.add('dragover');
            });
        });
        ['dragleave','drop'].forEach(ev => {
            area.addEventListener(ev, e => {
                e.preventDefault(); e.stopPropagation();
                area.classList.remove('dragover');
            });
        });
        area.addEventListener('drop', e => {
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) handle(file);
        });
    }

    function handleRadioKeys(e, container, selectFn, attr) {
        const cards = Array.from(container.children);
        const i = cards.indexOf(e.currentTarget);
        let next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = cards[(i + 1) % cards.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = cards[(i - 1 + cards.length) % cards.length];
        else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            selectFn(e.currentTarget.dataset[attr]);
            return;
        }
        if (next) { e.preventDefault(); next.focus(); }
    }

    // ═════════════════════════ INIT ══════════════════════════════
    (async () => {
        try {
            const cfg = await (await fetch('/api/config', { credentials: 'include' })).json();

            // Theme — migrate legacy 'cosmico' silently
            currentTheme = cfg.landing_theme || 'classico';
            if (currentTheme === 'cosmico') {
                currentTheme = 'retro';
                saveConfig('landing_theme', 'retro').catch(() => {});
            }

            currentLogoUrl = cfg.landing_logo_url     || '';
            currentBgColor = cfg.landing_bg_color     || '';
            currentBgImage = cfg.landing_bg_image_url || '';

            // Content fields
            const fillIfPresent = (id, key) => {
                const el = $(id);
                if (el && cfg[key] != null) {
                    if (el.tagName === 'TEXTAREA') el.value = cfg[key];
                    else el.value = cfg[key];
                }
            };
            fillIfPresent('cf-title',       'landing_title');
            fillIfPresent('cf-tagline',     'landing_tagline');
            fillIfPresent('cf-instagram',   'landing_instagram');
            fillIfPresent('cf-whatsapp',    'landing_whatsapp');
            // About
            // (about_* fields removed — gerenciados em admin-sobre.html)
            // Howto
            fillIfPresent('cf-howto-1', 'howto_step_1');
            fillIfPresent('cf-howto-2', 'howto_step_2');
            fillIfPresent('cf-howto-3', 'howto_step_3');
            fillIfPresent('cf-howto-4', 'howto_step_4');
            const howtoToggle = $('howtoVisible');
            if (howtoToggle) howtoToggle.checked = cfg.howto_visible !== '0';

            // Bg color sync (hydrate Figma picker from saved hex)
            if (currentBgColor && /^#[0-9a-fA-F]{6}$/.test(currentBgColor)) {
                cpSetFromHex(currentBgColor, /*persist=*/false);
            } else {
                cpRender();  // initial render with default HSV
            }

            // Bg position radio
            const pos = cfg.landing_bg_position || 'cover';
            const r = document.querySelector('input[name="bgPosition"][value="' + pos + '"]');
            if (r) r.checked = true;

            renderThemes();
            renderPresets();
            renderLogoPreview(currentLogoUrl);
            renderBgPreview(currentBgImage);
            updateRevertButton();
        } catch (e) {
            console.warn('Init:', e);
            cpRender();
            renderThemes();
            renderPresets();
            renderLogoPreview('');
            renderBgPreview('');
        }
    })();

    // ═════════════════════════ HOWTO VISIBILITY ══════════════════
    const howtoToggle = $('howtoVisible');
    if (howtoToggle) {
        howtoToggle.addEventListener('change', () => {
            saveConfig('howto_visible', howtoToggle.checked ? '1' : '0').catch(e => {
                if (e.message === 'auth') return;
                showToast('Erro ao salvar visibilidade', true);
            });
        });
    }

})();
