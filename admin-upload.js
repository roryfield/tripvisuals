// [VZ] admin-upload — Bulk upload with batch config + collection naming
(function () {
    'use strict';

    const MAX_FILES = 50;
    const MAX_BYTES = 10 * 1024 * 1024;
    const ALLOWED   = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const PRECOS    = { 'Camiseta': 99.90, 'Regata': 89.90, 'Moletom': 129.90 };

    const esc = s => String(s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    let filaFiles     = [];  // validated File objects
    let blankRows     = [];  // indices that had no usable filename

    // ── FILENAME PROCESSING ──────────────────────────────────────

    function detectarTipo(filename) {
        const f = filename.toLowerCase();
        if (f.includes('regata') || f.includes('tank'))              return 'Regata';
        if (f.includes('moletom') || f.includes('moleton') ||
            f.includes('hoodie') || f.includes('blusa'))             return 'Moletom';
        return 'Camiseta';
    }

    function limparNome(filename) {
        let s = filename.substring(0, filename.lastIndexOf('.')) || filename;
        s = s
            .replace(/whatsapp\s*image\s*/gi, '')           // WhatsApp prefix
            .replace(/^(img|dsc|dscn|dcim|photo|pic|picture|screenshot)[-_\s]*/gi, '') // camera prefix FIRST
            .replace(/\d{4}[-\s]?\d{2}[-\s]?\d{2}/g, '')   // date: 2026-03-18 or 20260318
            .replace(/\bat\b\s*\d{2}[.:]\d{2}([.:]\d{2})?/gi, '') // time: at 15.57.17
            .replace(/\d{6,}/g, '')                         // leftover time blobs: 155717
            .replace(/\s*\(\d+\)\s*/g, '')                  // WhatsApp suffix: (1)
            .replace(/[-_]/g, ' ')                          // separators → spaces
            .replace(/\s+/g, ' ')
            .trim();
        if (/^\d+$/.test(s)) return '';                     // pure camera counter → empty
        return s.toUpperCase();
    }

    // ── INIT ─────────────────────────────────────────────────────

    function init() {
        var dropzone   = document.getElementById('dropzone');
        var fileInput  = document.getElementById('fileInput');
        var lista      = document.getElementById('lista');
        var btnLancar  = document.getElementById('btnLancar');
        var batchTipo  = document.getElementById('batchTipo');
        var batchCor   = document.getElementById('batchCor');
        var batchPreco = document.getElementById('batchPreco');
        var batchCol   = document.getElementById('batchColecao');

        if (dropzone) {
            dropzone.addEventListener('click', function () { fileInput.click(); });
            dropzone.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInput.click();
                }
            });
        }

        if (btnLancar)  btnLancar.addEventListener('click', enviarTudo);
        if (batchTipo)  batchTipo.addEventListener('change', onBatchTipoChange);
        if (batchCor)   batchCor.addEventListener('change', onBatchCorChange);
        if (batchPreco) batchPreco.addEventListener('input', onBatchPrecoChange);
        if (batchCol)   batchCol.addEventListener('input', onBatchColecaoInput);

        // Per-row type change → sync price
        if (lista) {
            lista.addEventListener('change', function (e) {
                var sel = e.target;
                if (sel.tagName === 'SELECT' && sel.id && sel.id.startsWith('t-')) {
                    var idx = sel.id.slice(2);
                    var priceInput = document.getElementById('p-' + idx);
                    if (priceInput && PRECOS[sel.value] !== undefined) {
                        priceInput.value = PRECOS[sel.value].toFixed(2);
                    }
                }
            });
            initZoom(lista);
        }

        if (fileInput) fileInput.addEventListener('change', onFilesSelected);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── BATCH CONFIG HANDLERS ────────────────────────────────────

    function onBatchTipoChange() {
        var tipo  = document.getElementById('batchTipo').value;
        var preco = PRECOS[tipo].toFixed(2);
        document.getElementById('batchPreco').value = preco;
        filaFiles.forEach(function (_, i) {
            var s = document.getElementById('t-' + i);
            var p = document.getElementById('p-' + i);
            if (s) s.value = tipo;
            if (p) p.value = preco;
        });
        updatePreview();
    }

    function onBatchCorChange() {
        var cor = document.getElementById('batchCor').value;
        filaFiles.forEach(function (_, i) {
            var s = document.getElementById('c-' + i);
            if (s) s.value = cor;
        });
        updatePreview();
    }

    function onBatchPrecoChange() {
        var preco = document.getElementById('batchPreco').value;
        filaFiles.forEach(function (_, i) {
            var p = document.getElementById('p-' + i);
            if (p) p.value = preco;
        });
    }

    function onBatchColecaoInput() {
        var col     = (document.getElementById('batchColecao').value || '').trim().toUpperCase();
        var counter = 1;
        blankRows.forEach(function (i) {
            var inp = document.getElementById('e-' + i);
            if (!inp) return;
            if (col) {
                inp.value = col + ' ' + counter;
                inp.style.borderColor = '';
                counter++;
            } else {
                inp.value = '';
                inp.style.borderColor = 'rgba(255,190,0,0.5)';
            }
        });
        updatePreview();
        updateSummary();
    }

    function updatePreview() {
        var col  = (document.getElementById('batchColecao').value || '').trim().toUpperCase();
        var tipo = document.getElementById('batchTipo').value;
        var cor  = document.getElementById('batchCor').value;
        var prev = document.getElementById('batchPreview');
        if (!prev) return;
        if (col && blankRows.length > 0) {
            prev.textContent = '→ ' + tipo.toUpperCase() + ' ' + col + ' 1 ' + cor.toUpperCase()
                + ', ' + tipo.toUpperCase() + ' ' + col + ' 2 ' + cor.toUpperCase() + '...';
            prev.style.display = 'block';
        } else {
            prev.style.display = 'none';
        }
    }

    function updateSummary() {
        var summary = document.getElementById('batchSummary');
        var btn     = document.getElementById('btnLancar');
        if (!summary || !filaFiles.length) return;

        var total   = filaFiles.length;
        var comNome = total - blankRows.length;
        var semNome = blankRows.length;
        var col     = (document.getElementById('batchColecao').value || '').trim();

        var html = '<strong>' + total + '</strong> arquivo' + (total > 1 ? 's' : '');
        if (comNome > 0) {
            html += ' &nbsp;·&nbsp; <span class="batch-ok">' + comNome
                + ' com nome próprio</span>';
        }
        if (semNome > 0) {
            if (col) {
                html += ' &nbsp;·&nbsp; <span class="batch-ok">' + semNome
                    + ' usarão coleção</span>';
            } else {
                html += ' &nbsp;·&nbsp; <span class="batch-warn">' + semNome
                    + ' sem nome — defina uma coleção ↑</span>';
            }
        }
        summary.innerHTML = html;

        if (btn) {
            btn.textContent = 'LANÇAR ' + total + ' PRODUTO' + (total > 1 ? 'S' : '');
        }
    }

    // ── WARNING BOX ──────────────────────────────────────────────

    function showWarning(msg) {
        var box = document.getElementById('vzUploadWarning');
        if (!box) {
            box = document.createElement('div');
            box.id = 'vzUploadWarning';
            box.style.cssText =
                'margin:12px 0;padding:12px 16px;border-radius:8px;' +
                'background:rgba(255,190,0,0.08);border:1px solid rgba(255,190,0,0.3);' +
                'color:#ffbe00;font-size:.85rem;line-height:1.6;';
            var dropzone = document.getElementById('dropzone');
            if (dropzone) dropzone.insertAdjacentElement('afterend', box);
        }
        box.innerHTML = msg;
        box.style.display = 'block';
    }

    function clearWarning() {
        var box = document.getElementById('vzUploadWarning');
        if (box) box.style.display = 'none';
    }

    // ── FILE SELECTION ───────────────────────────────────────────

    function onFilesSelected(e) {
        var escolhidos = Array.from(e.target.files);
        e.target.value = '';

        if (escolhidos.length === 0) return;

        var warnings = [];

        if (escolhidos.length > MAX_FILES) {
            warnings.push('⚠️ <strong>Limite de ' + MAX_FILES + ' arquivos por vez.</strong> Você selecionou '
                + escolhidos.length + '. Apenas os primeiros ' + MAX_FILES + ' foram carregados. '
                + 'Envie o restante em um próximo lote.');
            escolhidos.splice(MAX_FILES);
        }

        var validos    = [];
        var rejeitados = [];
        escolhidos.forEach(function (f) {
            if (!ALLOWED.includes(f.type))    rejeitados.push(esc(f.name) + ': tipo não permitido');
            else if (f.size > MAX_BYTES)      rejeitados.push(esc(f.name) + ': maior que 10MB');
            else                              validos.push(f);
        });
        if (rejeitados.length) {
            warnings.push('⚠️ <strong>' + rejeitados.length + ' ignorado(s):</strong> '
                + rejeitados.join(' · '));
        }

        if (warnings.length) showWarning(warnings.join('<br>'));
        else clearWarning();

        if (validos.length === 0) return;

        filaFiles = validos;
        blankRows = [];

        var batchPanel = document.getElementById('batchPanel');
        if (batchPanel) batchPanel.removeAttribute('hidden');

        var batchCor = document.getElementById('batchCor').value;
        var lista    = document.getElementById('lista');
        lista.innerHTML = '';

        filaFiles.forEach(function (file, i) {
            var tipoAuto = detectarTipo(file.name);
            var nomeAuto = limparNome(file.name);
            var isBlank  = !nomeAuto;

            if (isBlank) blankRows.push(i);

            var precoAuto = PRECOS[tipoAuto].toFixed(2);
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td><img src="' + URL.createObjectURL(file) + '" alt="Pré-visualização"></td>' +
                '<td><select id="t-' + i + '" aria-label="Tipo">' +
                    '<option value="Camiseta"' + (tipoAuto === 'Camiseta' ? ' selected' : '') + '>Camiseta</option>' +
                    '<option value="Regata"'   + (tipoAuto === 'Regata'   ? ' selected' : '') + '>Regata</option>' +
                    '<option value="Moletom"'  + (tipoAuto === 'Moletom'  ? ' selected' : '') + '>Moletom</option>' +
                '</select></td>' +
                '<td><input type="text" id="e-' + i + '" value="' + esc(nomeAuto) + '" ' +
                    'aria-label="Nome" ' +
                    (isBlank ? 'placeholder="aguardando coleção..." style="border-color:rgba(255,190,0,0.5)"' : '') +
                '></td>' +
                '<td><select id="c-' + i + '" aria-label="Cor">' +
                    '<option value="Preta"'  + (batchCor === 'Preta'  ? ' selected' : '') + '>Preta</option>' +
                    '<option value="Branca"' + (batchCor === 'Branca' ? ' selected' : '') + '>Branca</option>' +
                '</select></td>' +
                '<td><input type="number" id="p-' + i + '" value="' + precoAuto + '" ' +
                    'step="0.01" min="0" max="999999" style="max-width:100px" aria-label="Preço"></td>' +
                '<td class="status-cell" id="status-' + i + '">—</td>';
            lista.appendChild(tr);
        });

        // Apply collection name if already typed
        onBatchColecaoInput();
        updatePreview();
        updateSummary();
    }

    // ── HOVER ZOOM ───────────────────────────────────────────────

    function initZoom(lista) {
        var panel   = document.createElement('div');
        panel.className = 'vz-zoom-panel';
        panel.setAttribute('aria-hidden', 'true');
        var zoomImg = document.createElement('img');
        zoomImg.alt = '';
        panel.appendChild(zoomImg);
        document.body.appendChild(panel);

        var OFFSET = 16, SIZE = 320;

        function reposition(x, y) {
            var vw   = window.innerWidth, vh = window.innerHeight;
            var left = (x + OFFSET + SIZE > vw - 8) ? x - SIZE - OFFSET : x + OFFSET;
            var top  = (y + OFFSET + SIZE > vh - 8) ? y - SIZE - OFFSET : y + OFFSET;
            panel.style.left = Math.max(8, left) + 'px';
            panel.style.top  = Math.max(8, top)  + 'px';
        }

        lista.addEventListener('mouseover', function (e) {
            var img = e.target.closest('td img');
            if (!img) return;
            zoomImg.src = img.src;
            panel.classList.add('visible');
        });
        lista.addEventListener('mousemove', function (e) {
            if (panel.classList.contains('visible')) reposition(e.clientX, e.clientY);
        });
        lista.addEventListener('mouseout', function (e) {
            if (e.target.closest('td img')) panel.classList.remove('visible');
        });
    }

    // ── UPLOAD ───────────────────────────────────────────────────

    async function enviarTudo() {
        if (filaFiles.length === 0) return;

        // Block launch if blank rows have no collection
        var col        = (document.getElementById('batchColecao').value || '').trim();
        var stillBlank = blankRows.filter(function (i) {
            var inp = document.getElementById('e-' + i);
            return inp && !inp.value.trim();
        });
        if (stillBlank.length > 0) {
            showWarning('⚠️ <strong>' + stillBlank.length + ' arquivo(s) ainda sem nome.</strong> '
                + 'Defina um nome de Coleção acima — eles serão nomeados automaticamente.');
            document.getElementById('batchColecao').focus();
            return;
        }

        if (!confirm('Confirmar envio de ' + filaFiles.length + ' produto(s)?')) return;

        var btn = document.getElementById('btnLancar');
        btn.disabled    = true;
        btn.textContent = 'ENVIANDO...';

        // Open review table so status icons are visible
        var details = document.getElementById('revisaoDetails');
        if (details) details.open = true;

        var sucesso = 0, falha = 0;

        for (var i = 0; i < filaFiles.length; i++) {
            var statusEl = document.getElementById('status-' + i);
            if (statusEl) statusEl.textContent = '⏳';

            var tipo     = document.getElementById('t-' + i).value;
            var estampa  = document.getElementById('e-' + i).value.trim();
            var cor      = document.getElementById('c-' + i).value;
            var preco    = document.getElementById('p-' + i).value;
            var nomeFinal = (tipo + ' ' + estampa + ' ' + cor).toUpperCase().trim();

            if (!estampa) {
                if (statusEl) { statusEl.textContent = '⚠️'; statusEl.title = 'Sem nome'; }
                falha++;
                continue;
            }

            var fd = new FormData();
            fd.append('imagem', filaFiles[i]);
            fd.append('nome',   nomeFinal);
            fd.append('preco',  preco);

            try {
                var res = await fetch('/api/produtos', {
                    method: 'POST',
                    body: fd,
                    credentials: 'include'
                });
                if (res.ok) {
                    if (statusEl) statusEl.textContent = '✅';
                    sucesso++;
                } else if (res.status === 401) {
                    if (statusEl) statusEl.textContent = '🔒';
                    showWarning('⚠️ Sessão expirada durante o upload. Faça login novamente.');
                    btn.disabled    = false;
                    btn.textContent = 'LANÇAR ' + filaFiles.length + ' PRODUTOS';
                    return;
                } else if (res.status === 429) {
                    if (statusEl) statusEl.textContent = '⏸️';
                    showWarning('⚠️ Limite de uploads atingido. Aguarde 1 minuto e tente novamente.');
                    falha++;
                } else {
                    if (statusEl) statusEl.textContent = '❌';
                    falha++;
                    console.error('Item ' + i + ':', res.status, await res.text());
                }
            } catch (err) {
                if (statusEl) { statusEl.textContent = '⚠️'; }
                falha++;
                console.error('Rede item ' + i + ':', err);
            }
        }

        var resumo = sucesso + ' ✅' + (falha ? '  ' + falha + ' ❌' : '');
        btn.textContent = resumo + ' — REDIRECIONANDO...';
        setTimeout(function () { window.location.href = '/admin-hub.html'; }, 2000);
    }
})();
