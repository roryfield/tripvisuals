// ============================================================
//  VOIDZONE — Trip Visuals Wear
//  servidor principal v4 — Railway + Cloudinary + PostgreSQL
// ============================================================

process.chdir(__dirname);

const path       = require('path');
const express    = require('express');
const multer     = require('multer');
const { Pool }   = require('pg');
const cloudinary = require('cloudinary').v2;

const app      = express();
const PORT     = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

// ── CLOUDINARY ───────────────────────────────────────────────
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dda80tcc4',
    api_key:    process.env.CLOUDINARY_API_KEY    || '838574585945389',
    api_secret: process.env.CLOUDINARY_API_SECRET || '1A2N8xzAJ7BeqsSGyhuIUOimbJc'
});

// ── POSTGRESQL ───────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS produtos (
            id         SERIAL PRIMARY KEY,
            nome       TEXT NOT NULL,
            preco      REAL NOT NULL,
            imagem_url TEXT
        )
    `);
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

initDB().catch(err => console.error('Erro ao iniciar banco:', err.message));

// ── MIDDLEWARES ──────────────────────────────────────────────
app.use(express.json());
app.use(express.static(ROOT_DIR));

// ── SESSÃO SIMPLES ───────────────────────────────────────────
const sessoes = new Set();

function requireAuth(req, res, next) {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/vztoken=([^;]+)/);
    const token  = match ? decodeURIComponent(match[1]) : null;
    if (token && sessoes.has(token)) return next();
    res.status(401).json({ error: 'Não autenticado.' });
}

// ── UPLOAD → CLOUDINARY ──────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Tipo não permitido.'));
    }
});

function uploadToCloudinary(buffer, filename) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: 'tripvisuals', public_id: filename, overwrite: true },
            (error, result) => error ? reject(error) : resolve(result.secure_url)
        );
        stream.end(buffer);
    });
}

// ════════════════════════════════════════════════════════════
//  ROTAS PÚBLICAS
// ════════════════════════════════════════════════════════════

app.get('/api/produtos', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM configuracoes');
        const cfg = {};
        r.rows.forEach(row => cfg[row.chave] = row.valor);
        res.json(cfg);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  AUTENTICAÇÃO
// ════════════════════════════════════════════════════════════

app.post('/api/login', (req, res) => {
    const { senha }    = req.body;
    const senhaCorreta = process.env.ADMIN_PASSWORD || 'trip#007';
    if (senha === senhaCorreta) {
        const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
        sessoes.add(token);
        res.setHeader('Set-Cookie', `vztoken=${encodeURIComponent(token)}; Path=/; HttpOnly; Max-Age=604800`);
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
    res.setHeader('Set-Cookie', 'vztoken=; Path=/; HttpOnly; Max-Age=0');
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
    const { nome, preco } = req.body;
    if (!nome || preco === undefined)
        return res.status(400).json({ error: 'nome e preco são obrigatórios.' });
    try {
        let imagem_url = '';
        if (req.file) {
            const filename = Date.now() + '_' + req.file.originalname.replace(/\s/g, '_');
            imagem_url = await uploadToCloudinary(req.file.buffer, filename);
        }
        const r = await pool.query(
            'INSERT INTO produtos (nome, preco, imagem_url) VALUES ($1, $2, $3) RETURNING id',
            [nome, parseFloat(preco), imagem_url]
        );
        res.json({ success: true, id: r.rows[0].id });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/produtos/:id', requireAuth, async (req, res) => {
    const { nome, preco } = req.body;
    if (!nome || preco === undefined)
        return res.status(400).json({ error: 'nome e preco são obrigatórios.' });
    try {
        const r = await pool.query(
            'UPDATE produtos SET nome = $1, preco = $2 WHERE id = $3',
            [nome, parseFloat(preco), parseInt(req.params.id)]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/produtos/:id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT imagem_url FROM produtos WHERE id = $1', [parseInt(req.params.id)]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });

        const url = r.rows[0].imagem_url;
        if (url && url.includes('cloudinary')) {
            const publicId = 'tripvisuals/' + url.split('/').pop().split('.')[0];
            await cloudinary.uploader.destroy(publicId).catch(() => {});
        }

        await pool.query('DELETE FROM produtos WHERE id = $1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', requireAuth, async (req, res) => {
    const { chave, valor } = req.body;
    if (!chave || valor === undefined)
        return res.status(400).json({ error: 'chave e valor são obrigatórios.' });
    try {
        await pool.query(
            'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = $2',
            [chave, valor]
        );
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FALLBACK ─────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(require('path').join(ROOT_DIR, 'index.html')));

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => console.log(`✅ VOIDZONE ONLINE — porta ${PORT}`));
