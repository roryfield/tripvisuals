// [VZ] admin-upload — Bulk upload with batch config + collection naming
(function () {
    'use strict';

    const MAX_FILES = 50;
    const MAX_BYTES = 10 * 1024 * 1024;
    const ALLOWED   = ['image/jpeg', 'image/png', 'image/webp'];
    const PRECOS    = { 'Camiseta': 99.90, 'Regata': 99.90, 'Babylook': 99.90, 'Moletom': 175.00 };
    // [VZ] Sem lookup fixo pra Decor 3D — o preço de uma peça impressa varia
    // demais por tamanho/tempo de impressão pra ter um "padrão" que faça
    // sentido; esse valor é só ponto de partida editável por item.
    const PRECO_PADRAO_DECOR3D = 49.90;

    function categoriaAtual() {
        var sel = document.getElementById('batchCategoria');
        return sel && sel.value === 'decor3d' ? 'decor3d' : 'vestuario';
    }

    const esc = s => String(s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    let filaFiles     = [];  // validated File objects
    let blankRows     = [];  // indices that had no usable filename
    let previewUrls   = [];  // [VZ] object URLs criadas via createObjectURL — precisam
                              // ser revogadas explicitamente ou vazam memória do
                              // navegador entre lotes (relevante: lotes de até 50
                              // arquivos, re-selecionados várias vezes na mesma sessão).

    // ── FILENAME PROCESSING ──────────────────────────────────────

    function detectarTipo(filename) {
        const f = filename.toLowerCase();
        if (f.includes('regata') || f.includes('tank'))              return 'Regata';
        if (f.includes('babylook') || f.includes('baby look'))        return 'Babylook';
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
            // Strip type keywords — type is set separately, no need to duplicate in name
            // e.g. "regata-nirvana" → "nirvana" so final is "REGATA NIRVANA PRETA" not "REGATA REGATA NIRVANA PRETA"
            .replace(/\b(camiseta|regata|babylook|moletom|moleton|hoodie|blusa|tank)\b/gi, '')
            .replace(/[-_]/g, ' ')                          // separators → spaces
            .replace(/\s+(\d+)\s*$/g, '')                   // strip trailing number(s): "alice in chains 30" → "alice in chains"
            .replace(/\s+/g, ' ')
            .trim();
        if (/^\d+$/.test(s)) return '';                     // pure camera counter → empty
        return s.toUpperCase();
    }

    // ── INIT ─────────────────────────────────────────────────────

    function init() {
        var dropzone   = document.getElementById('dropzoneUpload');
        var fileInput  = document.getElementById('fileInputUpload');
        var lista      = document.getElementById('lista');
        var btnLancar  = document.getElementById('btnLancar');
        var batchCategoria = document.getElementById('batchCategoria');
        var batchTipo  = document.getElementById('batchTipo');
        var batchGenero = document.getElementById('batchGenero');
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
        if (batchCategoria) batchCategoria.addEventListener('change', onBatchCategoriaChange);
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

    // [VZ] Categoria do lote — Decor 3D não usa o combo fixo de tipo de
    // vestuário (Camiseta/Regata/Babylook/Moletom) nem gênero. Troca os
    // controles padrão do lote e, se já existirem linhas na tabela, troca a
    // célula "Tipo" de cada uma de combo pra texto livre (e volta).
    function onBatchCategoriaChange() {
        var isDecor3d = categoriaAtual() === 'decor3d';
        var tipoField   = document.getElementById('batchTipoField');
        var generoField = document.getElementById('batchGeneroField');
        var thTipo   = document.getElementById('thTipo');
        var thGenero = document.getElementById('thGenero');
        var batchPreco = document.getElementById('batchPreco');

        if (tipoField)   tipoField.hidden   = isDecor3d;
        if (generoField) generoField.hidden = isDecor3d;
        if (thTipo)   thTipo.textContent   = isDecor3d ? 'Tipo de peça' : 'Tipo';
        if (thGenero) thGenero.hidden      = isDecor3d;

        if (batchPreco) {
            batchPreco.value = isDecor3d
                ? PRECO_PADRAO_DECOR3D.toFixed(2)
                : PRECOS[document.getElementById('batchTipo').value].toFixed(2);
        }

        filaFiles.forEach(function (_, i) {
            var cell = document.getElementById('t-' + i);
            if (!cell) return;
            var valorAtual = cell.value;
            var novo;
            if (isDecor3d) {
                novo = document.createElement('input');
                novo.type = 'text';
                novo.id   = 't-' + i;
                novo.maxLength = 30;
                novo.placeholder = 'Vaso, Luminária, Suporte...';
                novo.setAttribute('aria-label', 'Tipo de peça');
                novo.value = ['Camiseta','Regata','Babylook','Moletom'].includes(valorAtual) ? '' : valorAtual;
            } else {
                novo = document.createElement('select');
                novo.id = 't-' + i;
                novo.setAttribute('aria-label', 'Tipo');
                ['Camiseta','Regata','Babylook','Moletom'].forEach(function (t) {
                    var opt = document.createElement('option');
                    opt.value = t; opt.textContent = t;
                    if (t === valorAtual) opt.selected = true;
                    novo.appendChild(opt);
                });
            }
            cell.replaceWith(novo);
            var precoCell = document.getElementById('p-' + i);
            if (precoCell && !isDecor3d && PRECOS[novo.value] !== undefined) {
                precoCell.value = PRECOS[novo.value].toFixed(2);
            }
        });
        updatePreview();
    }

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
                inp.classList.remove('vz-input-warn');
                counter++;
            } else {
                inp.value = '';
                inp.classList.add('vz-input-warn');
            }
        });
        updatePreview();
        updateSummary();
    }

    function updatePreview() {
        var col  = (document.getElementById('batchColecao').value || '').trim().toUpperCase();
        var tipo = categoriaAtual() === 'decor3d' ? 'PEÇA' : document.getElementById('batchTipo').value;
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
            box.className = 'vz-upload-warning';
            var dropzone = document.getElementById('dropzoneUpload');
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

        // Libera as URLs de blob do lote anterior antes de criar as novas —
        // sem isso, re-selecionar arquivos várias vezes na mesma sessão
        // acumula URLs nunca liberadas (vazamento de memória).
        previewUrls.forEach(function (u) { URL.revokeObjectURL(u); });
        previewUrls = [];

        var batchPanel = document.getElementById('batchPanel');
        if (batchPanel) batchPanel.removeAttribute('hidden');

        var batchCor = document.getElementById('batchCor').value;
        var lista    = document.getElementById('lista');
        var isDecor3d = categoriaAtual() === 'decor3d';
        lista.innerHTML = '';

        filaFiles.forEach(function (file, i) {
            var tipoAuto = isDecor3d ? '' : detectarTipo(file.name);
            var nomeAuto = limparNome(file.name);
            var isBlank  = !nomeAuto;

            if (isBlank) blankRows.push(i);

            var precoAuto = isDecor3d ? PRECO_PADRAO_DECOR3D.toFixed(2) : PRECOS[tipoAuto].toFixed(2);
            var previewUrl = URL.createObjectURL(file);
            previewUrls.push(previewUrl);
            var tr = document.createElement('tr');
            var celulaTipo = isDecor3d
                ? '<td><input type="text" id="t-' + i + '" maxlength="30" placeholder="Vaso, Luminária, Suporte..." aria-label="Tipo de peça"></td>'
                : '<td><select id="t-' + i + '" aria-label="Tipo">' +
                    '<option value="Camiseta" ' + (tipoAuto === 'Camiseta'  ? 'selected' : '') + '>Camiseta</option>' +
                    '<option value="Regata"   ' + (tipoAuto === 'Regata'    ? 'selected' : '') + '>Regata</option>' +
                    '<option value="Babylook" ' + (tipoAuto === 'Babylook'  ? 'selected' : '') + '>Babylook</option>' +
                    '<option value="Moletom"  ' + (tipoAuto === 'Moletom'   ? 'selected' : '') + '>Moletom</option>' +
                '</select></td>';
            tr.innerHTML =
                '<td><img src="' + previewUrl + '" alt="Pré-visualização"></td>' +
                celulaTipo +
                '<td><input type="text" id="e-' + i + '" value="' + esc(nomeAuto) + '" ' +
                    'aria-label="Nome" ' +
                    (isBlank ? 'placeholder="aguardando coleção..." class="vz-input-warn"' : '') +
                '></td>' +
                '<td><input type="text" id="c-' + i + '" list="coresList" value="' + esc(batchCor) + '" ' +
                    'aria-label="Cor" placeholder="Preta" maxlength="50" class="vz-input-cor"></td>' +
                '<td><input type="text" id="g-' + i + '" list="generosList" value="' + esc(batchGenero ? batchGenero.value : '') + '" ' +
                    'aria-label="Gênero" placeholder="Rock, Metal..." maxlength="50" class="vz-input-cor"></td>' +
                '<td><input type="number" id="p-' + i + '" value="' + precoAuto + '" ' +
                    'step="0.01" min="0" max="999999" class="vz-input-price" aria-label="Preço"></td>' +
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
            fd.append('imagem',  filaFiles[i]);
            fd.append('nome',    nomeFinal);
            fd.append('preco',   preco);
            fd.append('cor',     cor);
            // [VZ] Corrigido junto: as duas linhas abaixo referenciavam
            // `batchTipo`/`batchGenero`, variáveis locais de init() fora de
            // escopo aqui — só não estourava ReferenceError porque o lado
            // esquerdo do `||` era sempre truthy antes de existir um campo
            // de texto que pode ficar vazio (o "Tipo de peça" do Decor 3D).
            // Trocado por document.getElementById direto, igual ao resto do arquivo.
            var categoriaLote = categoriaAtual();
            fd.append('categoria', categoriaLote);
            fd.append('tipo',    document.getElementById('t-' + i)?.value || (categoriaLote === 'decor3d' ? '' : (document.getElementById('batchTipo')?.value || 'Camiseta')));
            fd.append('genero',  (document.getElementById('g-' + i)?.value || document.getElementById('batchGenero')?.value || '').trim());

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
        setTimeout(function () { window.location.href = '/admin-oficina.html?tab=produtos'; }, 2000);
    }
})();
