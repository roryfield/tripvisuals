// [VZ] admin-catalogador — Catalogador IA · identificação em lote via Groq
// Padrões: IIFE, sem globals, credentials:'include', sem inline handlers.
(function () {
    'use strict';

    // ── Constantes ────────────────────────────────────────────────────────────
    const API   = '/api/catalogador';
    const CREDS = { credentials: 'include' };
    const JSON_HDRS = { 'Content-Type': 'application/json', ...CREDS.credentials && {} };

    // ── Estado ────────────────────────────────────────────────────────────────
    let running  = false;
    let paused   = false;
    let results  = {};
    let stats    = { total: 0, pending: 0, done: 0, errors: 0, startedAt: null };

    // ── Helpers de DOM ────────────────────────────────────────────────────────
    const $  = id => document.getElementById(id);
    const esc = s => String(s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const sh  = name => name.length > 44 ? '\u2026' + name.slice(-42) : name;

    // ── API helpers ───────────────────────────────────────────────────────────
    function apiJSON(url, opts) {
        return fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts })
            .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status); return d; }));
    }

    function post(url, body) {
        return apiJSON(url, { method: 'POST', body: JSON.stringify(body) });
    }

    // ── Polling de status (substitui SSE — a conexão de streaming estava sendo
    //    descartada por algo na infraestrutura entre o Railway e o navegador,
    //    confirmado via curl puro sem nenhum byte chegando em 15s de conexão
    //    aberta. Request/response comum, a cada 1.5s, é o que já funciona de
    //    forma comprovada em toda outra chamada desta tela.) ──────────────────
    var lastDoneCount  = 0;
    var lastErrorCount = 0;
    var lastResultKeys = 0;
    var pollTimer      = null;

    function pollStatus() {
        fetch(API + '/status', CREDS)
            .then(function (r) {
                if (r.status === 401) { window.location.replace('/login.html'); return null; }
                return r.json();
            })
            .then(function (d) {
                if (!d) return;

                var wasRunning = running;
                running = d.running;
                paused  = d.paused;
                stats   = Object.assign({}, stats, d.stats);
                updateButtons();
                updateProgress();

                if (d.hasKey === false) {
                    var banner = $('noKeyBanner');
                    if (banner) banner.hidden = false;
                }

                if (d.pararPorErro) {
                    var autoBanner = $('autoStopBanner');
                    var autoMsg    = $('autoStopMsg');
                    if (autoBanner && autoMsg && autoBanner.hidden) {
                        autoMsg.textContent = 'Parado automaticamente: ' + d.pararPorErro.mensagem;
                        autoBanner.hidden = false;
                        log('\u26d4 Parada autom\u00e1tica \u2014 ' + d.pararPorErro.mensagem, 'err');
                    }
                }

                if (!wasRunning && running) {
                    $('pbarWrap').hidden = false;
                    log('Processamento iniciado \u2014 ' + (stats.total || 0) + ' arquivo(s)', 'ok');
                }
                if (wasRunning && !running) {
                    log('Conclu\u00eddo! \u2714 ' + (stats.done || 0) + ' identificados \u00b7 \u2716 ' + (stats.errors || 0) + ' erros', 'ok');
                    fetchFileCount();
                }

                if ((stats.done || 0) !== lastDoneCount || (stats.errors || 0) !== lastErrorCount) {
                    lastDoneCount  = stats.done   || 0;
                    lastErrorCount = stats.errors || 0;
                    fetchResults();
                }
            })
            .catch(function () { /* falha pontual de rede — próximo ciclo tenta de novo, sem poluir o log */ });
    }

    function startPolling() {
        if (pollTimer) return;
        pollStatus();
        pollTimer = setInterval(pollStatus, 1500);
    }

    // ── Atualiza contadores e botões ──────────────────────────────────────────
    function updateButtons() {
        $('btnStart').disabled = running;
        $('btnPause').disabled = !running;
        $('btnStop').disabled  = !running;
        $('btnStart').classList.toggle('btn-launch-running', running && !paused);
        var p = $('btnPause');
        p.textContent = paused ? '\u25b6 Retomar' : '\u23f8 Pausar';
    }

    function updateProgress() {
        var total  = stats.total   || 0;
        var done   = stats.done    || 0;
        var pct    = total > 0 ? Math.round((done / total) * 100) : 0;

        $('statTotal').querySelector('.cat-stat-n').textContent = total;
        $('statDone').textContent  = done;
        $('statPend').textContent  = stats.pending || 0;
        $('statErr').textContent   = stats.errors  || 0;

        var bar = $('pbar');
        bar.style.width = pct + '%';
        $('pbarPct').textContent = pct + '%';

        if (stats.startedAt && done > 0 && (stats.pending || 0) > 0) {
            var elapsed = (Date.now() - stats.startedAt) / 1000;
            var rate    = done / elapsed;
            var secs    = Math.round(stats.pending / rate);
            var m       = Math.floor(secs / 60);
            var s       = secs % 60;
            $('statEta').textContent = '~' + m + 'm ' + s + 's';
        } else {
            $('statEta').textContent = (done === total && total > 0) ? 'Conclu\u00eddo' : '\u2014';
        }
    }

    // ── Log ───────────────────────────────────────────────────────────────────
    function log(text, cls) {
        var container = $('log');
        var ph = container.querySelector('.cat-log-dim');
        if (ph && ph.textContent.indexOf('Aguardando') !== -1) ph.remove();

        var div = document.createElement('div');
        div.className   = 'cat-log-item' + (cls ? ' cat-log-' + cls : '');
        div.textContent = '[' + new Date().toLocaleTimeString('pt-BR') + '] ' + text;
        container.insertBefore(div, container.firstChild);

        while (container.children.length > 200) {
            container.removeChild(container.lastChild);
        }
    }

    // ── Tabela de resultados ──────────────────────────────────────────────────
    function buildTable(entries) {
        var wrap  = $('tableWrap');
        var badge = $('resBadge');
        badge.textContent = entries.length ? '(' + entries.length + ')' : '';

        if (!entries.length) {
            wrap.innerHTML = '<p class="cat-empty">Nenhum resultado ainda.</p>';
            return;
        }

        var html = '<table class="vz-table">' +
            '<thead><tr>' +
            '<th>Arquivo original</th>' +
            '<th>Banda identificada</th>' +
            '<th class="cat-th-hide">Arquivo de sa\u00edda</th>' +
            '<th></th>' +
            '</tr></thead>' +
            '<tbody id="resultTbody"></tbody>' +
            '</table>';

        wrap.innerHTML = html;
        var tbody = document.getElementById('resultTbody');
        entries.forEach(function (e) { appendRowTo(e, tbody); });

        var det = $('resultsDetails');
        if (det && !det.open) det.open = true;
    }

    function appendRowTo(entry, tbody) {
        var tr = document.createElement('tr');
        tr.dataset.file = entry.originalFile;
        var acoes = entry.aplicado
            ? '<span class="cat-badge-ok">no cat\u00e1logo #' + entry.produtoId + '</span>'
            : '<button class="cat-btn-ghost cat-save-btn" type="button" aria-label="Salvar corre\u00e7\u00e3o">salvar</button>' +
              '<button class="cat-btn-aplicar" type="button" aria-label="Aplicar ao cat\u00e1logo">aplicar</button>' +
              '<button class="cat-btn-descartar" type="button" aria-label="Descartar item">descartar</button>';
        tr.innerHTML =
            '<td class="cat-fname" title="' + esc(entry.originalFile) + '">' + esc(sh(entry.originalFile)) + '</td>' +
            '<td>' +
                '<input class="batch-input cat-band-input" ' +
                       'value="' + esc(entry.band) + '" ' +
                       'data-orig="' + esc(entry.band) + '" ' +
                       (entry.aplicado ? 'disabled ' : '') +
                       'aria-label="Banda identificada para ' + esc(sh(entry.originalFile)) + '">' +
            '</td>' +
            '<td class="cat-th-hide"><span class="cat-outfile">' + esc(entry.outputFile) + '</span></td>' +
            '<td class="cat-actions">' + acoes + '</td>';
        tbody.appendChild(tr);
    }

    function appendRow(entry) {
        results[entry.originalFile] = entry;
        var tbody = document.getElementById('resultTbody');
        if (!tbody) { buildTable(Object.values(results)); return; }

        var existing = tbody.querySelector('tr[data-file="' + CSS.escape(entry.originalFile) + '"]');
        if (existing) existing.remove();
        appendRowTo(entry, tbody);

        var badge = $('resBadge');
        badge.textContent = '(' + Object.keys(results).length + ')';
    }

    function saveEdit(input) {
        var band = input.value.trim();
        if (!band || band === input.dataset.orig) return;
        var file = input.closest('tr').dataset.file;
        input.disabled = true;

        post(API + '/result/' + encodeURIComponent(file), { band: band })
            .then(function (d) {
                input.value = d.band;
                input.dataset.orig = d.band;
                log('Corrigido: ' + sh(file) + ' \u2192 ' + esc(d.band), 'ok');
            })
            .catch(function (e) {
                log('Erro ao salvar: ' + e.message, 'err');
                input.value = input.dataset.orig;
            })
            .finally(function () { input.disabled = false; });
    }

    function aplicarItem(tr) {
        var file = tr.dataset.file;
        tr.querySelectorAll('button').forEach(function (b) { b.disabled = true; });

        post(API + '/itens/' + encodeURIComponent(file) + '/aplicar', {})
            .then(function (d) {
                var entry = results[file];
                entry.aplicado  = true;
                entry.produtoId = d.produtoId;
                appendRow(entry);
                log('Aplicado ao cat\u00e1logo: ' + sh(file) + ' \u2192 produto #' + d.produtoId + ' (rascunho, oculto, defina o pre\u00e7o em Produtos)', 'ok');
            })
            .catch(function (e) {
                log('Erro ao aplicar: ' + e.message, 'err');
                tr.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
            });
    }

    function descartarItem(tr) {
        var file = tr.dataset.file;
        if (!confirm('Descartar esta imagem? Ela ser\u00e1 removida do lote e n\u00e3o vira produto.')) return;
        tr.querySelectorAll('button').forEach(function (b) { b.disabled = true; });

        post(API + '/itens/' + encodeURIComponent(file) + '/descartar', {})
            .then(function () {
                delete results[file];
                tr.remove();
                var badge = $('resBadge');
                var n = Object.keys(results).length;
                badge.textContent = n ? '(' + n + ')' : '';
                log('Descartado: ' + sh(file), 'dim');
            })
            .catch(function (e) {
                log('Erro ao descartar: ' + e.message, 'err');
                tr.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
            });
    }

    // ── Busca dados ───────────────────────────────────────────────────────────
    function fetchResults() {
        apiJSON(API + '/results')
            .then(function (d) {
                results = d;
                buildTable(Object.values(d));
            })
            .catch(function () {});
    }

    function fetchFileCount() {
        apiJSON(API + '/files')
            .then(function (d) {
                $('pbarWrap').hidden = (d.done === 0 && !running);
                stats.total   = d.total;
                stats.done    = d.done;
                stats.pending = d.pending;
                updateProgress();
            })
            .catch(function () {});
    }

    // ── Ações ─────────────────────────────────────────────────────────────────
    function startProcessing() {
        var conc = parseInt($('concRange').value, 10);
        var rpm  = parseInt($('rpmRange').value,  10);
        post(API + '/start', { concurrency: conc, ratePerMinute: rpm })
            .then(function (d) {
                if (d.message) { log(d.message, 'dim'); return; }
                stats = { total: d.queued, pending: d.queued, done: 0, errors: 0, startedAt: Date.now() };
                running = true;
                var autoBanner = $('autoStopBanner');
                if (autoBanner) autoBanner.hidden = true;
                $('pbarWrap').hidden = false;
                updateButtons();
                updateProgress();
                log('Processamento iniciado \u2014 ' + d.queued + ' arquivo(s)', 'ok');
                pollStatus();
            })
            .catch(function (e) { log(e.message, 'err'); });
    }

    function togglePause() {
        post(API + (paused ? '/resume' : '/pause'), {})
            .then(function () {
                paused = !paused;
                updateButtons();
                log(paused ? 'Pausado' : 'Retomado', paused ? 'warn' : 'ok');
            })
            .catch(function (e) { log(e.message, 'err'); });
    }

    function stopProcessing() {
        if (!confirm('Parar o processamento? O progresso já salvo é mantido.')) return;
        post(API + '/stop', {})
            .then(function () {
                running = false; paused = false;
                updateButtons();
                log('Parado pelo usu\u00e1rio', 'warn');
            })
            .catch(function (e) { log(e.message, 'err'); });
    }

    function resetAll() {
        if (!confirm('Resetar todo o progresso e limpar a fila de arquivos?')) return;
        fetch(API + '/progress', { method: 'DELETE', credentials: 'include' })
            .then(function (r) {
                if (!r.ok) {
                    return r.json().catch(function () { return {}; }).then(function (d) {
                        throw new Error(d.error || ('HTTP ' + r.status));
                    });
                }
                return r.json();
            })
            .then(function () {
                results = {};
                stats   = { total: 0, pending: 0, done: 0, errors: 0, startedAt: null };
                buildTable([]);
                $('pbarWrap').hidden = true;
                updateProgress();
                log('Progresso e fila resetados', 'warn');
            })
            .catch(function (e) { log('Reset falhou: ' + e.message + ' — tenta "Forçar parada" se continuar travado.', 'err'); });
    }

    function forcarParada() {
        if (!confirm('Forçar parada? Isso para tudo e limpa a fila imediatamente, não importa o estado atual.')) return;
        fetch(API + '/forcar-parada', { method: 'POST', credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                running = false; paused = false;
                results = {};
                stats   = { total: 0, pending: 0, done: 0, errors: 0, startedAt: null };
                var banner = $('autoStopBanner');
                if (banner) banner.hidden = true;
                buildTable([]);
                $('pbarWrap').hidden = true;
                updateButtons();
                updateProgress();
                log('Parada forçada — ' + (d.itensLimpos || 0) + ' item(ns) limpo(s) da fila', 'warn');
            })
            .catch(function (e) { log('Forçar parada falhou: ' + e.message, 'err'); });
    }

    // ── Upload ────────────────────────────────────────────────────────────────
    var dropzone  = $('dropzone');
    var fileInput = $('fileInput');

    function onDragOver(e)  { e.preventDefault(); dropzone.classList.add('cat-dropzone-over'); }
    function onDragLeave()  { dropzone.classList.remove('cat-dropzone-over'); }
    function onDrop(e)      { e.preventDefault(); dropzone.classList.remove('cat-dropzone-over'); uploadFiles(e.dataTransfer.files); }
    function onDropClick()  { fileInput.click(); }
    function onDropKey(e)   { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } }

    dropzone.addEventListener('dragover',  onDragOver);
    dropzone.addEventListener('dragenter', onDragOver);
    dropzone.addEventListener('dragleave', onDragLeave);
    dropzone.addEventListener('drop',      onDrop);
    dropzone.addEventListener('click',     onDropClick);
    dropzone.addEventListener('keydown',   onDropKey);
    fileInput.addEventListener('change',   function () { uploadFiles(fileInput.files); });

    function uploadFiles(fileList) {
        if (!fileList || !fileList.length) return;
        var imgs = Array.from(fileList).filter(function (f) { return /\.(jpe?g|png|webp)$/i.test(f.name); });
        if (!imgs.length) { log('Nenhuma imagem v\u00e1lida selecionada.', 'warn'); return; }

        var total = 0;
        var BATCH = 50;
        var promise = Promise.resolve();

        function doBatch(batch) {
            return function () {
                var form = new FormData();
                batch.forEach(function (f) { form.append('images', f); });
                return fetch(API + '/upload', { method: 'POST', credentials: 'include', body: form })
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        if (d.error) throw new Error(d.error);
                        total += d.uploaded;
                        if (d.rejected > 0) log(d.rejected + ' arquivo(s) rejeitado(s) (formato inv\u00e1lido)', 'warn');
                        log(total + '/' + imgs.length + ' enviadas...', 'dim');
                    });
            };
        }

        for (var i = 0; i < imgs.length; i += BATCH) {
            promise = promise.then(doBatch(imgs.slice(i, i + BATCH)));
        }

        promise
            .then(function () {
                log(total + ' imagens adicionadas \u00e0 fila', 'ok');
                fileInput.value = '';
                fetchFileCount();
            })
            .catch(function (e) { log('Erro no upload: ' + e.message, 'err'); });
    }

    // ── Delegação de eventos (sem inline handlers) ────────────────────────────
    document.addEventListener('click', function (e) {
        var t = e.target;

        if (t.id === 'btnStart')    { startProcessing(); return; }
        if (t.id === 'btnPause')    { togglePause();     return; }
        if (t.id === 'btnStop')     { stopProcessing();  return; }
        if (t.id === 'btnReset')    { resetAll();        return; }
        if (t.id === 'btnForceStop' || t.id === 'btnAutoStopReset') { forcarParada(); return; }
        if (t.id === 'btnExport')   { window.location.href = API + '/export/csv'; return; }
        if (t.id === 'btnClearLog') {
            $('log').innerHTML = '<div class="cat-log-item cat-log-dim">Log limpo.</div>';
            return;
        }

        // Botão "salvar" na tabela de resultados
        if (t.classList.contains('cat-save-btn')) {
            var inp = t.closest('tr') && t.closest('tr').querySelector('.cat-band-input');
            if (inp) saveEdit(inp);
            return;
        }
        if (t.classList.contains('cat-btn-aplicar')) {
            var trA = t.closest('tr');
            if (trA) aplicarItem(trA);
            return;
        }
        if (t.classList.contains('cat-btn-descartar')) {
            var trD = t.closest('tr');
            if (trD) descartarItem(trD);
            return;
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.classList.contains('cat-band-input')) {
            saveEdit(e.target);
        }
    });

    // ── Sliders ───────────────────────────────────────────────────────────────
    $('concRange').addEventListener('input', function () { $('concVal').textContent = this.value; });
    $('rpmRange').addEventListener('input',  function () { $('rpmVal').textContent  = this.value; });

    // ── Init ──────────────────────────────────────────────────────────────────
    startPolling();

})();
