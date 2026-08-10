// [VZ] catalogador-router.js — Identificação automática de estampas via IA
// Montado em: app.use('/api/catalogador', requireAuth, catalogadorRouter)
// Requer: GROQ_API_KEY no .env  |  npm install groq-sdk
// Opcional: CATALOGADOR_MODEL no .env (sobrescreve o modelo padrão sem redeploy de código)
//
// [VZ] Fase 6 — staging e progresso migraram de disco/JSON local para
// Cloudinary + Postgres. Motivo: disco e arquivo JSON local não sobrevivem
// a um restart do container no Railway; um lote de 800 fotos em andamento
// se perderia silenciosamente. Cloudinary e Postgres sobrevivem.
//
// Continua arquiteturalmente isolado: nenhuma linha aqui menciona a
// tabela "produtos" ou qualquer nome específico da Trip Visuals. Tudo
// que este arquivo sabe sobre é "itens" com uma imagem e um resultado de
// leitura. A ponte pro catálogo real vive só em tripvisuals-adapter.js.
'use strict';

const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const crypto    = require('crypto');
const { EventEmitter } = require('events');
const Groq      = require('groq-sdk');
const { registrarEvento } = require('./eventos');

const router = express.Router();

// ── Dependências injetadas pelo server.js via os setters no fim do arquivo ────
// Nenhuma delas é reinstanciada aqui — todas reaproveitam o que o server.js
// já mantém (pool, conexão com a Cloudinary), pelo mesmo motivo do pool:
// evitar duplicar conexão.
let _pool = null;
let _adapter = null;
let _uploadToCloudinary = null;   // (buffer, filename, folder?) => Promise<{url, public_id}>
let _destroyCloudinary  = null;   // (public_id) => Promise<void>

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const MAX_MB   = 20;
const CLOUDINARY_FOLDER = 'tripvisuals/catalogador-staging';

// ── Schema próprio do módulo ────────────────────────────────────────────────
// Criado pelo próprio catalogador-router.js, não pelo initDB() do server.js,
// de propósito: se este arquivo for extraído pra outro projeto (vdzn-sm,
// record-store), ele continua se auto-suficiente, sem exigir que o novo
// projeto saiba criar essa tabela.
let _schemaPronto = null;
function ensureSchema() {
    if (!_pool) return Promise.resolve();
    if (!_schemaPronto) {
        _schemaPronto = _pool.query(`
            CREATE TABLE IF NOT EXISTS catalogador_itens (
                id               SERIAL PRIMARY KEY,
                chave            TEXT NOT NULL UNIQUE,
                arquivo_original TEXT NOT NULL,
                cloudinary_url   TEXT NOT NULL,
                cloudinary_id    TEXT NOT NULL,
                banda            TEXT,
                output_file      TEXT,
                processado_em    TIMESTAMPTZ,
                aplicado         BOOLEAN NOT NULL DEFAULT false,
                produto_id       INTEGER,
                criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `).then(() => _pool.query(
            `CREATE INDEX IF NOT EXISTS idx_catalogador_itens_aplicado ON catalogador_itens (aplicado)`
        )).catch(err => {
            console.error('[catalogador] falha ao criar schema:', err.message);
            _schemaPronto = null; // permite tentar de novo na próxima chamada
            throw err;
        });
    }
    return _schemaPronto;
}

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
// Antes lia do disco; agora valida o buffer em memória, antes de subir pra
// Cloudinary, pra nunca gastar upload com lixo.
function bufferPareceImagemValida(buf) {
    if (!buf || buf.length < 12) return false;
    const b = buf;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true; // JPEG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true; // PNG
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WebP
    return false;
}

// ── Slug sanitizer ────────────────────────────────────────────────────────────
function toSlug(raw) {
    return (raw ?? '').split('\n')[0].trim().toLowerCase()
        .replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

// ── Estado compartilhado (fila de execução em memória; sobrevive dentro da
//    mesma instância, não precisa persistir — se o processo reiniciar no
//    meio de uma sessão, os itens já salvos em Postgres não se perdem, só a
//    fila em andamento precisa ser reiniciada com "start" de novo) ────────────
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

// ── Acesso aos itens (Postgres) ─────────────────────────────────────────────
// listarItens() devolve o mesmo formato { [chave]: {...} } que o resto do
// arquivo já usava quando isso vinha de um JSON local, pra minimizar o
// tanto de coisa que muda no restante da lógica.
async function listarItens() {
    await ensureSchema();
    const { rows } = await _pool.query(
        `SELECT id, chave, arquivo_original, cloudinary_url, cloudinary_id,
                banda, output_file, processado_em, aplicado, produto_id
         FROM catalogador_itens ORDER BY id`
    );
    const processed = {};
    for (const r of rows) {
        if (!r.processado_em) continue; // ainda não lido, não entra em "processed"
        processed[r.chave] = {
            originalFile: r.arquivo_original,
            band:         r.banda,
            outputFile:   r.output_file,
            processedAt:  r.processado_em,
            aplicado:     r.aplicado,
            produtoId:    r.produto_id,
        };
    }
    return { processed, linhas: rows };
}

async function buscarItem(chave) {
    await ensureSchema();
    const { rows } = await _pool.query(`SELECT * FROM catalogador_itens WHERE chave = $1`, [chave]);
    return rows[0] || null;
}

async function inserirStaging({ chave, arquivoOriginal, url, publicId }) {
    await ensureSchema();
    await _pool.query(
        `INSERT INTO catalogador_itens (chave, arquivo_original, cloudinary_url, cloudinary_id)
         VALUES ($1, $2, $3, $4)`,
        [chave, arquivoOriginal, url, publicId]
    );
}

async function marcarProcessado(chave, { banda, outputFile }) {
    await _pool.query(
        `UPDATE catalogador_itens SET banda = $1, output_file = $2, processado_em = NOW() WHERE chave = $3`,
        [banda, outputFile, chave]
    );
}

async function marcarAplicado(chave, produtoId) {
    await _pool.query(
        `UPDATE catalogador_itens SET aplicado = true, produto_id = $1 WHERE chave = $2`,
        [produtoId, chave]
    );
}

async function removerItem(chave) {
    await _pool.query(`DELETE FROM catalogador_itens WHERE chave = $1`, [chave]);
}

// ── Groq client ───────────────────────────────────────────────────────────────
function getGroq() {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw Object.assign(new Error('GROQ_API_KEY não configurada no .env'), { status: 503 });
    if (!groqClient) groqClient = new Groq({ apiKey: key });
    return groqClient;
}

// ── Identificação de banda ────────────────────────────────────────────────────
// Antes lia bytes do disco; agora busca da Cloudinary. O formato da
// chamada pro Groq (data URI em base64) continua idêntico ao que já
// funcionava, só a origem dos bytes mudou — reduz o risco de mudar duas
// coisas de uma vez numa integração que não dá pra testar contra a API
// real neste ambiente.
async function identifyBand(cloudinaryUrl) {
    const ext  = path.extname(cloudinaryUrl).toLowerCase().split('?')[0];
    const mime = { '.png': 'image/png', '.webp': 'image/webp' }[ext] ?? 'image/jpeg';

    const imgRes = await fetch(cloudinaryUrl);
    if (!imgRes.ok) throw new Error(`Falha ao buscar imagem da Cloudinary: HTTP ${imgRes.status}`);
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

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

// ── Processador por item ───────────────────────────────────────────────────────
async function processFile(item) {
    const { chave, cloudinaryUrl, display } = item;

    emit({ type: 'start', file: display });

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await limiter.acquire();
            const band = await identifyBand(cloudinaryUrl);
            const hash = crypto.createHash('md5').update(chave).digest('hex').slice(0, 8);
            const ext  = path.extname(cloudinaryUrl).split('?')[0] || '.jpg';

            const outputFile = `${band}-${hash}${ext}`;
            await marcarProcessado(chave, { banda: band, outputFile });

            state.stats.done++;
            emit({ type: 'done', file: display, result: {
                originalFile: chave, band, outputFile, processedAt: new Date().toISOString(),
            }});
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
async function runQueue(items, concurrency) {
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
            await processFile(item);
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

// ── Multer (memória — nada toca o disco, sobe direto pra Cloudinary) ──────────
const catUpload = multer({
    storage: multer.memoryStorage(),
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
router.get('/status', async (_, res) => {
    try {
        const { processed } = await listarItens();
        res.json({
            running: state.running,
            paused:  state.paused,
            stats:   { ...state.stats },
            done:    Object.keys(processed).length,
            hasKey:  !!process.env.GROQ_API_KEY,
        });
    } catch (e) {
        console.error('[catalogador] GET /status:', e.message);
        res.status(500).json({ error: 'Erro ao buscar status.' });
    }
});

// GET /api/catalogador/files
router.get('/files', async (_, res) => {
    try {
        const { linhas } = await listarItens();
        res.json({
            total:   linhas.length,
            done:    linhas.filter(r => r.processado_em).length,
            pending: linhas.filter(r => !r.processado_em).length,
            files:   linhas.map(r => ({
                name: r.chave,
                result: r.processado_em ? {
                    originalFile: r.chave, band: r.banda, outputFile: r.output_file,
                    processedAt: r.processado_em,
                } : null,
            })),
        });
    } catch (e) {
        console.error('[catalogador] GET /files:', e.message);
        res.status(500).json({ error: 'Erro ao buscar arquivos.' });
    }
});

// POST /api/catalogador/upload
// Valida em memória, sobe pra Cloudinary, registra em Postgres. Nada
// escreve em disco em nenhum momento deste fluxo.
router.post('/upload', catUpload.array('images'), async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Nenhuma imagem recebida.' });
    if (!_uploadToCloudinary) return res.status(503).json({ error: 'Upload de imagem não configurado.' });

    const valid = [], rejected = [];
    await Promise.all(req.files.map(async f => {
        if (!bufferPareceImagemValida(f.buffer)) {
            rejected.push(f.originalname);
            return;
        }
        try {
            const base = path.basename(f.originalname, path.extname(f.originalname))
                .replace(/[^\w\-. ]/g, '_').slice(0, 80);
            const chave = `${base}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
            const { url, public_id } = await _uploadToCloudinary(f.buffer, chave, CLOUDINARY_FOLDER);
            await inserirStaging({ chave, arquivoOriginal: f.originalname, url, publicId: public_id });
            valid.push(chave);
        } catch (e) {
            console.error('[catalogador] upload individual falhou:', e.message);
            rejected.push(f.originalname);
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
router.post('/start', async (req, res) => {
    if (state.running) return res.status(409).json({ error: 'Já em execução.' });

    try {
        const { linhas } = await listarItens();
        const { concurrency = 2, ratePerMinute = 25 } = req.body || {};

        limiter.setRate(Math.min(Math.max(5, +ratePerMinute || 25), 40));

        const items = linhas
            .filter(r => !r.processado_em)
            .map(r => ({ chave: r.chave, cloudinaryUrl: r.cloudinary_url, display: r.arquivo_original }));

        if (!items.length) return res.json({ message: 'Nenhum arquivo novo para processar.' });

        const concurrenciaFinal = Math.min(Math.max(1, +concurrency || 2), 5);
        runQueue(items, concurrenciaFinal);

        if (_pool) {
            registrarEvento(_pool, {
                modulo:   'catalogador',
                tipo:     'sessao_iniciada',
                resumo:   `Sessão do scanner iniciada: ${items.length} imagem(ns) na fila.`,
                detalhes: { quantidade: items.length, concurrency: concurrenciaFinal, ratePerMinute },
            });
        }

        res.json({ started: true, queued: items.length });
    } catch (e) {
        console.error('[catalogador] POST /start:', e.message);
        res.status(500).json({ error: 'Erro ao iniciar processamento.' });
    }
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
router.get('/results', async (_, res) => {
    try {
        const { processed } = await listarItens();
        res.json(processed);
    } catch (e) {
        console.error('[catalogador] GET /results:', e.message);
        res.status(500).json({ error: 'Erro ao buscar resultados.' });
    }
});

// PATCH /api/catalogador/result/:file
router.patch('/result/:file', async (req, res) => {
    try {
        const chave = decodeURIComponent(req.params.file);
        const item  = await buscarItem(chave);
        if (!item || !item.processado_em) return res.status(404).json({ error: 'Resultado não encontrado.' });

        const slug = toSlug(req.body?.band ?? '');
        if (slug.length < 2) return res.status(400).json({ error: 'Nome de banda inválido.' });

        await marcarProcessado(chave, { banda: slug, outputFile: item.output_file });
        res.json({ updated: true, band: slug, file: chave });
    } catch (e) {
        console.error('[catalogador] PATCH /result:', e.message);
        res.status(500).json({ error: 'Erro ao corrigir resultado.' });
    }
});

// POST /api/catalogador/itens/:file/aplicar
// Cria o produto (rascunho, oculto, preço 0) a partir do resultado do
// scanner. A imagem já está na Cloudinary desde o upload — aqui só
// referencia o mesmo asset, não sobe de novo. A escrita em si vive em
// tripvisuals-adapter.js — este router não sabe o nome de nenhuma tabela.
router.post('/itens/:file/aplicar', async (req, res) => {
    if (!_adapter) return res.status(503).json({ error: 'Integração com o catálogo não configurada.' });

    try {
        const chave = decodeURIComponent(req.params.file);
        const item  = await buscarItem(chave);
        if (!item || !item.processado_em) return res.status(404).json({ error: 'Resultado não encontrado.' });
        if (item.aplicado) {
            return res.status(409).json({ error: 'Este item já foi aplicado ao catálogo.', produtoId: item.produto_id });
        }

        const resultado = await _adapter.aplicarItem({
            cloudinaryUrl: item.cloudinary_url,
            cloudinaryId:  item.cloudinary_id,
            band:          item.banda,
            outputFile:    item.output_file,
            tipoPadrao:    typeof req.body?.tipo   === 'string' ? req.body.tipo   : 'Camiseta',
            generoPadrao:  typeof req.body?.genero === 'string' ? req.body.genero : '',
        });
        await marcarAplicado(chave, resultado.produtoId);
        res.json({ aplicado: true, ...resultado });
    } catch (err) {
        console.error('[catalogador] POST /aplicar:', err.message);
        res.status(err.status || 500).json({ error: err.message || 'Erro ao aplicar item ao catálogo.' });
    }
});

// POST /api/catalogador/itens/:file/descartar
// Remove o item do lote sem criar produto nenhum. Apaga o asset na
// Cloudinary também, já que ele nunca virou produto. Não usa o adapter —
// apagar imagem não tem nada a ver com a tabela produtos.
router.post('/itens/:file/descartar', async (req, res) => {
    try {
        const chave = decodeURIComponent(req.params.file);
        const item  = await buscarItem(chave);
        if (!item) return res.status(404).json({ error: 'Resultado não encontrado.' });

        if (_destroyCloudinary && item.cloudinary_id) {
            await _destroyCloudinary(item.cloudinary_id).catch(() => {});
        }
        await removerItem(chave);
        res.json({ descartado: true, file: chave });
    } catch (e) {
        console.error('[catalogador] POST /descartar:', e.message);
        res.status(500).json({ error: 'Erro ao descartar item.' });
    }
});

// DELETE /api/catalogador/progress
// Reset do lote inteiro. Itens já aplicados a um produto NÃO têm o asset
// da Cloudinary apagado — a foto está em uso por um produto real agora,
// apagar quebraria a imagem dele. Só limpa o que nunca virou produto.
router.delete('/progress', async (_, res) => {
    if (state.running) return res.status(409).json({ error: 'Pare o processamento antes de resetar.' });
    try {
        await ensureSchema();
        const { rows } = await _pool.query(`SELECT cloudinary_id FROM catalogador_itens WHERE aplicado = false`);
        if (_destroyCloudinary) {
            await Promise.all(rows.map(r => _destroyCloudinary(r.cloudinary_id).catch(() => {})));
        }
        await _pool.query(`DELETE FROM catalogador_itens`);
        res.json({ reset: true });
    } catch (e) {
        console.error('[catalogador] DELETE /progress:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/catalogador/export/csv
router.get('/export/csv', async (_, res) => {
    try {
        const { processed } = await listarItens();
        // [VZ] Fase 10 — arquivo_original vem do nome do arquivo enviado,
        // então pode ser adversarial; mesma proteção contra injeção de
        // fórmula usada no export de pedidos.
        const csvSafe = v => {
            const s = String(v ?? '');
            return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
        };
        const q    = s => `"${csvSafe(s).replace(/"/g, '""')}"`;
        const rows = [
            'arquivo_original,banda,arquivo_sugerido,processado_em',
            ...Object.entries(processed).map(([k, v]) =>
                [q(k), q(v.band), q(v.outputFile), q(v.processedAt)].join(','))
        ];
        res.setHeader('Content-Type',        'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="catalogador-tripvisuals.csv"');
        res.send('\uFEFF' + rows.join('\r\n'));
    } catch (e) {
        console.error('[catalogador] GET /export/csv:', e.message);
        res.status(500).json({ error: 'Erro ao exportar CSV.' });
    }
});

// GET /api/catalogador/events — SSE
// O requireAuth do mount verifica o cookie vztoken antes de chegar aqui.
// EventSource envia cookies same-origin automaticamente.
router.get('/events', async (req, res) => {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch (_) {} };

    let done = 0;
    try {
        const { processed } = await listarItens();
        done = Object.keys(processed).length;
    } catch (_) { /* segue com done=0, não derruba a conexão SSE por isso */ }

    send({
        type:    'connected',
        running: state.running,
        paused:  state.paused,
        done,
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

router.setPool = function (p) { _pool = p; ensureSchema().catch(() => {}); };
router.setAdapter = function (a) { _adapter = a; };
router.setCloudinary = function ({ upload, destroy }) {
    _uploadToCloudinary = upload;
    _destroyCloudinary  = destroy;
};

module.exports = router;
