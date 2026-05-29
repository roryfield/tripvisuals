// ============================================================
//  Trip Visuals Wear — Production Server
//  v10 — morgan logging · /health · DELETE atômico · Sentry removido
// ============================================================

process.chdir(__dirname);

const path        = require('path');
const crypto      = require('crypto');
const express     = require('express');
const compression = require('compression');
const morgan      = require('morgan');         // [FIX-5] request logging para diagnóstico em produção
const multer      = require('multer');
const rateLimit   = require('express-rate-limit');
const { Pool }    = require('pg');
const cloudinary  = require('cloudinary').v2;  // mantido em v1.41.x — downgrade anterior foi intencional

// ── Constant-time string compare (prevents login timing attacks) ──
function timingSafeStringCompare(a, b) {
    const ba = Buffer.from(String(a || ''));
    const bb = Buffer.from(String(b || ''));
    if (ba.length !== bb.length) {
        crypto.timingSafeEqual(bb, bb);
        return false;
    }
    return crypto.timingSafeEqual(ba, bb);
}

// ── ENV VALIDATION ─────────────────────────────────────────────
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
    process.exit(1);
}

const app      = express();
const PORT     = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

// ── CLOUDINARY ────────────────────────────────────────────────
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ── POSTGRESQL ────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// [FIX-3] Handler de erro no pool: evita unhandledRejection silencioso
// se a conexão cair inesperadamente no Railway.
pool.on('error', (err) => {
    console.error('❌ PostgreSQL pool error inesperado:', err.message);
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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS configuracoes (
            chave TEXT PRIMARY KEY,
            valor TEXT
        )
    `);

    // [VZ] Persistent sessions — survives server restarts and Railway redeploys.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sessoes (
            token      TEXT PRIMARY KEY,
            criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expira_em  TIMESTAMPTZ NOT NULL
        )
    `);
    await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes (expira_em)`
    );
    await pool.query(`DELETE FROM sessoes WHERE expira_em < NOW()`);

    // [VZ] Seeds — all empty by default; landings fall back to their hardcoded
    // values if the corresponding config is empty.
    await pool.query(`
        INSERT INTO configuracoes (chave, valor) VALUES
            ('layout_padrao',         'grid-3'),
            ('tema_admin',            'escuro'),
            ('landing_theme',         'classico'),
            ('landing_logo_url',      ''),
            ('landing_bg_color',      ''),
            ('landing_bg_image_url',  ''),
            ('landing_bg_position',   'cover'),
            ('landing_title',         ''),
            ('landing_tagline',       ''),
            ('landing_instagram',     ''),
            ('landing_whatsapp',      ''),
            ('about_visible',         '1'),
            ('about_title',           ''),
            ('about_text',            ''),
            ('about_bg_color',        ''),
            ('about_bg_image_url',    ''),
            ('howto_visible',         '1'),
            ('howto_step_1',          ''),
            ('howto_step_2',          ''),
            ('howto_step_3',          ''),
            ('howto_step_4',          '')
        ON CONFLICT (chave) DO NOTHING
    `);

    // [VZ migration] Normalize legacy theme slug.
    await pool.query(`
        UPDATE configuracoes SET valor = 'retro'
         WHERE chave = 'landing_theme' AND valor = 'cosmico'
    `);

    console.log('✅ Banco PostgreSQL pronto.');
}

initDB().catch(err => {
    console.error('❌ Erro ao iniciar banco:', err.message);
    process.exit(1);
});

// ── PROXY (Railway) ────────────────────────────────────────────
app.set('trust proxy', 1);

// ── COMPRESSION ────────────────────────────────────────────────
app.use(compression());

// ── REQUEST LOGGING ────────────────────────────────────────────
// [FIX-5] Loga método, url, status e tempo de resposta no Railway.
// Ignora /health para não poluir logs com checks de uptime.
app.use(morgan('combined', {
    skip: (req) => req.path === '/health'
}));

// ── BODY PARSER ────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));

// [VZ] SECURITY HEADERS ────────────────────────────────────────
const CSP_COMMON =
    "default-src 'self'; " +
    "img-src 'self' data: blob: https://res.cloudinary.com; " +
    "style-src 'self' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "script-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'";

const CSP_PUBLIC = CSP_COMMON;
const CSP_ADMIN  = CSP_COMMON;

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const isAdmin = /^\/admin[-\w]*\.html$/i.test(req.path);
    res.setHeader('Content-Security-Policy', isAdmin ? CSP_ADMIN : CSP_PUBLIC);
    next();
});

// ── BLOCKED PATHS ──────────────────────────────────────────────
const BLOCKED_PATHS = [
    '/server.js', '/package.json', '/package-lock.json',
    '/.env', '/.git', '/node_modules',
    '/Dockerfile', '/railway.json', '/railway.toml'
];
app.use((req, res, next) => {
    if (BLOCKED_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
});

// ════════════════════════════════════════════════════════════
// [VZ] DYNAMIC ROOT — resolves landing_theme → HTML file.
// ════════════════════════════════════════════════════════════
app.get('/', async (req, res) => {
    try {
        const r = await pool.query(
            "SELECT valor FROM configuracoes WHERE chave = 'landing_theme'"
        );
        const slug = (r.rows[0] && r.rows[0].valor) || 'classico';
        const safe = /^[a-z0-9-]+$/.test(slug) ? slug : 'classico';
        const file = (safe === 'classico') ? 'index.html' : `landing-${safe}.html`;
        res.sendFile(path.join(ROOT_DIR, file), err => {
            if (err) res.sendFile(path.join(ROOT_DIR, 'index.html'));
        });
    } catch (e) {
        console.error('GET / theme resolver:', e.message);
        res.sendFile(path.join(ROOT_DIR, 'index.html'));
    }
});

// ── STATIC FILES ───────────────────────────────────────────────
app.use(express.static(ROOT_DIR, {
    index: 'index.html',
    dotfiles: 'deny'
}));

// ── SESSION (PostgreSQL-backed — survives redeploys) ───────────
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function dbCreateSession(token) {
    const exp = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query(
        'INSERT INTO sessoes (token, expira_em) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [token, exp]
    );
}

async function dbValidateSession(token) {
    if (!token) return false;
    const r = await pool.query(
        'SELECT 1 FROM sessoes WHERE token = $1 AND expira_em > NOW()',
        [token]
    );
    return r.rows.length > 0;
}

async function dbDeleteSession(token) {
    if (!token) return;
    await pool.query('DELETE FROM sessoes WHERE token = $1', [token]);
}

setInterval(() => {
    pool.query('DELETE FROM sessoes WHERE expira_em < NOW()')
        .catch(e => console.error('Session cleanup error:', e.message));
}, 30 * 60 * 1000).unref();

// [FIX-4] Extração do token centralizada — elimina a duplicação em
// requireAuth, POST /api/logout e GET /api/me.
function getTokenFromRequest(req) {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/vztoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

async function requireAuth(req, res, next) {
    const token = getTokenFromRequest(req);
    try {
        if (await dbValidateSession(token)) return next();
    } catch (e) {
        console.error('requireAuth DB error:', e.message);
    }
    res.status(401).json({ error: 'Não autenticado.' });
}

function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie',
        `vztoken=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `vztoken=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

// ── UPLOAD (Cloudinary) ────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (ok.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de imagem não permitido. Use JPG, PNG, WEBP ou GIF.'));
    }
});

function uploadToCloudinary(buffer, filename, folder = 'tripvisuals') {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, public_id: filename, overwrite: true },
            (error, result) => error ? reject(error) : resolve({
                url: result.secure_url, public_id: result.public_id
            })
        );
        stream.end(buffer);
    });
}

function cloudTransform(url, transform) {
    if (!url || !url.includes('/upload/')) return url;
    return url.replace('/upload/', `/upload/${transform}/`);
}
const TRANSFORM_PRODUCT = 'w_800,h_800,c_limit,q_auto,f_auto';
const TRANSFORM_LOGO    = 'w_600,h_600,c_limit,q_auto,f_auto';
const TRANSFORM_BG      = 'w_1920,q_auto,f_auto,c_limit';

// ── LOGIN RATE LIMIT ───────────────────────────────────────────
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 5,
    message: { success: false, message: 'Muitas tentativas. Tente novamente em 15 minutos.' },
    standardHeaders: true, legacyHeaders: false
});

const uploadLimiter = rateLimit({
    windowMs: 60 * 1000, max: 100,
    message: { error: 'Muitos uploads. Espere um momento.' },
    standardHeaders: true, legacyHeaders: false
});

const writeLimiter = rateLimit({
    windowMs: 60 * 1000, max: 120,
    message: { error: 'Muitas alterações. Espere um momento.' },
    standardHeaders: true, legacyHeaders: false
});

// ── PRODUCT VALIDATION ─────────────────────────────────────────
function validarProduto({ nome, preco }) {
    if (typeof nome !== 'string' || nome.trim().length < 1 || nome.length > 200)
        return 'Nome deve ter entre 1 e 200 caracteres.';
    const p = parseFloat(preco);
    if (!Number.isFinite(p) || p < 0 || p > 999999)
        return 'Preço inválido.';
    return null;
}

// ════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════════════

// [FIX-6] Endpoint para monitoramento externo (UptimeRobot, Railway healthcheck).
// Verifica conectividade com o banco antes de responder 200.
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, db: 'up' });
    } catch (e) {
        res.status(503).json({ ok: false, db: 'down', error: e.message });
    }
});

// ════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════

app.get('/api/produtos', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, nome, preco, imagem_url FROM produtos ORDER BY id DESC LIMIT 500');
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
//  AUTH
// ════════════════════════════════════════════════════════════

app.post('/api/login', loginLimiter, async (req, res) => {
    const { senha } = req.body || {};
    if (typeof senha !== 'string' || !senha)
        return res.status(400).json({ success: false, message: 'Senha obrigatória.' });
    if (timingSafeStringCompare(senha, process.env.ADMIN_PASSWORD)) {
        const token = crypto.randomBytes(32).toString('hex');
        try {
            await dbCreateSession(token);
        } catch (e) {
            console.error('POST /api/login session create:', e.message);
            return res.status(500).json({ success: false, message: 'Erro interno. Tente novamente.' });
        }
        setSessionCookie(res, token);
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Senha incorreta.' });
    }
});

app.post('/api/logout', async (req, res) => {
    const token = getTokenFromRequest(req);   // [FIX-4] usa helper centralizado
    await dbDeleteSession(token).catch(() => {});
    clearSessionCookie(res);
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    const token = getTokenFromRequest(req);   // [FIX-4] usa helper centralizado
    try {
        if (await dbValidateSession(token)) return res.json({ autenticado: true });
    } catch (e) {
        console.error('GET /api/me:', e.message);
    }
    res.status(401).json({ autenticado: false });
});

// ════════════════════════════════════════════════════════════
//  PROTECTED ROUTES
// ════════════════════════════════════════════════════════════

app.post('/api/produtos', requireAuth, uploadLimiter, upload.single('imagem'), async (req, res) => {
    const erro = validarProduto(req.body);
    if (erro) return res.status(400).json({ error: erro });
    const { nome, preco } = req.body;
    try {
        let imagem_url = '', cloudinary_id = '';
        if (req.file) {
            const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_').slice(0, 60);
            const result = await uploadToCloudinary(req.file.buffer, Date.now() + '_' + baseName);
            imagem_url    = cloudTransform(result.url, TRANSFORM_PRODUCT);
            cloudinary_id = result.public_id;
        }
        const r = await pool.query(
            'INSERT INTO produtos (nome, preco, imagem_url, cloudinary_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [nome.trim(), parseFloat(preco), imagem_url, cloudinary_id]);
        res.json({ success: true, id: r.rows[0].id });
    } catch (e) {
        console.error('POST /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao salvar produto.' });
    }
});

app.put('/api/produtos/:id', requireAuth, writeLimiter, async (req, res) => {
    const erro = validarProduto(req.body);
    if (erro) return res.status(400).json({ error: erro });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    const { nome, preco } = req.body;
    try {
        const r = await pool.query(
            'UPDATE produtos SET nome = $1, preco = $2 WHERE id = $3',
            [nome.trim(), parseFloat(preco), id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao atualizar produto.' });
    }
});

app.delete('/api/produtos/:id', requireAuth, writeLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    try {
        // [FIX-7] DELETE + RETURNING em uma única query atômica.
        // Elimina a race condition do SELECT → DELETE anterior.
        const r = await pool.query(
            'DELETE FROM produtos WHERE id = $1 RETURNING cloudinary_id, imagem_url',
            [id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        const row = r.rows[0];
        if (row.cloudinary_id) {
            await cloudinary.uploader.destroy(row.cloudinary_id).catch(err => console.error('Cloudinary destroy:', err.message));
        } else if (row.imagem_url && row.imagem_url.includes('cloudinary')) {
            const legacyId = 'tripvisuals/' + row.imagem_url.split('/').pop().split('.')[0];
            await cloudinary.uploader.destroy(legacyId).catch(err => console.error('Cloudinary destroy (legacy):', err.message));
        }
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao remover produto.' });
    }
});

app.post('/api/config', requireAuth, writeLimiter, async (req, res) => {
    const { chave, valor } = req.body || {};
    if (typeof chave !== 'string' || chave.length < 1 || chave.length > 60)
        return res.status(400).json({ error: 'Chave inválida.' });
    if (typeof valor !== 'string' || valor.length > 2000)
        return res.status(400).json({ error: 'Valor inválido.' });
    try {
        await pool.query(
            'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = $2',
            [chave, valor]);
        res.json({ success: true });
    } catch (e) {
        console.error('POST /api/config:', e.message);
        res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
});

// ════════════════════════════════════════════════════════════
// [VZ] LANDING UPLOADS — logo + background image
// ════════════════════════════════════════════════════════════

app.post('/api/landing/logo', requireAuth, uploadLimiter, upload.single('imagem'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória.' });
    try {
        const result = await uploadToCloudinary(req.file.buffer, 'landing-logo-' + Date.now(), 'tripvisuals/landing');
        const url = cloudTransform(result.url, TRANSFORM_LOGO);
        await pool.query(
            "INSERT INTO configuracoes (chave, valor) VALUES ('landing_logo_url', $1) ON CONFLICT (chave) DO UPDATE SET valor = $1",
            [url]);
        res.json({ success: true, url });
    } catch (e) {
        console.error('POST /api/landing/logo:', e.message);
        res.status(500).json({ error: 'Erro ao enviar logo.' });
    }
});

app.post('/api/landing/bg', requireAuth, uploadLimiter, upload.single('imagem'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória.' });
    try {
        const result = await uploadToCloudinary(req.file.buffer, 'landing-bg-' + Date.now(), 'tripvisuals/landing');
        const url = cloudTransform(result.url, TRANSFORM_BG);
        await pool.query(
            "INSERT INTO configuracoes (chave, valor) VALUES ('landing_bg_image_url', $1) ON CONFLICT (chave) DO UPDATE SET valor = $1",
            [url]);
        res.json({ success: true, url });
    } catch (e) {
        console.error('POST /api/landing/bg:', e.message);
        res.status(500).json({ error: 'Erro ao enviar imagem de fundo.' });
    }
});

// ── SPA FALLBACK ───────────────────────────────────────────────
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
    res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// ── ERROR HANDLER ──────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err.message);
    if (err.message && (err.message.includes('Tipo de imagem') || err.message.includes('File too large')))
        return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ── START ──────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Trip Visuals online — porta ${PORT}`);
});

// ── SHUTDOWN ───────────────────────────────────────────────────
function shutdown(signal) {
    console.log(`${signal} recebido, encerrando...`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
