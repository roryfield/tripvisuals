// [VZ] admin-upload — Upload de produtos com limite de 50 arquivos
(function () {
    'use strict';

    const MAX_FILES = 50;
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB — matches server multer limit
    const ALLOWED   = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const PRECOS    = { 'Camiseta': 99.90, 'Regata': 89.90, 'Moletom': 129.90 };

    // Simple HTML escape to prevent XSS from filenames
    const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    let filaFiles = [];

    function init() {
        const dropzone  = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');
        const lista     = document.getElementById('lista');

        // Dropzone click + keyboard — fileInput is outside the dropzone to
        // prevent the click event from bubbling back up and looping.
        if (dropzone) {
            dropzone.addEventListener('click', () => fileInput.click());
            dropzone.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInput.click();
                }
            });
        }

        // Launch button
        const btnLancar = document.getElementById('btnLancar');
        if (btnLancar) btnLancar.addEventListener('click', enviarTudo);

        // Event delegation for type select → auto-fill price (CSP-safe)
        if (lista) {
            lista.addEventListener('change', (e) => {
                const sel = e.target;
                if (sel.tagName === 'SELECT' && sel.dataset.row !== undefined) {
                    const priceInput = document.getElementById('p-' + sel.dataset.row);
                    if (priceInput && PRECOS[sel.value] !== undefined) {
                        priceInput.value = PRECOS[sel.value].toFixed(2);
                    }
                }
            });
        }

        // File selection handler
        if (fileInput) fileInput.addEventListener('change', onFilesSelected);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function showWarning(msg) {
        let box = document.getElementById('vzUploadWarning');
        if (!box) {
            box = document.createElement('div');
            box.id = 'vzUploadWarning';
            box.style.cssText =
                'margin:12px 0;padding:12px 16px;border-radius:8px;' +
                'background:rgba(255,190,0,0.08);border:1px solid rgba(255,190,0,0.3);' +
                'color:#ffbe00;font-size:.85rem;line-height:1.5;';
            const dropzone = document.getElementById('dropzone');
            if (dropzone) dropzone.insertAdjacentElement('afterend', box);
        }
        box.innerHTML = msg;
        box.style.display = 'block';
    }

    function clearWarning() {
        const box = document.getElementById('vzUploadWarning');
        if (box) box.style.display = 'none';
    }

    function onFilesSelected(e) {
        const escolhidos = Array.from(e.target.files);
        e.target.value = ''; // reset so the same files can be re-selected

        if (escolhidos.length === 0) return;

        // ── 50-file limit ───────────────────────────────────────────
        if (escolhidos.length > MAX_FILES) {
            showWarning(
                '⚠️ <strong>Limite de ' + MAX_FILES + ' arquivos por vez.</strong><br>' +
                'Você selecionou ' + escolhidos.length + ' arquivos. ' +
                'Apenas os primeiros ' + MAX_FILES + ' foram carregados. ' +
                'Envie o restante em um segundo lote após concluir este.'
            );
            escolhidos.splice(MAX_FILES);
        } else {
            clearWarning();
        }

        // ── Type and size validation ────────────────────────────────
        const validos    = [];
        const rejeitados = [];
        for (const f of escolhidos) {
            if (!ALLOWED.includes(f.type)) {
                rejeitados.push(escapeHTML(f.name) + ': tipo não permitido');
            } else if (f.size > MAX_BYTES) {
                rejeitados.push(escapeHTML(f.name) + ': maior que 10MB');
            } else {
                validos.push(f);
            }
        }
        if (rejeitados.length) {
            showWarning(
                '⚠️ <strong>' + rejeitados.length + ' arquivo(s) ignorado(s):</strong><br>' +
                rejeitados.join('<br>')
            );
        }
        if (validos.length === 0) return;

        filaFiles = validos;
        const revisao = document.getElementById('revisao');
        if (revisao) revisao.removeAttribute('hidden');
        const lista = document.getElementById('lista');
        lista.innerHTML = '';

        filaFiles.forEach((file, i) => {
            const nomeRaw     = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            const nomeDisplay = escapeHTML(nomeRaw.toUpperCase()
                .replace(/[-_]/g, ' ')
                .replace(/whatsapp image/gi, '')
                .trim());

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><img src="${URL.createObjectURL(file)}" alt="Pré-visualização do produto"></td>
                <td>
                    <select id="t-${i}" aria-label="Tipo de produto" data-row="${i}">
                        <option value="Camiseta">Camiseta</option>
                        <option value="Regata">Regata</option>
                        <option value="Moletom">Moletom</option>
                    </select>
                </td>
                <td><input type="text" id="e-${i}" value="${nomeDisplay}" aria-label="Nome ou estampa"></td>
                <td>
                    <select id="c-${i}" aria-label="Cor">
                        <option value="Preta">Preta</option>
                        <option value="Branca">Branca</option>
                    </select>
                </td>
                <td><input type="number" id="p-${i}" value="99.90" step="0.01" min="0" max="999999" style="max-width:100px" aria-label="Preço em reais"></td>
                <td class="status-cell" id="status-${i}">—</td>
            `;
            lista.appendChild(tr);
        });
    }

    async function enviarTudo() {
        if (filaFiles.length === 0) return;
        if (!confirm(`Confirmar envio de ${filaFiles.length} produto(s)?`)) return;

        const btn = document.getElementById('btnLancar');
        btn.disabled  = true;
        btn.innerText = 'ENVIANDO...';

        let sucesso = 0, falha = 0;

        for (let i = 0; i < filaFiles.length; i++) {
            const status = document.getElementById(`status-${i}`);
            status.innerText = '⏳';

            const tipo      = document.getElementById(`t-${i}`).value;
            const estampa   = document.getElementById(`e-${i}`).value.trim();
            const cor       = document.getElementById(`c-${i}`).value;
            const preco     = document.getElementById(`p-${i}`).value;
            const nomeFinal = `${tipo} ${estampa} ${cor}`.toUpperCase().trim();

            if (!estampa) { status.innerText = '⚠️'; falha++; continue; }

            const fd = new FormData();
            fd.append('imagem', filaFiles[i]);
            fd.append('nome',   nomeFinal);
            fd.append('preco',  preco);

            try {
                const res = await fetch('/api/produtos', { method: 'POST', body: fd });
                if (res.ok) { status.innerText = '✅'; sucesso++; }
                else        { status.innerText = '❌'; falha++; console.error(`Item ${i}:`, await res.text()); }
            } catch (e) {
                status.innerText = '⚠️';
                falha++;
                console.error(`Rede item ${i}:`, e);
            }
        }

        btn.innerText = `${sucesso} ✅  ${falha ? falha + ' ❌' : ''} — REDIRECIONANDO...`;
        setTimeout(() => { window.location.href = '/admin-hub.html'; }, 2000);
    }
})();
