// [VZ] catalogador-router.js — Identificação automática de estampas via IA
// Montado em: app.use('/api/catalogador', requireAuth, catalogadorRouter)
// Requer: GROQ_API_KEY no .env  |  npm install groq-sdk
// Opcional: CATALOGADOR_MODEL no .env (sobrescreve o modelo padrão sem redeploy de código)
// Toda a lógica é auto-contida: staging, progresso e SSE vivem aqui.
'use strict';

const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const { EventEmitter } = require('events');
const Groq      = require('groq-sdk');
const { registrarEvento } = require('./eventos');

const router = express.Router();

// ── Pool do Postgres (injetado pelo server.js via router.setPool) ─────────────
// Sem isso o módulo teria que abrir sua própria conexão, duplicando o pool
// que o server.js já mantém. Ver chamada de setPool logo após o require, no
// server.js.
let _pool = null;
let _adapter = null;

// ── Diretórios (ephemeral no Railway — persist within a deploy session) ────────
const ROOT        = __dirname;
const STAGING     = path.join(ROOT, '.cat-staging');
const PROG_FILE   = path.join(ROOT, '.cat-progress.json');
const IMAGE_RE    = /\.(jpe?g|png|webp)$/i;
const MAX_MB      = 20;

if (!fs.existsSync(STAGING)) fs.mkdirSync(STAGING, { recursive: true });

// ── Rate limiter (token bucket, chained promises) ──────────────────────────────
// Groq free tier: ~30 req/min. Default conservador em 25.
class RateLimiter {
    constructor(rpm) { this.setRate(rpm); this._chain = Promise.resolve(); this._last = 0; }
    setRate(rpm) { this.interval = Math.ceil(60_000 / Math.max(1, rpm)); }
    acquire() {
        const t = this._chain.then(() => new Promise(r => {
            const wait = Math.max(0, this._last + this.interval - Date.now());
            setTimeout(() => { this._last = Date.now(); r(); }, wait);
        }));
        this._chain = t.catch(() => {});
        return t;
    }
}

// ── Magic bytes — valida conteúdo real, não só extensão ───────────────────────
async function isValidImage(filePath) {
    let fd;
    try {
        const buf = Buffer.alloc(12);
        fd = await fs.promises.open(filePath, 'r');
        const { bytesRead } = await fd.read(buf, 0, 12, 0);
        if (bytesRead < 3) return false;
        const b = buf;
        // JPEG: FF D8 FF
        if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;
        // PNG: 89 50 4E 47
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true;
        // WebP: RIFF????WEBP
        if (bytesRead >= 12 &&
            b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
            b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
        return false;
    } catch (_) { return false; }
    finally { if (fd) await fd.close().catch(() => {}); }
}

// ── Slug sanitizer ────────────────────────────────────────────────────────────
function toSlug(raw) {
    return (raw ?? '').split('\n')[0].trim().toLowerCase()
        .replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

// ── Path traversal guard ──────────────────────────────────────────────────────
function assertSafePath(base, filename) {
    const resolved = path.resolve(base, filename);
    const safeBase = path.resolve(base);
    if (!resolved.startsWith(safeBase + path.sep) && resolved !== safeBase)
        throw Object.assign(new Error('Path traversal detectado'), { status: 400 });
    return resolved;
}

// ── Estado compartilhado ──────────────────────────────────────────────────────
const emitter = new EventEmitter();
emitter.setMaxListeners(32);

const state = {
    running: false,
    paused:  false,
    queue:   [],
    index:   0,
    stats:   { total: 0, pending: 0, done: 0, errors: 0, startedAt: null },
};

const limiter     = new RateLimiter(25);
let   groqClient  = null;
const sleep       = ms => new Promise(r => setTimeout(r, ms));
const emit        = data => emitter.emit('update', data);

// ── Progresso ─────────────────────────────────────────────────────────────────
function loadProgress() {
    try {
        if (fs.existsSync(PROG_FILE))
            return JSON.parse(fs.readFileSync(PROG_FILE, 'utf8'));
    } catch (_) {}
    return { processed: {} };
}

function saveProgress(p) {
    try { fs.writeFileSync(PROG_FILE, JSON.stringify(p, null, 2)); }
    catch (e) { console.error('[catalogador] saveProgress:', e.message); }
}

// ── Groq client ───────────────────────────────────────────────────────────────
function getGroq() {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw Object.assign(new Error('GROQ_API_KEY não configurada no .env'), { status: 503 });
    if (!groqClient) groqClient = new Groq({ apiKey: key });
    return groqClient;
}

// ── Identificação de banda ────────────────────────────────────────────────────
async function identifyBand(filePath) {
    const ext  = path.extname(filePath).toLowerCase();
    const mime = { '.png': 'image/png', '.webp': 'image/webp' }[ext] ?? 'image/jpeg';
    const b64  = (await fs.promises.readFile(filePath)).toString('base64');

    const res = await getGroq().chat.completions.create({
        model:       process.env.CATALOGADOR_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens:  24,
        temperature: 0,
        messages: [{
            role: 'user',
            content: [
                { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
                { type: 'text', text:
                    'Você analisa estampas de camisetas. Identifique a banda musical. ' +
                    'Responda SOMENTE com o slug: minúsculas, hífens no lugar de espaços. ' +
                    'Exemplos: iron-maiden, pink-floyd, slayer. ' +
                    'Se não for banda: outros' }
            ]
        }]
    });

    return toSlug(res.choices[0]?.message?.content) || 'sem-identificacao';
}

// ── Processador por arquivo ───────────────────────────────────────────────────
async function processFile(item, progress) {
    const { key, absPath, display } = item;

    if (!fs.existsSync(absPath)) {
        state.stats.errors++;
        emit({ type: 'error', file: display, error: 'Arquivo não encontrado' });
        return;
    }
    if (!(await isValidImage(absPath))) {
        state.stats.errors++;
        emit({ type: 'error', file: display, error: 'Formato inválido (magic bytes)' });
        return;
    }

    emit({ type: 'start', file: display });

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await limiter.acquire();
            const band = await identifyBand(absPath);
            const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 8);
            const ext  = path.extname(absPath);

            const result = {
                originalFile: key,
                band,
                outputFile:   `${band}-${hash}${ext}`,
                processedAt:  new Date().toISOString(),
            };

            progress.processed[key] = result;
            saveProgress(progress);
            state.stats.done++;
            emit({ type: 'done', file: display, result });
            return;

        } catch (err) {
            if (err.status === 429) {
                const wait = Math.pow(2, attempt) * 15_000;
                emit({ type: 'rateLimit', file: display, wait, attempt });
                await sleep(wait);
            } else if (attempt < 3) {
                await sleep(3_000 * attempt);
            } else {
                state.stats.errors++;
                emit({ type: 'error', file: display, error: err.message });
                if (_pool) {
                    registrarEvento(_pool, {
                        modulo:     'catalogador',
                        tipo:       'erro_leitura',
                        severidade: 'erro',
                        resumo:     `Falha ao ler estampa "${display}" após 3 tentativas: ${err.message}`,
                        detalhes:   { arquivo: display, erro: err.message },
                    });
                }
            }
        }
    }
}

// ── Fila de workers ───────────────────────────────────────────────────────────
// state.index é incrementado atomicamente (event loop single-thread do Node.js).
async function runQueue(items, concurrency, progress) {
    state.running = true;
    state.paused  = false;
    state.index   = 0;
    state.queue   = items;
    state.stats   = { total: items.length, pending: items.length, done: 0, errors: 0, startedAt: Date.now() };

    emit({ type: 'started', stats: { ...state.stats } });

    async function worker() {
        while (state.running) {
            while (state.paused) { await sleep(200); if (!state.running) return; }
            const idx  = state.index++;
            const item = state.queue[idx];
            if (!item) return;

            state.stats.pending = Math.max(0, state.stats.pending - 1);

            if (progress.processed[item.key]) {
                emit({ type: 'skip', file: item.display });
                continue;
            }
            await processFile(item, progress);
        }
    }

    await Promise.allSettled(Array.from({ length: concurrency }, worker));

    state.running = false;
    emit({ type: 'complete', stats: { ...state.stats } });

    if (_pool) {
        const duracaoMs = state.stats.startedAt ? Date.now() - state.stats.startedAt : null;
        await registrarEvento(_pool, {
            modulo:     'catalogador',
            tipo:       'sessao_concluida',
            severidade: state.stats.errors > 0 ? 'erro' : 'sucesso',
            resumo:     `Sessão do scanner concluída: ${state.stats.done}/${state.stats.total} lidos, ${state.stats.errors} erro(s).`,
            detalhes:   { ...state.stats, duracaoMs },
        });
    }
}

// ── Multer (uploads para staging) ─────────────────────────────────────────────
const catUpload = multer({
    storage: multer.diskStorage({
        destination: (_, __, cb) => cb(null, STAGING),
        filename: (_, file, cb) => {
            const ext  = path.extname(file.originalname).toLowerCase().replace(/[^.a-z]/g, '');
            const base = path.basename(file.originalname, path.extname(file.originalname))
                .replace(/[^\w\-. ]/g, '_').slice(0, 80);
            cb(null, `${base}_${Date.now()}${ext}`);
        },
    }),
    fileFilter: (_, file, cb) => {
        IMAGE_RE.test(file.originalname)
            ? cb(null, true)
            : cb(Object.assign(new Error(`Formato não permitido: ${path.extname(file.originalname)}`), { status: 400 }));
    },
    limits: { fileSize: MAX_MB * 1024 * 1024, files: 500 },
});

// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES (todos protegidos pelo requireAuth do server.js pai)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/catalogador/status
router.get('/status', (_, res) => {
    res.json({
        running:  state.running,
        paused:   state.paused,
        stats:    { ...state.stats },
        done:     Object.keys(loadProgress().processed).length,
        hasKey:   !!process.env.GROQ_API_KEY,
    });
});

// GET /api/catalogador/files
router.get('/files', (_, res) => {
    const progress = loadProgress();
    const files    = fs.readdirSync(STAGING).filter(f => IMAGE_RE.test(f));
    res.json({
        total:   files.length,
        done:    files.filter(f => !!progress.processed[f]).length,
        pending: files.filter(f => !progress.processed[f]).length,
        files:   files.map(f => ({ name: f, result: progress.processed[f] || null })),
    });
});

// POST /api/catalogador/upload
router.post('/upload', catUpload.array('images'), async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Nenhuma imagem recebida.' });

    const valid = [], rejected = [];
    await Promise.all(req.files.map(async f => {
        if (await isValidImage(f.path)) {
            valid.push(f.filename);
        } else {
            rejected.push(f.originalname);
            await fs.promises.unlink(f.path).catch(() => {});
        }
    }));

    res.json({
        uploaded: valid.length,
        rejected: rejected.length,
        files:    valid,
        ...(rejected.length && { rejectedFiles: rejected }),
    });
});

// POST /api/catalogador/start
router.post('/start', (req, res) => {
    if (state.running) return res.status(409).json({ error: 'Já em execução.' });

    const progress    = loadProgress();
    const { concurrency = 2, ratePerMinute = 25 } = req.body || {};

    limiter.setRate(Math.min(Math.max(5, +ratePerMinute || 25), 40));

    const items = fs.readdirSync(STAGING)
        .filter(f => IMAGE_RE.test(f) && !progress.processed[f])
        .map(f => ({ key: f, absPath: path.join(STAGING, f), display: f }));

    if (!items.length) return res.json({ message: 'Nenhum arquivo novo para processar.' });

    const concurrenciaFinal = Math.min(Math.max(1, +concurrency || 2), 5);
    runQueue(items, concurrenciaFinal, progress);

    if (_pool) {
        registrarEvento(_pool, {
            modulo:   'catalogador',
            tipo:     'sessao_iniciada',
            resumo:   `Sessão do scanner iniciada: ${items.length} imagem(ns) na fila.`,
            detalhes: { quantidade: items.length, concurrency: concurrenciaFinal, ratePerMinute },
        });
    }

    res.json({ started: true, queued: items.length });
});

// POST /api/catalogador/pause  /resume  /stop
router.post('/pause',  (_, res) => { state.paused = true;  emit({ type: 'paused'  }); res.json({ paused: true  }); });
router.post('/resume', (_, res) => { state.paused = false; emit({ type: 'resumed' }); res.json({ paused: false }); });
router.post('/stop',   (_, res) => {
    state.running = false; state.paused = false;
    emit({ type: 'stopped' });
    res.json({ stopped: true });
});

// GET /api/catalogador/results
router.get('/results', (_, res) => res.json(loadProgress().processed));

// PATCH /api/catalogador/result/:file
router.patch('/result/:file', (req, res) => {
    const progress = loadProgress();
    const file     = decodeURIComponent(req.params.file);
    const entry    = progress.processed[file];
    if (!entry) return res.status(404).json({ error: 'Resultado não encontrado.' });

    const slug = toSlug(req.body?.band ?? '');
    if (slug.length < 2) return res.status(400).json({ error: 'Nome de banda inválido.' });

    progress.processed[file].band = slug;
    saveProgress(progress);
    res.json({ updated: true, band: slug, file });
});

// POST /api/catalogador/itens/:file/aplicar
// Cria o produto (rascunho, oculto, preço 0) a partir do resultado do
// scanner. A escrita em si vive em tripvisuals-adapter.js — este router
// não sabe o nome de nenhuma tabela.
router.post('/itens/:file/aplicar', async (req, res) => {
    if (!_adapter) return res.status(503).json({ error: 'Integração com o catálogo não configurada.' });

    const file     = decodeURIComponent(req.params.file);
    const progress = loadProgress();
    const entry    = progress.processed[file];
    if (!entry) return res.status(404).json({ error: 'Resultado não encontrado.' });
    if (entry.aplicado) {
        return res.status(409).json({ error: 'Este item já foi aplicado ao catálogo.', produtoId: entry.produtoId });
    }

    try {
        const resultado = await _adapter.aplicarItem({
            absPath:      path.join(STAGING, file),
            band:         entry.band,
            outputFile:   entry.outputFile,
            tipoPadrao:   typeof req.body?.tipo   === 'string' ? req.body.tipo   : 'Camiseta',
            generoPadrao: typeof req.body?.genero === 'string' ? req.body.genero : '',
        });
        entry.aplicado  = true;
        entry.produtoId = resultado.produtoId;
        saveProgress(progress);
        res.json({ aplicado: true, ...resultado });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || 'Erro ao aplicar item ao catálogo.' });
    }
});

// POST /api/catalogador/itens/:file/descartar
// Remove o item do lote sem criar produto nenhum.
router.post('/itens/:file/descartar', async (req, res) => {
    if (!_adapter) return res.status(503).json({ error: 'Integração com o catálogo não configurada.' });

    const file     = decodeURIComponent(req.params.file);
    const progress = loadProgress();
    const entry    = progress.processed[file];
    if (!entry) return res.status(404).json({ error: 'Resultado não encontrado.' });

    await _adapter.descartarItem({ absPath: path.join(STAGING, file) });
    delete progress.processed[file];
    saveProgress(progress);
    res.json({ descartado: true, file });
});

// DELETE /api/catalogador/progress
router.delete('/progress', (_, res) => {
    if (state.running) return res.status(409).json({ error: 'Pare o processamento antes de resetar.' });
    try {
        if (fs.existsSync(PROG_FILE)) fs.unlinkSync(PROG_FILE);
        // Limpa staging
        for (const f of fs.readdirSync(STAGING)) {
            fs.unlinkSync(path.join(STAGING, f));
        }
        res.json({ reset: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/catalogador/export/csv
router.get('/export/csv', (_, res) => {
    const p    = loadProgress();
    const q    = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [
        'arquivo_original,banda,arquivo_sugerido,processado_em',
        ...Object.entries(p.processed).map(([k, v]) =>
            [q(k), q(v.band), q(v.outputFile), q(v.processedAt)].join(','))
    ];
    res.setHeader('Content-Type',        'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="catalogador-tripvisuals.csv"');
    res.send('\uFEFF' + rows.join('\r\n'));
});

// GET /api/catalogador/events — SSE
// O requireAuth do mount verifica o cookie vztoken antes de chegar aqui.
// EventSource envia cookies same-origin automaticamente.
router.get('/events', (req, res) => {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch (_) {} };

    const snap = loadProgress();
    send({
        type:    'connected',
        running: state.running,
        paused:  state.paused,
        done:    Object.keys(snap.processed).length,
        hasKey:  !!process.env.GROQ_API_KEY,
    });

    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20_000);
    emitter.on('update', send);
    req.on('close', () => { emitter.off('update', send); clearInterval(hb); });
});

// ── Multer error handler (escoped to router) ──────────────────────────────────
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const msgs = {
            LIMIT_FILE_SIZE:  `Arquivo maior que ${MAX_MB}MB`,
            LIMIT_FILE_COUNT: 'Máximo 500 arquivos por envio',
        };
        return res.status(400).json({ error: msgs[err.code] || err.message });
    }
    res.status(err.status || 500).json({ error: err.message || 'Erro interno' });
});

router.setPool = function (p) { _pool = p; };
router.setAdapter = function (a) { _adapter = a; };

module.exports = router;
