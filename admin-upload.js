// [VZ] admin-upload — extracted from admin.html
(function () {
    'use strict';

    // Initialize event listeners
    function initEventListeners() {
        const dropzone = document.getElementById('dropzone');
        const btnLancar = document.getElementById('btnLancar');
        
        if (dropzone) {
            dropzone.addEventListener('click', () => {
                document.getElementById('fileInput').click();
            });
            dropzone.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    document.getElementById('fileInput').click();
                }
            });
        }
        
        if (btnLancar) {
            btnLancar.addEventListener('click', enviarTudo);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEventListeners);
    } else {
        initEventListeners();
    }

const PRECOS    = { "Camiseta": 99.90, "Regata": 89.90, "Moletom": 129.90 };
    const MAX_BYTES = 10 * 1024 * 1024;                       // 10MB — matches server multer limit
    const ALLOWED   = ['image/jpeg','image/png','image/webp','image/gif'];

    // Simple HTML escape to prevent XSS from filenames in display
    const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));

    let filaFiles = [];

    document.getElementById('fileInput').onchange = (e) => {
        const escolhidos = Array.from(e.target.files);
        if (escolhidos.length === 0) return;

        // ✅ Filter invalid files client-side
        const validos    = [];
        const rejeitados = [];
        for (const f of escolhidos) {
            if (!ALLOWED.includes(f.type)) {
                rejeitados.push(`${f.name}: tipo não permitido`);
            } else if (f.size > MAX_BYTES) {
                rejeitados.push(`${f.name}: maior que 10MB`);
            } else {
                validos.push(f);
            }
        }
        if (rejeitados.length) {
            alert('Os seguintes arquivos foram ignorados:\n\n' + rejeitados.join('\n'));
        }
        if (validos.length === 0) {
            e.target.value = '';
            return;
        }

        filaFiles = validos;
        document.getElementById('revisao').style.display = 'block';
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

        // Event delegation: update price when product type changes (CSP-safe)
        lista.addEventListener('change', (e) => {
            const sel = e.target;
            if (sel.tagName === 'SELECT' && sel.dataset.row !== undefined) {
                const priceInput = document.getElementById('p-' + sel.dataset.row);
                if (priceInput && PRECOS[sel.value] !== undefined) {
                    priceInput.value = PRECOS[sel.value].toFixed(2);
                }
            }
        });
    };

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

            if (!estampa) {
                status.innerText = '⚠️';
                falha++;
                continue;
            }

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
        setTimeout(() => window.location.href = '/admin-hub.html', 2000);
    }
})();