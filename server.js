// ============================================================
//  Trip Visuals Wear — Production Server
//  v5 — Railway + Cloudinary + PostgreSQL
// ============================================================

process.chdir(__dirname);

const path       = require('path');
const express    = require('express');
const multer     = require('multer');
const rateLimit  = require('express-rate-limit');
const { Pool }   = require('pg');
const cloudinary = require('cloudinary').v2;

// ── VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE ───────────────────────
//  O servidor falha alto e cedo se faltar qualquer credencial.
//  Nunca mais haverá "fallback" silencioso para valores hardcoded.
const REQUIRED_ENV = [
    'DATABASE_URL',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'ADMIN_PASSWORD'
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
    console.error('❌ Variáveis de ambiente obrigatórias faltando:', missing.join(', '));
    console.error('   Configure-as no Railway antes de subir.');
    process.exit(1);
}

const app      = express();
const PORT     = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

// ── CLOUDINARY ───────────────────────────────────────────────
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ── POSTGRESQL ───────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS produtos (
            id            SERIAL PRIMARY KEY,
            nome          TEXT NOT NULL,
            preco         REAL NOT NULL,
            imagem_url    TEXT,
            cloudinary_id TEXT
        )
    `);
    // Migração segura: adiciona a coluna em bancos já existentes.
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cloudinary_id TEXT`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS configuracoes (
            chave TEXT PRIMARY KEY,
            valor TEXT
        )
    `);
    await pool.query(`
        INSERT INTO configuracoes (chave, valor)
        VALUES ('layout_padrao', 'grid-3'), ('tema_admin', 'escuro')
        ON CONFLICT (chave) DO NOTHING
    `);
    console.log('✅ Banco PostgreSQL pronto.');
}

initDB().catch(err => {
    console.error('❌ Erro ao iniciar banco:', err.message);
    process.exit(1);
});

// ── CONFIGURAÇÃO DO PROXY (Railway) ──────────────────────────
//  Necessário para o express-rate-limit identificar o IP real
//  e para que cookies Secure funcionem corretamente.
app.set('trust proxy', 1);

// ── MIDDLEWARES BÁSICOS ──────────────────────────────────────
app.use(express.json({ limit: '100kb' }));

// ── BLOQUEIO DE ARQUIVOS SENSÍVEIS ───────────────────────────
//  Impede que qualquer um baixe server.js, package.json, .env, etc.
//  diretamente pela URL pública.
const BLOCKED_PATHS = [
    '/server.js',
    '/package.json',
    '/package-lock.json',
    '/.env',
    '/.git',
    '/node_modules',
    '/Dockerfile',
    '/railway.json',
    '/railway.toml'
];
app.use((req, res, next) => {
    if (BLOCKED_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
});

// ── ARQUIVOS ESTÁTICOS ───────────────────────────────────────
app.use(express.static(ROOT_DIR, {
    index: 'index.html',
    dotfiles: 'deny'
}));

// ── SESSÃO SIMPLES (em memória — reset a cada redeploy) ──────
const sessoes = new Set();

function requireAuth(req, res, next) {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/vztoken=([^;]+)/);
    const token  = match ? decodeURIComponent(match[1]) : null;
    if (token && sessoes.has(token)) return next();
    res.status(401).json({ error: 'Não autenticado.' });
}

function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie',
        `vztoken=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
    );
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie',
        `vztoken=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    );
}

// ── UPLOAD → CLOUDINARY ──────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de imagem não permitido. Use JPG, PNG, WEBP ou GIF.'));
    }
});

function uploadToCloudinary(buffer, filename) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: 'tripvisuals', public_id: filename, overwrite: true },
            (error, result) => error ? reject(error) : resolve({
                url: result.secure_url,
                public_id: result.public_id
            })
        );
        stream.end(buffer);
    });
}

// ── RATE LIMIT no login ──────────────────────────────────────
//  Máximo 5 tentativas por IP em 15 minutos.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Muitas tentativas. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ── VALIDADOR DE PRODUTO ─────────────────────────────────────
function validarProduto({ nome, preco }) {
    if (typeof nome !== 'string' || nome.trim().length < 1 || nome.length > 200) {
        return 'Nome deve ter entre 1 e 200 caracteres.';
    }
    const precoNum = parseFloat(preco);
    if (!Number.isFinite(precoNum) || precoNum < 0 || precoNum > 999999) {
        return 'Preço inválido.';
    }
    return null;
}

// ════════════════════════════════════════════════════════════
//  ROTAS PÚBLICAS
// ════════════════════════════════════════════════════════════

app.get('/api/produtos', async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT id, nome, preco, imagem_url FROM produtos ORDER BY id DESC'
        );
        res.json(r.rows);
    } catch (e) {
        console.error('GET /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao buscar produtos.' });
    }
});

app.get('/api/config', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM configuracoes');
        const cfg = {};
        r.rows.forEach(row => cfg[row.chave] = row.valor);
        res.json(cfg);
    } catch (e) {
        console.error('GET /api/config:', e.message);
        res.status(500).json({ error: 'Erro ao buscar configurações.' });
    }
});

// ════════════════════════════════════════════════════════════
//  AUTENTICAÇÃO
// ════════════════════════════════════════════════════════════

app.post('/api/login', loginLimiter, (req, res) => {
    const { senha } = req.body || {};
    if (typeof senha !== 'string' || !senha) {
        return res.status(400).json({ success: false, message: 'Senha obrigatória.' });
    }
    if (senha === process.env.ADMIN_PASSWORD) {
        const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
        sessoes.add(token);
        setSessionCookie(res, token);
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Senha incorreta.' });
    }
});

app.post('/api/logout', (req, res) => {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/vztoken=([^;]+)/);
    const token  = match ? decodeURIComponent(match[1]) : null;
    if (token) sessoes.delete(token);
    clearSessionCookie(res);
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/vztoken=([^;]+)/);
    const token  = match ? decodeURIComponent(match[1]) : null;
    if (token && sessoes.has(token)) res.json({ autenticado: true });
    else res.status(401).json({ autenticado: false });
});

// ════════════════════════════════════════════════════════════
//  ROTAS PROTEGIDAS
// ════════════════════════════════════════════════════════════

app.post('/api/produtos', requireAuth, upload.single('imagem'), async (req, res) => {
    const erro = validarProduto(req.body);
    if (erro) return res.status(400).json({ error: erro });

    const { nome, preco } = req.body;
    try {
        let imagem_url = '';
        let cloudinary_id = '';
        if (req.file) {
            const baseName = req.file.originalname
                .replace(/\.[^.]+$/, '')
                .replace(/[^\w-]/g, '_')
                .slice(0, 60);
            const filename = Date.now() + '_' + baseName;
            const result = await uploadToCloudinary(req.file.buffer, filename);
            imagem_url    = result.url;
            cloudinary_id = result.public_id;
        }
        const r = await pool.query(
            'INSERT INTO produtos (nome, preco, imagem_url, cloudinary_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [nome.trim(), parseFloat(preco), imagem_url, cloudinary_id]
        );
        res.json({ success: true, id: r.rows[0].id });
    } catch (e) {
        console.error('POST /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao salvar produto.' });
    }
});

app.put('/api/produtos/:id', requireAuth, async (req, res) => {
    const erro = validarProduto(req.body);
    if (erro) return res.status(400).json({ error: erro });

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: 'ID inválido.' });
    }
    const { nome, preco } = req.body;

    try {
        const r = await pool.query(
            'UPDATE produtos SET nome = $1, preco = $2 WHERE id = $3',
            [nome.trim(), parseFloat(preco), id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao atualizar produto.' });
    }
});

app.delete('/api/produtos/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: 'ID inválido.' });
    }
    try {
        const r = await pool.query(
            'SELECT cloudinary_id, imagem_url FROM produtos WHERE id = $1',
            [id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });

        // Remove a imagem do Cloudinary. Usa o public_id salvo quando existir;
        // cai no parser antigo só para produtos criados antes desta versão.
        const row = r.rows[0];
        if (row.cloudinary_id) {
            await cloudinary.uploader.destroy(row.cloudinary_id)
                .catch(err => console.error('Cloudinary destroy:', err.message));
        } else if (row.imagem_url && row.imagem_url.includes('cloudinary')) {
            const legacyId = 'tripvisuals/' + row.imagem_url.split('/').pop().split('.')[0];
            await cloudinary.uploader.destroy(legacyId)
                .catch(err => console.error('Cloudinary destroy (legacy):', err.message));
        }

        await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao remover produto.' });
    }
});

app.post('/api/config', requireAuth, async (req, res) => {
    const { chave, valor } = req.body || {};
    if (typeof chave !== 'string' || chave.length < 1 || chave.length > 60) {
        return res.status(400).json({ error: 'Chave inválida.' });
    }
    if (typeof valor !== 'string' || valor.length > 500) {
        return res.status(400).json({ error: 'Valor inválido.' });
    }
    try {
        await pool.query(
            'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = $2',
            [chave, valor]
        );
        res.json({ success: true });
    } catch (e) {
        console.error('POST /api/config:', e.message);
        res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
});

// ── FALLBACK SPA ─────────────────────────────────────────────
//  Rotas /api/* desconhecidas → 404 JSON (não servir index.html).
//  Qualquer outra rota → index.html (para HTMLs únicos como /admin).
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Rota não encontrada.' });
    }
    res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// ── ERROR HANDLER (último middleware) ────────────────────────
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err.message);
    if (err.message && (err.message.includes('Tipo de imagem') || err.message.includes('File too large'))) {
        return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ── START ────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Trip Visuals online — porta ${PORT}`);
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────
function shutdown(signal) {
    console.log(`${signal} recebido, encerrando...`);
    server.close(() => {
        pool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
