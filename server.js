// ============================================================
//  Trip Visuals Wear — Production Server
//  v8 — Persistent sessions · Cloudinary transforms · Strict CSP
// ============================================================

process.chdir(__dirname);

const path        = require('path');
const crypto      = require('crypto');
const bcrypt      = require('bcryptjs');
const express     = require('express');
const compression = require('compression');
const multer      = require('multer');
const rateLimit  = require('express-rate-limit');
const { Pool }   = require('pg');
const cloudinary = require('cloudinary').v2;
const asaas      = require('./asaas');
const { registrarEvento, listarEventos } = require('./eventos');
const frete      = require('./frete');
const { lerComprovante } = require('./comprovante-ia');
const { validarCpfCnpj } = require('./documentos');
const feedbackNotify     = require('./feedback-notify');
const pedidoNotify       = require('./pedido-notify');

// [VZ] Optional Sentry error monitoring.
// Set SENTRY_DSN in Railway env vars to enable. No-op if not set.
let Sentry = null;
if (process.env.SENTRY_DSN) {
    try {
        Sentry = require('@sentry/node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            tracesSampleRate: 0.1,
            environment: process.env.RAILWAY_ENVIRONMENT || 'production'
        });
        console.log('✅ Sentry inicializado.');
    } catch (e) {
        console.warn('⚠️  Sentry não disponível:', e.message);
        Sentry = null;
    }
}

// ── Constant-time string compare (prevents login timing attacks) ──
// [VZ] Fase 10 — a versão anterior tinha um branch de tamanho: quando os
// buffers tinham comprimento diferente, retornava logo, e esse próprio
// atalho já era um sinal de tempo que dava pra medir de fora (confirma ou
// descarta o tamanho da senha real antes mesmo de comparar o conteúdo).
// A correção: hashear os dois lados com SHA-256 antes de comparar. Hash
// tem tamanho fixo sempre, então o branch de tamanho desaparece, não tem
// mais nada pra vazar por tempo.
function timingSafeStringCompare(a, b) {
    const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
    const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// ── ENV VALIDATION ─────────────────────────────────────────────
const REQUIRED_ENV = [
    'DATABASE_URL',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
    console.error('❌ Variáveis de ambiente obrigatórias faltando:', missing.join(', '));
    process.exit(1);
}
// [VZ] Fase 10 — ADMIN_PASSWORD_HASH (bcrypt) é o caminho correto.
// ADMIN_PASSWORD em texto plano continua aceito, só pra não quebrar
// ambientes já no ar, mas gera aviso todo boot até migrar. Ver
// SEGURANCA.md pra gerar o hash a partir da senha atual.
if (!process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD) {
    console.error('❌ Defina ADMIN_PASSWORD_HASH (recomendado) ou ADMIN_PASSWORD nas variáveis de ambiente.');
    process.exit(1);
}
if (!process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  Usando ADMIN_PASSWORD em texto plano. Migre para ADMIN_PASSWORD_HASH quando puder — ver SEGURANCA.md.');
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
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cloudinary_id TEXT`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cor TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS oculto BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'Camiseta'`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS genero TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS destaque BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cliques INTEGER NOT NULL DEFAULT 0`);
    // [VZ] Fase 3 — filtro por banda e por período de importação. Aditivo:
    // produtos existentes ganham banda vazia (editável depois) e criado_em
    // igual a NOW() no momento do ALTER, não retroativo.
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS banda TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_produtos_banda ON produtos (banda)`);
    // [VZ] Linha de produtos "Decor 3D" (peças decorativas impressas em 3D,
    // vendidas ao lado do vestuário). 'categoria' separa as duas famílias:
    // controla se o catálogo público mostra seletor de tamanho de roupa e
    // filtro de gênero, nenhum dos dois aplicável a um objeto decorativo.
    // Chave em ASCII (não acentuada) por consistência com 'status' de
    // pedidos — o rótulo exibido ("Decor 3D") vive só no front-end.
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'vestuario'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos (categoria)`);
    // One-time: set tipo from existing product names (idempotent — won't re-set if already correct)
    await pool.query(`
        UPDATE produtos SET tipo =
            CASE
                WHEN UPPER(nome) LIKE 'MOLETOM%' THEN 'Moletom'
                WHEN UPPER(nome) LIKE 'REGATA%'  THEN 'Regata'
                WHEN UPPER(nome) LIKE 'BABYLOOK%' THEN 'Babylook'
                ELSE 'Camiseta'
            END
        WHERE tipo = 'Camiseta'
    `);
    // Product gallery — additional photos
    await pool.query(`
        CREATE TABLE IF NOT EXISTS produto_fotos (
            id SERIAL PRIMARY KEY,
            produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            cloudinary_id TEXT NOT NULL DEFAULT '',
            posicao INTEGER NOT NULL DEFAULT 0
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fotos_produto ON produto_fotos (produto_id)`);
    // [VZ] Papel da foto no visualizador multi-ângulo (2026-09-07): 'capa' (a imagem
    // principal, id 0 conceitual — na prática a coluna produtos.imagem_url continua
    // sendo a capa; este 'capa' aqui é só pra permitir marcar uma foto extra como
    // substituta futura), 'frente'/'verso' (vestuário — ativa o flip no catálogo) ou
    // 'angulo' (decor 3D — sequência ordenada por 'posicao', ativa o giro). Vazio
    // ('') é o valor de fotos antigas, sem papel definido — o catálogo trata como
    // galeria simples (comportamento anterior, thumb por clique), nunca quebra.
    await pool.query(`ALTER TABLE produto_fotos ADD COLUMN IF NOT EXISTS papel TEXT NOT NULL DEFAULT ''`);

    // Full-text search
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS busca_tsv tsvector`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_busca_gin ON produtos USING gin(busca_tsv)`);
    await pool.query(`
        UPDATE produtos SET busca_tsv =
            to_tsvector('portuguese', COALESCE(nome,'') || ' ' || COALESCE(cor,'') || ' ' || COALESCE(tipo,'') || ' ' || COALESCE(genero,''))
        WHERE busca_tsv IS NULL
    `);

    // Order tracking table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pedidos (
            id SERIAL PRIMARY KEY,
            produto_nome TEXT NOT NULL,
            valor NUMERIC(10,2),
            tamanho TEXT DEFAULT '',
            cliente_nome TEXT DEFAULT '',
            cliente_whatsapp TEXT DEFAULT '',
            cep TEXT DEFAULT '',
            notas TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'novo',
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    // [VZ] Coluna cep adicionada após o lançamento inicial — ALTER cobre
    // bancos já existentes em produção (CREATE TABLE só roda na 1ª criação).
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cep TEXT DEFAULT ''`);
    // [VZ] cliente_email — opcional, sempre foi assim porque o checkout roda
    // por WhatsApp e nunca pediu e-mail. Alimenta pedido-notify.js: com esse
    // campo preenchido, o pedido ganha confirmação e avisos de status por
    // e-mail; sem ele, o fluxo continua exatamente como sempre foi.
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cliente_email TEXT DEFAULT ''`);

    // [VZ] Payment automation columns — additive, all nullable/defaulted so
    // existing manual (WhatsApp) pedidos are unaffected. Populated only when
    // checkout_automatico_enabled is 'true' and a customer pays via PIX.
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'manual'`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_qr_code TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_expira_em TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pedidos_asaas_payment ON pedidos (asaas_payment_id) WHERE asaas_payment_id != ''`);

    // [VZ] Fase 8 — conferência de comprovante assistida por IA. Caminho
    // paralelo ao pagamento_status='pago' que o webhook da Asaas já usa:
    // aqui quem decide é a dona da loja, a IA só ajuda a conferir.
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS comprovante_url TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS comprovante_valor_detectado NUMERIC(10,2)`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS comprovante_analisado_em TIMESTAMPTZ`);

    // [VZ] Webhook log — every Asaas notification is recorded here BEFORE
    // processing, so a payment confirmation is never silently lost even if
    // our processing logic has a bug. Append-only, never deleted automatically.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS webhook_log (
            id SERIAL PRIMARY KEY,
            provider TEXT NOT NULL DEFAULT 'asaas',
            event_type TEXT NOT NULL DEFAULT 'desconhecido',
            payload JSONB NOT NULL,
            processado BOOLEAN NOT NULL DEFAULT false,
            erro TEXT DEFAULT '',
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // [VZ] Log central de eventos — erros, sucessos e ações em lote de
    // qualquer módulo (catalogador, produtos, dashboard). Append-only,
    // mesmo espírito do webhook_log acima. Ver eventos.js.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS system_events (
            id          SERIAL PRIMARY KEY,
            projeto     TEXT NOT NULL DEFAULT 'tripvisuals',
            modulo      TEXT NOT NULL,
            tipo        TEXT NOT NULL,
            severidade  TEXT NOT NULL DEFAULT 'info',
            resumo      TEXT NOT NULL,
            detalhes    JSONB,
            criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_events_criado ON system_events (criado_em DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_events_modulo ON system_events (modulo)`);

    // [VZ] Feedback do cliente final — capturado direto no catálogo público.
    // Anônimo por padrão; instagram_handle e autoriza_repost só são
    // preenchidos quando a pessoa opta por se identificar (ver validação
    // na rota POST /api/feedback). Append-only do lado do cliente final —
    // só o admin muda o campo status, pra triagem (novo → lido/respondido/arquivado).
    await pool.query(`
        CREATE TABLE IF NOT EXISTS feedbacks (
            id                SERIAL PRIMARY KEY,
            mensagem          TEXT NOT NULL,
            nota              SMALLINT,
            anonimo           BOOLEAN NOT NULL DEFAULT true,
            instagram_handle  TEXT NOT NULL DEFAULT '',
            autoriza_repost   BOOLEAN NOT NULL DEFAULT false,
            status            TEXT NOT NULL DEFAULT 'novo',
            criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedbacks_status  ON feedbacks (status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedbacks_criado ON feedbacks (criado_em DESC)`);

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
    // Clean up any expired sessions from previous runs
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
            ('howto_step_4',          ''),
            ('checkout_automatico_enabled', 'false')
        ON CONFLICT (chave) DO NOTHING
    `);

    // [VZ] Seeds da página Sobre — conteúdo padrão ao vivo
    await pool.query(`
        INSERT INTO configuracoes (chave, valor) VALUES
            ('sobre_manifesto',    'A roupa como forma de expressão'),
            ('sobre_historia',     ''),
            ('sobre_missao',       'Criar peças que contam histórias'),
            ('sobre_pilar1_titulo','Música'),
            ('sobre_pilar1_desc',  'Rock, metal e cultura alternativa'),
            ('sobre_pilar2_titulo','Arte'),
            ('sobre_pilar2_desc',  'Design exclusivo em cada peça'),
            ('sobre_pilar3_titulo','Expressão'),
            ('sobre_pilar3_desc',  'Vista o que você sente')
        ON CONFLICT (chave) DO NOTHING
    `);

    // [VZ migration] If a previous deploy stored the old "cosmico" slug,
    // normalize it silently to the new "retro" name.
    await pool.query(`
        UPDATE configuracoes SET valor = 'retro'
         WHERE chave = 'landing_theme' AND valor = 'cosmico'
    `);

    // [VZ] Fase 7 — schema do módulo de frete, auto-contido (frete.js
    // sabe criar sua própria tabela, igual ao catalogador).
    await frete.ensureSchema(pool);

    console.log('✅ Banco PostgreSQL pronto.');
}

initDB().catch(err => {
    console.error('❌ Erro ao iniciar banco:', err.message);
    process.exit(1);
});

// ── PROXY (Railway) ────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(compression());

// ── BODY PARSER ────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));

// [VZ] SECURITY HEADERS ────────────────────────────────────────
// All JS and CSS is now external — both script-src and style-src
// have NO 'unsafe-inline'. This is a complete CSP.
// The only remaining inline-ish item is style= attributes injected
// dynamically by JS at runtime (e.g. color picker → body.style.backgroundColor)
// which is NOT covered by style-src (it's DOM manipulation, always allowed).
const CSP_COMMON =
    "default-src 'self'; " +
    "img-src 'self' data: blob: https://res.cloudinary.com; " +
    "style-src 'self' https://fonts.googleapis.com; " +  // ← no unsafe-inline
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
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // [VZ] Fase 16 — catalogo.html precisa ser embutível como prévia ao
    // vivo dentro de Marca & Vitrine (admin). Relaxado só pro mesmo
    // domínio (frame-ancestors 'self'), nunca pra terceiro — nenhum outro
    // site consegue embutir o catálogo, só o próprio admin. Toda outra
    // rota continua com a proteção original (DENY / 'none').
    const ehCatalogoPublico = req.path === '/catalogo.html';
    res.setHeader('X-Frame-Options', ehCatalogoPublico ? 'SAMEORIGIN' : 'DENY');

    const isAdmin = /^\/admin[-\w]*\.html$/i.test(req.path);
    let csp = isAdmin ? CSP_ADMIN : CSP_PUBLIC;
    if (ehCatalogoPublico) csp = csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
    res.setHeader('Content-Security-Policy', csp);
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
    // [VZ] .md files are developer/owner documentation (README, deploy notes,
    // activation checklists) that live in the repo root alongside server.js
    // for convenience — they were never meant to be publicly fetchable, and
    // some (like ATIVACAO_PAGAMENTOS.md) describe internal infrastructure.
    if (req.path.toLowerCase().endsWith('.md')) {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
});

// ════════════════════════════════════════════════════════════
// [VZ] DYNAMIC ROOT — resolves landing_theme → HTML file.
// Convention: slug 'classico' → index.html; any other slug → landing-<slug>.html
// Must be BEFORE express.static so / is dynamic.
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

// ── SOBRE PAGE ─────────────────────────────────────────────────
// Clean URL /sobre → serve sobre.html
app.get('/sobre', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'sobre.html'));
});

// ── STATIC FILES ───────────────────────────────────────────────
app.use(express.static(ROOT_DIR, {
    index: 'index.html',
    dotfiles: 'deny'
}));

// ── SESSION (PostgreSQL-backed — survives redeploys) ───────────
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours (security: shorter sessions)

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

// Logout from ALL devices — deletes every active session in the DB.
// Protected: requireAuth means you must be logged in to log everyone out.
// The requestor's own cookie will also be invalidated on the next request.
app.delete('/api/sessions/all', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM sessoes');
        console.log(`All sessions revoked (${r.rowCount} deleted)`);
        // Clear the requestor's own cookie immediately
        res.setHeader('Set-Cookie', `vztoken=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        res.json({ success: true, deleted: r.rowCount });
    } catch (e) {
        console.error('DELETE /api/sessions/all:', e.message);
        res.status(500).json({ error: 'Erro ao encerrar sessões.' });
    }
});

// Periodic cleanup — runs every 30 min; no-op if nothing expired
setInterval(() => {
    pool.query('DELETE FROM sessoes WHERE expira_em < NOW()')
        .catch(e => console.error('Session cleanup error:', e.message));
}, 30 * 60 * 1000).unref();

async function requireAuth(req, res, next) {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/vztoken=([^;]+)/);
    const token  = match ? decodeURIComponent(match[1]) : null;
    try {
        if (await dbValidateSession(token)) return next();
    } catch (e) {
        console.error('requireAuth DB error:', e.message);
    }
    res.status(401).json({ error: 'Não autenticado.' });
}
function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie',
        `vztoken=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
}
function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `vztoken=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

// ── UPLOAD (Cloudinary) ────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        // First gate: trust the Content-Type header is at least claiming an image
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (ok.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de imagem não permitido. Use JPG, PNG, WEBP ou GIF.'));
    }
});

// Binary magic-number check — verifies file BYTES match a real image,
// regardless of what Content-Type the browser claimed.
function detectImageType(buffer) {
    if (!buffer || buffer.length < 12) return null;
    const b = buffer;
    // JPEG: FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
        b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'png';
    // WebP: 'RIFF'....'WEBP'
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    // GIF: 'GIF87a' ou 'GIF89a'
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
        (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'gif';
    return null;
}

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

// [VZ] Inject Cloudinary URL transformation to reduce payload size.
// Uses URL-based transforms (no extra upload step).
// c_limit = only downscale, never upscale; q_auto = smart compression;
// f_auto = best format (WebP/AVIF in supporting browsers).
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

// ── UPLOAD / WRITE RATE LIMITS (defense-in-depth on authed routes) ─
// Cap uploads at 100/min — enough for bulk admin sessions (50-file batches
// with some retry headroom) while still protecting against abuse.
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
// [VZ] Checkout — tighter limit since each call can create a real Asaas charge.
const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10,
    message: { error: 'Muitas tentativas de pagamento. Espere um momento.' },
    standardHeaders: true, legacyHeaders: false
});
// Webhooks arrive in bursts from Asaas — generous limit, identity is verified by token instead.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, max: 200,
    standardHeaders: true, legacyHeaders: false
});
// CSV export pulls every pedido (full customer PII) in one go — not a write,
// so it doesn't belong under writeLimiter, but it's expensive and sensitive
// enough to bound regardless of how generous GET routes are elsewhere.
const exportLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10,
    message: { error: 'Muitas exportações. Espere um momento.' },
    standardHeaders: true, legacyHeaders: false
});

// [VZ] Feedback público — sem auth (o cliente final nunca faz login),
// então o rate limit é a única defesa contra spam/abuso. Generoso o
// suficiente pra uma pessoa real mandar mais de um feedback na mesma
// visita (ex.: corrigir o texto), curto o suficiente pra travar um bot.
const feedbackLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 6,
    message: { error: 'Muitos envios de feedback. Tente novamente mais tarde.' },
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

// [VZ] 'vestuario' (camisetas, regatas, babylooks, moletons) e 'decor3d'
// (peças decorativas impressas em 3D). Entrada fora da lista cai em
// 'vestuario' — mesmo espírito de fallback já usado pro campo 'tipo'.
const CATEGORIAS_VALIDAS = ['vestuario', 'decor3d'];
function normalizarCategoria(valor) {
    return CATEGORIAS_VALIDAS.includes(valor) ? valor : 'vestuario';
}

// [VZ] Papel de uma foto extra em produto_fotos — ver comentário em initDB() na
// criação da coluna. '' (vazio) é sempre aceito, é o valor de foto sem papel
// definido (galeria simples, comportamento anterior).
const PAPEIS_FOTO_VALIDOS = ['', 'capa', 'frente', 'verso', 'angulo'];
function normalizarPapelFoto(valor) {
    return PAPEIS_FOTO_VALIDOS.includes(valor) ? valor : '';
}

// [VZ] Feedback — validação. instagram_handle é sempre salvo sem o @
// (normalizado aqui), pra nunca ter "@@user" ou inconsistência na hora
// de montar o link em admin-feedback.js.
const FEEDBACK_STATUS_VALIDOS = ['novo', 'lido', 'respondido', 'arquivado'];
function normalizarInstagramHandle(valor) {
    if (typeof valor !== 'string') return '';
    const limpo = valor.trim().replace(/^@+/, '');
    if (!limpo) return '';
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(limpo)) return null; // sinaliza inválido
    return limpo;
}
function validarFeedback({ mensagem, nota, anonimo, instagramHandle, autorizaRepost }) {
    if (typeof mensagem !== 'string' || mensagem.trim().length < 3 || mensagem.length > 1000)
        return { erro: 'Mensagem deve ter entre 3 e 1000 caracteres.' };
    let notaNum = null;
    if (nota !== undefined && nota !== null && nota !== '') {
        notaNum = parseInt(nota, 10);
        if (!Number.isInteger(notaNum) || notaNum < 1 || notaNum > 5)
            return { erro: 'Nota deve ser um número entre 1 e 5.' };
    }
    const ehAnonimo = anonimo !== false; // padrão anônimo — só deixa de ser com anonimo === false explícito
    let handle = '';
    let repost = false;
    if (!ehAnonimo) {
        const normalizado = normalizarInstagramHandle(instagramHandle);
        if (normalizado === null)
            return { erro: 'Instagram inválido — use só letras, números, ponto e underline.' };
        handle = normalizado;
        // Autorização de repost só é gravada se de fato houver um @ pra vincular —
        // sem handle não existe conta pra creditar/repostar.
        repost = !!autorizaRepost && !!handle;
    }
    return { erro: null, mensagem: mensagem.trim(), nota: notaNum, anonimo: ehAnonimo, instagramHandle: handle, autorizaRepost: repost };
}

// ── CATALOGADOR IA ─────────────────────────────────────────────
// Ferramenta de processamento em lote — identificação de bandas via IA.
// Todas as rotas herdadas pelo requireAuth do sistema principal.
// Requer: GROQ_API_KEY no .env  |  npm install groq-sdk
// Limite generoso (mesma faixa do uploadLimiter): uso é um lote manual de uma
// pessoa só, mas a rota fica exposta e chama uma API paga por token, então
// precisa de defesa própria em vez de herdar o limite de outra rota.
const catalogadorLimiter = rateLimit({
    windowMs: 60 * 1000, max: 100,
    message: { error: 'Muitas requisições ao Catalogador. Espere um momento.' },
    standardHeaders: true, legacyHeaders: false
});
const catalogadorRouter = require('./catalogador-router');
const { criarAdapter }  = require('./tripvisuals-adapter');
catalogadorRouter.setPool(pool); // reaproveita o pool já existente, não abre outro
catalogadorRouter.setCloudinary({
    upload:  uploadToCloudinary,
    destroy: publicId => cloudinary.uploader.destroy(publicId),
});
catalogadorRouter.setAdapter(criarAdapter({
    pool, cloudTransform, TRANSFORM_PRODUCT, registrarEvento,
}));
app.use('/api/catalogador', requireAuth, catalogadorLimiter, catalogadorRouter);

// ════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════

app.get('/api/produtos', async (req, res) => {
    try {
        // Check if requester has a valid admin session
        const cookie = req.headers.cookie || '';
        const m = cookie.match(/vztoken=([^;]+)/);
        let isAdmin = false;
        if (m) {
            try {
                const tokenRow = await pool.query(
                    'SELECT 1 FROM sessoes WHERE token = $1 AND expira_em > NOW()',
                    [decodeURIComponent(m[1])]);
                isAdmin = tokenRow.rows.length > 0;
            } catch (_) { /* fail closed: treat as public */ }
        }
        const sql = isAdmin
            ? 'SELECT id, nome, preco, imagem_url, cor, oculto, tipo, genero, banda, categoria, criado_em, destaque, descricao, cliques FROM produtos ORDER BY destaque DESC, id DESC'
            // [VZ] criado_em e cliques expostos publicamente a partir daqui —
            // alimentam as seções "Novidades" e "Mais Procurados" da tela de
            // overview do catálogo (ver renderOverview em catalogo.js). Nenhum
            // dado sensível: são só metadados do próprio produto já visível.
            : 'SELECT id, nome, preco, imagem_url, cor, tipo, genero, categoria, destaque, descricao, criado_em, cliques FROM produtos WHERE oculto = false ORDER BY destaque DESC, id DESC';
        const r = await pool.query(sql);
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

    let ok = false;
    if (process.env.ADMIN_PASSWORD_HASH) {
        // bcrypt.compare já é internamente resistente a timing attack —
        // não precisa (e não deve) envolver timingSafeStringCompare aqui.
        ok = await bcrypt.compare(senha, process.env.ADMIN_PASSWORD_HASH).catch(() => false);
    } else if (process.env.ADMIN_PASSWORD) {
        ok = timingSafeStringCompare(senha, process.env.ADMIN_PASSWORD);
    }

    if (ok) {
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
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/vztoken=([^;]+)/);
    const token = m ? decodeURIComponent(m[1]) : null;
    await dbDeleteSession(token).catch(() => {});
    clearSessionCookie(res);
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/vztoken=([^;]+)/);
    const token = m ? decodeURIComponent(m[1]) : null;
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
    const cor    = typeof req.body.cor    === 'string' ? req.body.cor.trim().slice(0, 50) : '';
    const tipo   = typeof req.body.tipo   === 'string' ? req.body.tipo.trim().slice(0, 30)  : 'Camiseta';
    const genero   = typeof req.body.genero   === 'string' ? req.body.genero.trim().slice(0, 50)  : '';
    const banda    = typeof req.body.banda    === 'string' ? req.body.banda.trim().slice(0, 80)   : '';
    const categoria= normalizarCategoria(req.body.categoria);
    const destaque = req.body.destaque === true || req.body.destaque === 'true';
    const descricao= typeof req.body.descricao=== 'string' ? req.body.descricao.trim().slice(0, 500) : '';
    try {
        let imagem_url = '', cloudinary_id = '';
        if (req.file) {
            // Binary content check — defense beyond browser-supplied MIME
            const detected = detectImageType(req.file.buffer);
            if (!detected) {
                return res.status(400).json({ error: 'Arquivo enviado não é uma imagem válida (JPG, PNG ou WebP).' });
            }
            const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_').slice(0, 60);
            const result = await uploadToCloudinary(req.file.buffer, Date.now() + '_' + baseName);
            imagem_url   = cloudTransform(result.url, TRANSFORM_PRODUCT);
            cloudinary_id = result.public_id;
        }
        const r = await pool.query(
            `INSERT INTO produtos (nome, preco, imagem_url, cloudinary_id, cor, tipo, genero, banda, categoria, destaque, descricao, busca_tsv)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                     to_tsvector('portuguese', $1 || ' ' || $5 || ' ' || $6 || ' ' || $7))
             RETURNING id`,
            [nome.trim(), parseFloat(preco), imagem_url, cloudinary_id, cor, tipo, genero, banda, categoria, destaque, descricao]);
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
    const cor    = typeof req.body.cor    === 'string' ? req.body.cor.trim().slice(0, 50)  : '';
    const tipo   = typeof req.body.tipo   === 'string' ? req.body.tipo.trim().slice(0, 30)   : '';
    const genero   = typeof req.body.genero   === 'string' ? req.body.genero.trim().slice(0, 50) : '';
    const banda    = typeof req.body.banda    === 'string' ? req.body.banda.trim().slice(0, 80)  : '';
    const categoria= normalizarCategoria(req.body.categoria);
    const destaque = req.body.destaque === true || req.body.destaque === 'true';
    const descricao= typeof req.body.descricao=== 'string' ? req.body.descricao.trim().slice(0, 500) : '';
    try {
        const r = await pool.query(
            'UPDATE produtos SET nome=$1, preco=$2, cor=$3, tipo=$4, genero=$5, banda=$6, categoria=$7, destaque=$8, descricao=$9 WHERE id=$10',
            [nome.trim(), parseFloat(preco), cor, tipo || 'Camiseta', genero, banda, categoria, destaque, descricao, id]);
        // Update full-text search vector
        await pool.query("UPDATE produtos SET busca_tsv = to_tsvector('portuguese', COALESCE(nome,'') || ' ' || COALESCE(cor,'') || ' ' || COALESCE(tipo,'') || ' ' || COALESCE(genero,'')) WHERE id = $1", [id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao atualizar produto.' });
    }
});


// ── CLICK COUNTER (public, rate-limited) ─────────────────────
const clickLimiter = rateLimit({ windowMs: 60000, max: 30, message: { error: 'Rate limit.' } });
app.post('/api/produtos/:id/click', clickLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await pool.query('UPDATE produtos SET cliques = cliques + 1 WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (_) { res.status(500).json({ error: 'Erro.' }); }
});

// ── DUPLICATE PRODUCT ────────────────────────────────────────
app.post('/api/produtos/:id/duplicate', requireAuth, writeLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const orig = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);
        if (orig.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        const p = orig.rows[0];
        const r = await pool.query(
            `INSERT INTO produtos (nome, preco, imagem_url, cloudinary_id, cor, tipo, genero, banda, categoria, destaque, descricao)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10) RETURNING id`,
            [p.nome + ' (Cópia)', p.preco, p.imagem_url, '', p.cor, p.tipo, p.genero, p.banda, p.categoria, p.descricao]);
        res.status(201).json({ id: r.rows[0].id });
    } catch (e) {
        console.error('POST duplicate:', e.message);
        res.status(500).json({ error: 'Erro ao duplicar.' });
    }
});

// ── BULK VISIBILITY ──────────────────────────────────────────
app.patch('/api/produtos/bulk-visibility', requireAuth, writeLimiter, async (req, res) => {
    const { ids, oculto } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'IDs obrigatórios.' });
    if (typeof oculto !== 'boolean') return res.status(400).json({ error: 'oculto deve ser booleano.' });
    const safeIds = ids.filter(id => Number.isInteger(id) && id > 0);
    if (safeIds.length === 0) return res.status(400).json({ error: 'Nenhum ID válido.' });
    try {
        await pool.query(
            'UPDATE produtos SET oculto = $1 WHERE id = ANY($2::int[])',
            [oculto, safeIds]);
        res.json({ success: true, affected: safeIds.length });
    } catch (e) {
        console.error('PATCH bulk-visibility:', e.message);
        res.status(500).json({ error: 'Erro ao alterar visibilidade em lote.' });
    }
});

// ── BULK FIELD UPDATE (Fase 3) ────────────────────────────────
// Só permite os três campos abaixo. Nunca preço ou nome — sobrescrever o
// mesmo preço ou nome em vários produtos de uma vez quase nunca é o que a
// pessoa quer, e um erro de filtro aqui teria efeito muito mais silencioso
// que ocultar/mostrar (que é óbvio e reversível de imediato).
const BULK_CAMPOS_PERMITIDOS = ['genero', 'tipo', 'banda', 'categoria'];
app.patch('/api/produtos/bulk-campo', requireAuth, writeLimiter, async (req, res) => {
    const { ids, campo, valor } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'IDs obrigatórios.' });
    if (!BULK_CAMPOS_PERMITIDOS.includes(campo)) return res.status(400).json({ error: 'Campo não permitido para edição em massa.' });
    if (typeof valor !== 'string' || !valor.trim()) return res.status(400).json({ error: 'Valor obrigatório.' });
    if (campo === 'categoria' && !CATEGORIAS_VALIDAS.includes(valor.trim())) {
        return res.status(400).json({ error: 'Categoria inválida.' });
    }
    const safeIds = ids.filter(id => Number.isInteger(id) && id > 0);
    if (safeIds.length === 0) return res.status(400).json({ error: 'Nenhum ID válido.' });
    const valorFinal = valor.trim().slice(0, 80);

    try {
        const antes = await pool.query(
            `SELECT id, ${campo} AS valor_anterior FROM produtos WHERE id = ANY($1::int[])`,
            [safeIds]);

        await pool.query(
            `UPDATE produtos SET ${campo} = $1 WHERE id = ANY($2::int[])`,
            [valorFinal, safeIds]);

        // busca_tsv só depende de tipo/genero hoje, não de banda.
        if (campo === 'tipo' || campo === 'genero') {
            await pool.query(
                `UPDATE produtos SET busca_tsv = to_tsvector('portuguese',
                    COALESCE(nome,'') || ' ' || COALESCE(cor,'') || ' ' || COALESCE(tipo,'') || ' ' || COALESCE(genero,''))
                 WHERE id = ANY($1::int[])`,
                [safeIds]);
        }

        const eventoId = await registrarEvento(pool, {
            modulo:     'produtos',
            tipo:       'edicao_em_massa',
            resumo:     `Campo "${campo}" alterado para "${valorFinal}" em ${safeIds.length} produto(s).`,
            detalhes:   { campo, valorNovo: valorFinal, ids: safeIds, valoresAnteriores: antes.rows },
        });

        res.json({ success: true, affected: safeIds.length, eventoId });
    } catch (e) {
        console.error('PATCH bulk-campo:', e.message);
        res.status(500).json({ error: 'Erro na operação em lote.' });
    }
});

// ── DESFAZER EDIÇÃO EM MASSA ──────────────────────────────────
// "Inteligente": só reverte produtos cujo valor atual ainda é o mesmo que
// a edição em massa definiu. Se alguém editou manualmente um produto
// específico depois da edição em massa, esse produto é pulado — desfazer
// não pode sobrescrever uma mudança mais nova sem avisar.
app.post('/api/produtos/bulk-campo/desfazer/:eventoId', requireAuth, writeLimiter, async (req, res) => {
    const eventoId = parseInt(req.params.eventoId, 10);
    if (!Number.isInteger(eventoId)) return res.status(400).json({ error: 'ID de evento inválido.' });

    try {
        const evRes = await pool.query(`SELECT * FROM system_events WHERE id = $1`, [eventoId]);
        const evento = evRes.rows[0];
        if (!evento || evento.tipo !== 'edicao_em_massa') {
            return res.status(404).json({ error: 'Evento de edição em massa não encontrado.' });
        }
        const detalhes = evento.detalhes || {};
        if (detalhes.desfeito) {
            return res.status(409).json({ error: 'Essa edição em massa já foi desfeita antes.' });
        }
        const { campo, valorNovo, valoresAnteriores } = detalhes;
        if (!BULK_CAMPOS_PERMITIDOS.includes(campo) || !Array.isArray(valoresAnteriores)) {
            return res.status(400).json({ error: 'Evento sem dados suficientes para desfazer.' });
        }

        let revertidos = 0, ignorados = 0;
        for (const { id, valor_anterior } of valoresAnteriores) {
            const atualRes = await pool.query(`SELECT ${campo} AS valor_atual FROM produtos WHERE id = $1`, [id]);
            const valorAtual = atualRes.rows[0]?.valor_atual;
            if (valorAtual === undefined) { ignorados++; continue; } // produto foi removido depois
            if (valorAtual !== valorNovo) { ignorados++; continue; } // já foi editado de novo, não mexe
            await pool.query(`UPDATE produtos SET ${campo} = $1 WHERE id = $2`, [valor_anterior, id]);
            revertidos++;
        }

        if (revertidos > 0 && (campo === 'tipo' || campo === 'genero')) {
            const idsRevertidos = valoresAnteriores.map(v => v.id);
            await pool.query(
                `UPDATE produtos SET busca_tsv = to_tsvector('portuguese',
                    COALESCE(nome,'') || ' ' || COALESCE(cor,'') || ' ' || COALESCE(tipo,'') || ' ' || COALESCE(genero,''))
                 WHERE id = ANY($1::int[])`,
                [idsRevertidos]);
        }

        await pool.query(
            `UPDATE system_events SET detalhes = detalhes || '{"desfeito": true}'::jsonb WHERE id = $1`,
            [eventoId]);

        await registrarEvento(pool, {
            modulo:     'produtos',
            tipo:       'edicao_em_massa_desfeita',
            resumo:     `Edição em massa de "${campo}" desfeita: ${revertidos} produto(s) revertido(s), ${ignorados} ignorado(s) (já tinham mudado de novo).`,
            detalhes:   { eventoOriginalId: eventoId, campo, revertidos, ignorados },
        });

        res.json({ success: true, revertidos, ignorados });
    } catch (e) {
        console.error('POST bulk-campo/desfazer:', e.message);
        res.status(500).json({ error: 'Erro ao desfazer edição em massa.' });
    }
});

// ── FRETE POR REGIÃO (Fase 7) ─────────────────────────────────
// Pública: qualquer visitante do catálogo pode calcular. Rate limit
// próprio porque bate na ViaCEP a cada chamada sem cache.
const freteLimiter = rateLimit({
    windowMs: 60 * 1000, max: 30,
    message: { error: 'Muitas consultas de frete. Espere um momento.' },
    standardHeaders: true, legacyHeaders: false
});
app.get('/api/frete', freteLimiter, async (req, res) => {
    try {
        const resultado = await frete.calcularFrete(pool, req.query.cep);
        res.json(resultado);
    } catch (e) {
        console.error('GET /api/frete:', e.message);
        res.status(500).json({ error: 'Erro ao calcular frete.' });
    }
});

// Admin: gerenciar os valores por região
app.get('/api/frete/regioes', requireAuth, async (req, res) => {
    try {
        res.json(await frete.listarRegioes(pool));
    } catch (e) {
        console.error('GET /api/frete/regioes:', e.message);
        res.status(500).json({ error: 'Erro ao buscar regiões.' });
    }
});

const UFS_VALIDAS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
app.put('/api/frete/regioes/:uf', requireAuth, writeLimiter, async (req, res) => {
    const uf = String(req.params.uf || '').toUpperCase();
    if (!UFS_VALIDAS.has(uf)) return res.status(400).json({ error: 'UF inválida.' });
    const valor = parseFloat(req.body.valor);
    const prazoDias = parseInt(req.body.prazoDias, 10);
    if (!Number.isFinite(valor) || valor < 0 || valor > 9999) return res.status(400).json({ error: 'Valor de frete inválido.' });
    if (!Number.isInteger(prazoDias) || prazoDias < 1 || prazoDias > 90) return res.status(400).json({ error: 'Prazo inválido.' });
    try {
        const anterior = await frete.listarRegioes(pool).then(rs => rs.find(r => r.uf === uf) || null);
        await frete.definirRegiao(pool, uf, valor, prazoDias);
        registrarEvento(pool, {
            modulo: 'frete', tipo: 'regiao_definida', severidade: 'info',
            resumo: `Frete de ${uf} definido: R$ ${valor.toFixed(2)}, ${prazoDias} dia(s)`,
            detalhes: { uf, valorNovo: valor, prazoDiasNovo: prazoDias, valorAnterior: anterior?.valor ?? null, prazoDiasAnterior: anterior?.prazo_dias ?? null },
        });
        res.json({ success: true, uf, valor, prazoDias });
    } catch (e) {
        console.error('PUT /api/frete/regioes:', e.message);
        res.status(500).json({ error: 'Erro ao salvar região.' });
    }
});

app.delete('/api/frete/regioes/:uf', requireAuth, writeLimiter, async (req, res) => {
    const uf = String(req.params.uf || '').toUpperCase();
    try {
        const anterior = await frete.listarRegioes(pool).then(rs => rs.find(r => r.uf === uf) || null);
        await frete.removerRegiao(pool, uf);
        registrarEvento(pool, {
            modulo: 'frete', tipo: 'regiao_removida', severidade: 'info',
            resumo: `Frete de ${uf} removido — volta a ser combinado pelo WhatsApp`,
            detalhes: { uf, valorAnterior: anterior?.valor ?? null, prazoDiasAnterior: anterior?.prazo_dias ?? null },
        });
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/frete/regioes:', e.message);
        res.status(500).json({ error: 'Erro ao remover região.' });
    }
});

// ── FULL-TEXT SEARCH ─────────────────────────────────────────
app.get('/api/produtos/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);
    try {
        const r = await pool.query(
            `SELECT id, nome, preco, imagem_url, cor, tipo, genero, categoria, destaque, descricao
             FROM produtos WHERE oculto = false AND busca_tsv @@ plainto_tsquery('portuguese', $1)
             ORDER BY ts_rank(busca_tsv, plainto_tsquery('portuguese', $1)) DESC LIMIT 50`,
            [q]);
        res.json(r.rows);
    } catch (e) {
        console.error('GET /api/produtos/search:', e.message);
        res.status(500).json({ error: 'Erro na busca.' });
    }
});

// ── PRODUCT GALLERY — additional photos ──────────────────────
app.get('/api/produtos/:id/fotos', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.json([]);
    try {
        const r = await pool.query(
            'SELECT id, url, posicao, papel FROM produto_fotos WHERE produto_id = $1 ORDER BY posicao', [id]);
        res.json(r.rows);
    } catch (_) { res.json([]); }
});

app.post('/api/produtos/:id/fotos', requireAuth, uploadLimiter, upload.single('imagem'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória.' });
    const detected = detectImageType(req.file.buffer);
    if (!detected) return res.status(400).json({ error: 'Arquivo não é uma imagem válida.' });
    const papel = normalizarPapelFoto(req.body.papel);
    try {
        const result = await uploadToCloudinary(req.file.buffer, Date.now() + '_extra_' + id);
        const url = cloudTransform(result.url, TRANSFORM_PRODUCT);
        const posCount = await pool.query('SELECT COUNT(*) FROM produto_fotos WHERE produto_id = $1', [id]);
        const pos = parseInt(posCount.rows[0].count, 10);
        const r = await pool.query(
            'INSERT INTO produto_fotos (produto_id, url, cloudinary_id, posicao, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id, url, posicao, papel',
            [id, url, result.public_id, pos, papel]);
        res.status(201).json(r.rows[0]);
    } catch (e) {
        console.error('POST fotos:', e.message);
        res.status(500).json({ error: 'Erro ao adicionar foto.' });
    }
});

// [VZ] Reordenar e/ou trocar o papel de uma foto já existente — usado pelo
// assistente de captura (reordenar sequência de ângulos) e pra corrigir um
// papel errado sem precisar apagar/reenviar a foto.
app.patch('/api/produtos/:id/fotos/:fotoId', requireAuth, writeLimiter, async (req, res) => {
    const pid = parseInt(req.params.id, 10);
    const fid = parseInt(req.params.fotoId, 10);
    if (!Number.isInteger(pid) || !Number.isInteger(fid)) return res.status(400).json({ error: 'ID inválido.' });
    const temPosicao = req.body.posicao !== undefined;
    const temPapel = req.body.papel !== undefined;
    if (!temPosicao && !temPapel) return res.status(400).json({ error: 'Nada pra atualizar (envie posicao e/ou papel).' });
    const posicao = temPosicao ? parseInt(req.body.posicao, 10) : null;
    if (temPosicao && (!Number.isInteger(posicao) || posicao < 0)) return res.status(400).json({ error: 'Posição inválida.' });
    const papel = temPapel ? normalizarPapelFoto(req.body.papel) : null;
    try {
        const r = await pool.query(
            `UPDATE produto_fotos SET
                posicao = COALESCE($3, posicao),
                papel = COALESCE($4, papel)
             WHERE id = $1 AND produto_id = $2
             RETURNING id, url, posicao, papel`,
            [fid, pid, posicao, papel]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Foto não encontrada.' });
        res.json(r.rows[0]);
    } catch (e) {
        console.error('PATCH fotos:', e.message);
        res.status(500).json({ error: 'Erro ao atualizar foto.' });
    }
});

app.delete('/api/produtos/:id/fotos/:fotoId', requireAuth, writeLimiter, async (req, res) => {
    const pid = parseInt(req.params.id, 10);
    const fid = parseInt(req.params.fotoId, 10);
    if (!Number.isInteger(pid) || !Number.isInteger(fid)) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const r = await pool.query('DELETE FROM produto_fotos WHERE id = $1 AND produto_id = $2 RETURNING cloudinary_id', [fid, pid]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Foto não encontrada.' });
        if (r.rows[0].cloudinary_id) {
            cloudinary.uploader.destroy(r.rows[0].cloudinary_id).catch(() => {});
        }
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE fotos:', e.message);
        res.status(500).json({ error: 'Erro ao remover foto.' });
    }
});

// ── PEDIDOS CSV EXPORT ───────────────────────────────────────
app.get('/api/pedidos/export', requireAuth, exportLimiter, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM pedidos ORDER BY criado_em DESC');
        const rows = r.rows;
        if (rows.length === 0) return res.status(200).send('Nenhum pedido.');
        // [VZ] Fase 10 — neutraliza injeção de fórmula: campo de texto livre
        // (nome, notas) que comece com =, +, -, @ ou tab/CR é interpretado
        // como fórmula por Excel/Sheets ao abrir o CSV, o que pode rodar
        // comando ou vazar dado. Um apóstrofo na frente força "texto puro",
        // sem mudar o que a pessoa vê na célula.
        const csvSafe = v => {
            const s = String(v ?? '');
            return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
        };
        const header = 'ID,Produto,Valor,Tamanho,Cliente,WhatsApp,Notas,Status,Data\n';
        const csv = header + rows.map(p =>
            [p.id, '"'+csvSafe(p.produto_nome).replace(/"/g,'""')+'"',
             p.valor || '', p.tamanho || '',
             '"'+csvSafe(p.cliente_nome).replace(/"/g,'""')+'"',
             '"'+csvSafe(p.cliente_whatsapp).replace(/"/g,'""')+'"',
             '"'+csvSafe(p.notas).replace(/"/g,'""')+'"',
             p.status,
             new Date(p.criado_em).toISOString().slice(0,10)
            ].join(',')
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="pedidos-tripvisuals.csv"');
        res.send(csv);
    } catch (e) {
        console.error('GET /api/pedidos/export:', e.message);
        res.status(500).json({ error: 'Erro ao exportar.' });
    }
});

app.patch('/api/produtos/:id/visibility', requireAuth, writeLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    const { oculto } = req.body;
    if (typeof oculto !== 'boolean') return res.status(400).json({ error: 'Campo "oculto" deve ser booleano.' });
    try {
        const r = await pool.query(
            'UPDATE produtos SET oculto = $1 WHERE id = $2',
            [oculto, id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        res.json({ success: true, oculto });
    } catch (e) {
        console.error('PATCH /api/produtos/:id/visibility:', e.message);
        res.status(500).json({ error: 'Erro ao alterar visibilidade.' });
    }
});


// ── PEDIDOS (order tracking) ─────────────────────────────
// ── EVENTOS / AUDITORIA (Fase 4) ──────────────────────────────
app.get('/api/eventos', requireAuth, async (req, res) => {
    try {
        const limite = parseInt(req.query.limite, 10) || 15;
        const modulo = typeof req.query.modulo === 'string' && req.query.modulo ? req.query.modulo : null;
        const rows = await listarEventos(pool, { limite, modulo });
        res.json(rows);
    } catch (e) {
        console.error('GET /api/eventos:', e.message);
        res.status(500).json({ error: 'Erro ao buscar eventos.' });
    }
});

// Exportação sob demanda: roda a query na hora, não existe tabela de
// snapshot pra manter. Reaproveita o mesmo limitador do export de pedidos.
app.get('/api/eventos/export', requireAuth, exportLimiter, async (req, res) => {
    try {
        const rows = await listarEventos(pool, { limite: 500 });
        const nomeArquivo = 'auditoria-tripvisuals-' + new Date().toISOString().slice(0, 10) + '.json';
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
        res.send(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error('GET /api/eventos/export:', e.message);
        res.status(500).json({ error: 'Erro ao exportar auditoria.' });
    }
});

// [VZ] Fase 15 — estatísticas do Hub. Direto de system_events, a mesma
// fonte da Atividade Recente — nenhuma métrica nova inventada, só
// agregação do que já é registrado. generate_series preenche dias/semanas
// sem atividade com zero, pra o gráfico não pular buraco (dia sem barra é
// diferente de dia sem dado coletado).
app.get('/api/hub/estatisticas', requireAuth, async (req, res) => {
    try {
        const [atividade, catalogador] = await Promise.all([
            pool.query(`
                SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia, COALESCE(COUNT(e.id), 0)::int AS total
                FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS d(dia)
                LEFT JOIN system_events e ON date_trunc('day', e.criado_em) = d.dia
                GROUP BY d.dia ORDER BY d.dia
            `),
            pool.query(`
                SELECT to_char(d.semana, 'YYYY-MM-DD') AS semana, COALESCE(COUNT(e.id), 0)::int AS total
                FROM generate_series(date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks', date_trunc('week', CURRENT_DATE), INTERVAL '1 week') AS d(semana)
                LEFT JOIN system_events e ON date_trunc('week', e.criado_em) = d.semana AND e.tipo = 'produto_criado_via_scanner'
                GROUP BY d.semana ORDER BY d.semana
            `),
        ]);
        res.json({
            atividadePorDia: atividade.rows,
            catalogadorPorSemana: catalogador.rows,
        });
    } catch (e) {
        console.error('GET /api/hub/estatisticas:', e.message);
        res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
    }
});

app.get('/api/pedidos', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM pedidos ORDER BY criado_em DESC');
        res.json(r.rows);
    } catch (e) {
        console.error('GET /api/pedidos:', e.message);
        res.status(500).json({ error: 'Erro ao buscar pedidos.' });
    }
});

// [VZ] E-mail é sempre opcional aqui — só valida formato quando alguém de
// fato digitou algo, nunca exige o campo. Regex simples de propósito,
// suficiente pra pegar erro de digitação óbvio sem rejeitar e-mail real.
function normalizarEmailOpcional(valor) {
    const limpo = String(valor || '').trim().slice(0, 200);
    if (!limpo) return { erro: null, email: '' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) return { erro: 'E-mail inválido.' };
    return { erro: null, email: limpo };
}

app.post('/api/pedidos', requireAuth, writeLimiter, async (req, res) => {
    const { produto_nome, valor, tamanho, cliente_nome, cliente_whatsapp, cliente_email, cep, notas, status } = req.body;
    if (!produto_nome || String(produto_nome).trim().length === 0)
        return res.status(400).json({ error: 'Nome do produto é obrigatório.' });
    const emailInfo = normalizarEmailOpcional(cliente_email);
    if (emailInfo.erro) return res.status(400).json({ error: emailInfo.erro });
    try {
        const r = await pool.query(
            `INSERT INTO pedidos (produto_nome, valor, tamanho, cliente_nome, cliente_whatsapp, cliente_email, cep, notas, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [String(produto_nome).trim().slice(0, 200),
             parseFloat(valor) || null,
             String(tamanho || '').trim().slice(0, 20),
             String(cliente_nome || '').trim().slice(0, 100),
             String(cliente_whatsapp || '').trim().slice(0, 30),
             emailInfo.email,
             String(cep || '').trim().slice(0, 9),
             String(notas || '').trim().slice(0, 1000),
             ['novo','confirmado','producao','enviado','entregue'].includes(status) ? status : 'novo']);
        const pedido = r.rows[0];
        res.status(201).json(pedido);
        // Best-effort, depois da resposta — nunca atrasa nem quebra a
        // criação do pedido por causa de um problema no envio do e-mail.
        pedidoNotify.notificarPedido(pool, registrarEvento, pedido, 'recebido').catch(() => {});
    } catch (e) {
        console.error('POST /api/pedidos:', e.message);
        res.status(500).json({ error: 'Erro ao criar pedido.' });
    }
});

app.put('/api/pedidos/:id', requireAuth, writeLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    const { produto_nome, valor, tamanho, cliente_nome, cliente_whatsapp, cliente_email, cep, notas, status } = req.body;
    if (!produto_nome || String(produto_nome).trim().length === 0)
        return res.status(400).json({ error: 'Nome do produto é obrigatório.' });
    const emailInfo = normalizarEmailOpcional(cliente_email);
    if (emailInfo.erro) return res.status(400).json({ error: emailInfo.erro });
    const novoStatus = ['novo','confirmado','producao','enviado','entregue'].includes(status) ? status : 'novo';
    try {
        // Status anterior primeiro — só notifica o cliente quando o status
        // de fato muda, não em toda edição (ex.: corrigir um preço não deve
        // gerar um e-mail de "atualização do pedido").
        const anterior = await pool.query('SELECT status FROM pedidos WHERE id = $1', [id]);
        if (!anterior.rows.length) return res.status(404).json({ error: 'Pedido não encontrado.' });
        const statusAnterior = anterior.rows[0].status;

        const r = await pool.query(
            `UPDATE pedidos SET produto_nome=$1, valor=$2, tamanho=$3,
              cliente_nome=$4, cliente_whatsapp=$5, cliente_email=$6, cep=$7, notas=$8, status=$9
             WHERE id=$10 RETURNING *`,
            [String(produto_nome).trim().slice(0, 200),
             parseFloat(valor) || null,
             String(tamanho || '').trim().slice(0, 20),
             String(cliente_nome || '').trim().slice(0, 100),
             String(cliente_whatsapp || '').trim().slice(0, 30),
             emailInfo.email,
             String(cep || '').trim().slice(0, 9),
             String(notas || '').trim().slice(0, 1000),
             novoStatus,
             id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
        const pedido = r.rows[0];
        res.json(pedido);
        if (novoStatus !== statusAnterior) {
            pedidoNotify.notificarPedido(pool, registrarEvento, pedido, 'status').catch(() => {});
        }
    } catch (e) {
        console.error('PUT /api/pedidos/:id:', e.message);
        res.status(500).json({ error: 'Erro ao atualizar pedido.' });
    }
});

app.delete('/api/pedidos/:id', requireAuth, writeLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const r = await pool.query('DELETE FROM pedidos WHERE id = $1', [id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/pedidos/:id:', e.message);
        res.status(500).json({ error: 'Erro ao remover pedido.' });
    }
});

// ── CONFERÊNCIA DE COMPROVANTE ASSISTIDA POR IA (Fase 8) ──────
// Caminho pensado especificamente pra quando o CNPJ ainda não libera o
// gateway automático: a loja recebe PIX na chave pessoal dela do jeito
// que já faz hoje, anexa o print aqui, e a IA só ajuda a conferir o
// valor — quem confirma o pagamento continua sendo sempre a pessoa, num
// clique à parte, nunca automático.
// [VZ] Fase 17 — criar pedido a partir de um comprovante, sem precisar de
// um pedido já existente. Reaproveita lerComprovante() e os mesmos campos
// de comprovante que a tela de edição já exibe — a confirmação de
// pagamento continua manual, mesmo padrão da Fase 8, nunca automática.
app.post('/api/pedidos/novo-via-comprovante', requireAuth, writeLimiter, upload.single('comprovante'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    try {
        const tipo = detectImageType(req.file.buffer);
        if (!tipo) return res.status(400).json({ error: 'Arquivo não é uma imagem válida (JPG, PNG ou WebP).' });

        const leitura = await lerComprovante({
            buffer:     req.file.buffer,
            mimeType:   'image/' + tipo,
            groqApiKey: process.env.GROQ_API_KEY,
            model:      process.env.CATALOGADOR_MODEL,
        });

        if (leitura.naoEComprovante) {
            return res.status(400).json({ error: 'Essa imagem não parece um comprovante de pagamento. Confira o arquivo antes de tentar de novo.' });
        }

        const baseName = 'comprovante_novo_' + Date.now();
        const enviado  = await uploadToCloudinary(req.file.buffer, baseName, 'tripvisuals/comprovantes');

        const nomeDetectado = leitura.nomePagador ? String(leitura.nomePagador).slice(0, 100) : '';

        const r = await pool.query(
            `INSERT INTO pedidos
                (produto_nome, valor, cliente_nome, status,
                 comprovante_url, comprovante_valor_detectado, comprovante_analisado_em)
             VALUES ($1,$2,$3,'novo',$4,$5,NOW())
             RETURNING id`,
            ['(preencher produto)', leitura.valor, nomeDetectado, enviado.url, leitura.valor]
        );
        const pedidoId = r.rows[0].id;

        await registrarEvento(pool, {
            modulo:     'pedidos',
            tipo:       'pedido_criado_via_comprovante',
            severidade: 'info',
            resumo:     `Pedido #${pedidoId} criado a partir de comprovante — falta revisar produto, tamanho e confirmar pagamento.`,
            detalhes:   { pedidoId, ...leitura, comprovanteUrl: enviado.url },
        });

        res.status(201).json({ pedidoId, ...leitura, comprovanteUrl: enviado.url });
    } catch (err) {
        console.error('POST /pedidos/novo-via-comprovante:', err.message);
        res.status(err.status || 500).json({ error: err.message || 'Erro ao processar comprovante.' });
    }
});


app.post('/api/pedidos/:id/comprovante', requireAuth, writeLimiter, upload.single('comprovante'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    try {
        const pedidoRes = await pool.query('SELECT valor FROM pedidos WHERE id = $1', [id]);
        if (!pedidoRes.rows.length) return res.status(404).json({ error: 'Pedido não encontrado.' });
        const valorEsperado = Number(pedidoRes.rows[0].valor);

        const tipo = detectImageType(req.file.buffer);
        if (!tipo) return res.status(400).json({ error: 'Arquivo não é uma imagem válida (JPG, PNG ou WebP).' });

        const leitura = await lerComprovante({
            buffer:     req.file.buffer,
            mimeType:   'image/' + tipo,
            groqApiKey: process.env.GROQ_API_KEY,
            model:      process.env.CATALOGADOR_MODEL,
        });

        const baseName = 'comprovante_pedido_' + id + '_' + Date.now();
        const enviado = await uploadToCloudinary(req.file.buffer, baseName, 'tripvisuals/comprovantes');

        await pool.query(
            `UPDATE pedidos SET comprovante_url = $1, comprovante_valor_detectado = $2, comprovante_analisado_em = NOW()
             WHERE id = $3`,
            [enviado.url, leitura.valor, id]
        );

        const confere = leitura.valor != null && Math.abs(leitura.valor - valorEsperado) < 0.01;

        await registrarEvento(pool, {
            modulo:     'pedidos',
            tipo:       'comprovante_analisado',
            severidade: leitura.naoEComprovante || leitura.erroLeitura ? 'erro' : (confere ? 'sucesso' : 'info'),
            resumo:     `Comprovante do pedido #${id} analisado: ${leitura.valor != null ? 'R$ ' + leitura.valor.toFixed(2) + ' lido' : 'valor não identificado'}, esperado R$ ${valorEsperado.toFixed(2)}.`,
            detalhes:   { pedidoId: id, ...leitura, valorEsperado, confere },
        });

        res.json({ ...leitura, valorEsperado, confere, comprovanteUrl: enviado.url });
    } catch (err) {
        console.error('POST /comprovante:', err.message);
        res.status(err.status || 500).json({ error: err.message || 'Erro ao analisar comprovante.' });
    }
});

// Confirmar pagamento é sempre um ato manual e separado da leitura da IA,
// de propósito — a leitura só embasa a decisão, nunca decide sozinha.
app.post('/api/pedidos/:id/confirmar-pagamento', requireAuth, writeLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    try {
        // Estado anterior primeiro, só pra saber se isso é uma confirmação
        // nova (dispara e-mail) ou um reenvio idempotente do mesmo clique
        // (não dispara de novo) — o comportamento da rota em si (sempre
        // succeed) continua igual ao de antes, intencionalmente.
        const antes = await pool.query('SELECT payment_status FROM pedidos WHERE id = $1', [id]);
        if (!antes.rows.length) return res.status(404).json({ error: 'Pedido não encontrado.' });
        const jaEstavaPago = antes.rows[0].payment_status === 'pago';

        const r = await pool.query(
            `UPDATE pedidos SET payment_status = 'pago', status = 'confirmado' WHERE id = $1 RETURNING *`,
            [id]);
        const pedido = r.rows[0];

        await registrarEvento(pool, {
            modulo:   'pedidos',
            tipo:     'pagamento_confirmado_manual',
            resumo:   `Pagamento do pedido #${id} confirmado manualmente após conferência de comprovante.`,
            detalhes: { pedidoId: id },
        });

        res.json({ success: true });
        if (!jaEstavaPago) pedidoNotify.notificarPedido(pool, registrarEvento, pedido, 'status').catch(() => {});
    } catch (e) {
        console.error('POST /confirmar-pagamento:', e.message);
        res.status(500).json({ error: 'Erro ao confirmar pagamento.' });
    }
});

// ════════════════════════════════════════════════════════════
// [VZ] CHECKOUT AUTOMÁTICO (PIX via Asaas)
//
// Gated behind 'checkout_automatico_enabled' in configuracoes,
// which defaults to 'false'. Until the owner's CNPJ is approved
// and ASAAS_API_KEY is set in Railway, /api/checkout/pix returns
// 503 and the catalog falls back to the existing WhatsApp flow —
// nothing about the current customer experience changes until
// this is deliberately turned on. See ATIVACAO_PAGAMENTOS.md.
// ════════════════════════════════════════════════════════════

async function checkoutHabilitado() {
    const r = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'checkout_automatico_enabled'");
    return r.rows[0] && r.rows[0].valor === 'true';
}

// Public — lets the catalog know whether to offer "Pagar com PIX"
// or fall back to the WhatsApp-only flow.
app.get('/api/checkout/status', async (req, res) => {
    try {
        const enabled = await checkoutHabilitado() && asaas.isConfigured();
        res.json({ enabled });
    } catch (e) {
        res.json({ enabled: false });
    }
});

app.post('/api/checkout/pix', checkoutLimiter, async (req, res) => {
    try {
        if (!(await checkoutHabilitado()) || !asaas.isConfigured()) {
            return res.status(503).json({
                error: 'Pagamento automático ainda não disponível. Finalize pelo WhatsApp.'
            });
        }
    } catch (e) {
        return res.status(503).json({ error: 'Pagamento automático indisponível.' });
    }

    const { produto_id, cliente_nome, cliente_whatsapp, tamanho, cpfCnpj } = req.body || {};
    if (typeof cliente_whatsapp !== 'string' || cliente_whatsapp.trim().length < 8)
        return res.status(400).json({ error: 'WhatsApp do cliente é obrigatório.' });
    const cpfDigits = String(cpfCnpj || '').replace(/\D/g, '');
    if (!validarCpfCnpj(cpfDigits))
        return res.status(400).json({ error: 'CPF/CNPJ inválido.' });

    // [VZ SECURITY] The price is NEVER taken from the request body — a client
    // could otherwise edit it in devtools and pay R$0.01 for a real product.
    // produto_id is mandatory and the price is looked up server-side, from
    // the same source of truth the public catalog itself reads from.
    const pid = parseInt(produto_id, 10);
    if (!Number.isInteger(pid) || pid < 1)
        return res.status(400).json({ error: 'Produto inválido.' });

    let produtoNome, valorNum, produtoCategoria;
    try {
        const pr = await pool.query('SELECT nome, preco, categoria FROM produtos WHERE id = $1 AND oculto = false', [pid]);
        if (!pr.rows.length) return res.status(404).json({ error: 'Produto não encontrado ou indisponível.' });
        produtoNome      = pr.rows[0].nome;
        valorNum         = Number(pr.rows[0].preco);
        produtoCategoria = pr.rows[0].categoria || 'vestuario';
    } catch (e) {
        console.error('POST /api/checkout/pix produto lookup:', e.message);
        return res.status(500).json({ error: 'Erro ao verificar produto.' });
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
        return res.status(409).json({ error: 'Preço do produto inválido. Contate a loja.' });
    }

    // [VZ] Decor 3D não tem tamanho de vestuário — só exige P/M/G/GG/XG pra
    // categoria 'vestuario'. Precisa da categoria do produto (acima) antes de
    // validar, por isso esse bloco não pode vir antes do lookup no banco.
    let tamanhoFinal = '';
    if (produtoCategoria === 'decor3d') {
        tamanhoFinal = 'Único';
    } else {
        const TAMANHOS_VALIDOS = ['P', 'M', 'G', 'GG', 'XG'];
        if (!TAMANHOS_VALIDOS.includes(tamanho))
            return res.status(400).json({ error: 'Selecione um tamanho válido.' });
        tamanhoFinal = tamanho;
    }

    try {
        const customerId = await asaas.criarOuBuscarCliente({
            nome: cliente_nome, whatsapp: cliente_whatsapp.trim(), cpfCnpj: cpfDigits
        });
        const cobranca = await asaas.criarCobrancaPix({
            customerId, valor: valorNum, descricao: produtoNome
        });

        const r = await pool.query(
            `INSERT INTO pedidos
                (produto_nome, valor, tamanho, cliente_nome, cliente_whatsapp, status,
                 payment_status, asaas_customer_id, asaas_payment_id,
                 pix_qr_code, pix_copia_cola, pix_expira_em)
             VALUES ($1,$2,$3,$4,$5,'novo','pendente',$6,$7,$8,$9,$10)
             RETURNING id`,
            [produtoNome, valorNum, tamanhoFinal.slice(0, 20),
             String(cliente_nome || '').slice(0, 100), cliente_whatsapp.trim(),
             customerId, cobranca.asaas_payment_id,
             cobranca.pix_qr_code, cobranca.pix_copia_cola, cobranca.pix_expira_em]);

        res.status(201).json({
            pedido_id: r.rows[0].id,
            pix_qr_code: cobranca.pix_qr_code,
            pix_copia_cola: cobranca.pix_copia_cola,
            pix_expira_em: cobranca.pix_expira_em
        });
    } catch (e) {
        console.error('POST /api/checkout/pix:', e.message);
        res.status(502).json({ error: 'Não foi possível gerar a cobrança PIX agora. Tente pelo WhatsApp.' });
    }
});

// Lightweight public polling endpoint — the catalog page checks this every
// few seconds while showing a QR code, to know when payment lands. Returns
// only the minimum needed, never the customer's WhatsApp/name/notes.
app.get('/api/pedidos/:id/status', clickLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const r = await pool.query('SELECT status, payment_status FROM pedidos WHERE id = $1', [id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Pedido não encontrado.' });
        res.json(r.rows[0]);
    } catch (e) {
        res.status(500).json({ error: 'Erro.' });
    }
});

// [VZ] Comparação em tempo constante — evita que um atacante infira o token
// correto medindo quanto tempo a comparação leva (mais rápido quebra antes,
// mais devagar bate mais caracteres antes de divergir). Buffers de tamanho
// diferente derrubariam o timingSafeEqual antes de chegar nessa proteção,
// então comparamos contra um buffer de zeros do mesmo tamanho do recebido
// só pra manter o tempo constante, e sempre retornamos false nesse caso.
function tokensCoincidem(recebido, esperado) {
    if (typeof recebido !== 'string' || typeof esperado !== 'string' || !recebido || !esperado) return false;
    const bufRecebido = Buffer.from(recebido);
    const bufEsperado = Buffer.from(esperado);
    if (bufRecebido.length !== bufEsperado.length) {
        crypto.timingSafeEqual(bufRecebido, Buffer.alloc(bufRecebido.length));
        return false;
    }
    return crypto.timingSafeEqual(bufRecebido, bufEsperado);
}

// Asaas webhook receiver. Every notification is logged BEFORE any processing
// is attempted, so a bug in our logic can never silently lose a payment event
// — worst case, it sits in webhook_log unprocessed and can be replayed by hand.
app.post('/api/webhook/asaas', webhookLimiter, async (req, res) => {
    const incomingToken = req.headers['asaas-access-token'];
    const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;

    let logId = null;
    try {
        const logged = await pool.query(
            `INSERT INTO webhook_log (provider, event_type, payload) VALUES ('asaas', $1, $2) RETURNING id`,
            [req.body && req.body.event || 'desconhecido', JSON.stringify(req.body || {})]);
        logId = logged.rows[0].id;
    } catch (e) {
        console.error('Webhook log insert failed:', e.message);
        // Even if logging fails, we still return 200 below if the token is
        // valid — Asaas pauses the whole queue after repeated non-2xx
        // responses, and a logging hiccup must not cascade into that.
    }

    // Verify authenticity. If no token is configured yet (CNPJ/Asaas not
    // activated), reject everything — there is nothing legitimate to receive.
    if (!tokensCoincidem(incomingToken, expectedToken)) {
        console.warn('Webhook Asaas rejeitado: token ausente ou inválido.');
        return res.status(401).json({ error: 'Token inválido.' });
    }

    try {
        const event = req.body && req.body.event;
        const payment = req.body && req.body.payment;
        if (asaas.EVENTOS_PAGAMENTO_CONFIRMADO.includes(event) && payment && payment.id) {
            const r = await pool.query(
                `UPDATE pedidos
                    SET payment_status = 'pago', status = 'confirmado'
                  WHERE asaas_payment_id = $1 AND payment_status != 'pago'
                  RETURNING *`,
                [payment.id]);
            if (r.rowCount === 0) {
                console.log(`Webhook ${event} para pagamento ${payment.id} — pedido não encontrado ou já processado.`);
            } else {
                // Best-effort — a WHERE acima já garante que isso só roda na
                // transição real pra 'pago', nunca em reentrega/retry do webhook.
                pedidoNotify.notificarPedido(pool, registrarEvento, r.rows[0], 'status').catch(() => {});
            }
        }
        if (logId) await pool.query('UPDATE webhook_log SET processado = true WHERE id = $1', [logId]);
        res.status(200).json({ received: true });
    } catch (e) {
        console.error('Webhook Asaas processing error:', e.message);
        if (logId) await pool.query('UPDATE webhook_log SET erro = $1 WHERE id = $2', [e.message.slice(0,500), logId]).catch(() => {});
        // Still 200 — Asaas treats anything else as a delivery failure and
        // will retry/pause the queue. The event is safely on disk in
        // webhook_log either way; an unprocessed row is recoverable, a
        // paused webhook queue from a transient DB hiccup is not.
        res.status(200).json({ received: true, processed: false });
    }
});

app.delete('/api/produtos/:id', requireAuth, writeLimiter, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const r = await pool.query('SELECT cloudinary_id, imagem_url FROM produtos WHERE id = $1', [id]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
        const row = r.rows[0];
        if (row.cloudinary_id) {
            await cloudinary.uploader.destroy(row.cloudinary_id).catch(err => console.error('Cloudinary destroy:', err.message));
        } else if (row.imagem_url && row.imagem_url.includes('cloudinary')) {
            const legacyId = 'tripvisuals/' + row.imagem_url.split('/').pop().split('.')[0];
            await cloudinary.uploader.destroy(legacyId).catch(err => console.error('Cloudinary destroy (legacy):', err.message));
        }
        await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/produtos:', e.message);
        res.status(500).json({ error: 'Erro ao remover produto.' });
    }
});

// [VZ SECURITY] Allowlist of every config key the app actually reads.
// Without this, a stolen session token could write arbitrary keys into
// configuracoes — harmless on its own (nothing reads an unknown key) but
// unnecessary surface area, and it makes the table impossible to audit.
const CONFIG_KEYS_PERMITIDAS = new Set([
    'layout_padrao', 'tema_admin', 'landing_theme',
    'landing_logo_url', 'landing_bg_color', 'landing_bg_image_url', 'landing_bg_position',
    'landing_title', 'landing_tagline', 'landing_instagram', 'landing_whatsapp',
    'about_visible', 'about_title', 'about_text', 'about_bg_color', 'about_bg_image_url',
    'howto_visible', 'howto_step_1', 'howto_step_2', 'howto_step_3', 'howto_step_4',
    // Página Sobre (nova — substituiu a seção inline da landing)
    'sobre_manifesto', 'sobre_historia', 'sobre_missao',
    'sobre_pilar1_titulo', 'sobre_pilar1_desc',
    'sobre_pilar2_titulo', 'sobre_pilar2_desc',
    'sobre_pilar3_titulo', 'sobre_pilar3_desc',
    'checkout_automatico_enabled'
]);

app.post('/api/config', requireAuth, writeLimiter, async (req, res) => {
    const { chave, valor } = req.body || {};
    if (typeof chave !== 'string' || !CONFIG_KEYS_PERMITIDAS.has(chave))
        return res.status(400).json({ error: 'Chave de configuração não reconhecida.' });
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

// [VZ] Feedback — POST é público (o cliente final do catálogo nunca
// faz login); GET e PUT exigem sessão de admin, igual ao resto do painel.
app.post('/api/feedback', feedbackLimiter, async (req, res) => {
    const v = validarFeedback({
        mensagem: req.body.mensagem,
        nota: req.body.nota,
        anonimo: req.body.anonimo,
        instagramHandle: req.body.instagramHandle,
        autorizaRepost: req.body.autorizaRepost
    });
    if (v.erro) return res.status(400).json({ error: v.erro });
    try {
        const r = await pool.query(
            `INSERT INTO feedbacks (mensagem, nota, anonimo, instagram_handle, autoriza_repost)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, mensagem, nota, anonimo, instagram_handle, autoriza_repost, status, criado_em`,
            [v.mensagem, v.nota, v.anonimo, v.instagramHandle, v.autorizaRepost]
        );
        const feedback = r.rows[0];
        await registrarEvento(pool, {
            modulo: 'feedback', tipo: 'recebido', severidade: 'info',
            resumo: 'Novo feedback recebido no catálogo.',
            detalhes: { id: feedback.id, nota: feedback.nota, anonimo: feedback.anonimo }
        });
        // Best-effort — nunca bloqueia nem falha a resposta ao cliente final
        // por causa de um problema no envio do e-mail de notificação.
        feedbackNotify.notificarNovoFeedback(pool, registrarEvento, feedback).catch(() => {});
        res.status(201).json({ success: true });
    } catch (e) {
        console.error('POST /api/feedback:', e.message);
        res.status(500).json({ error: 'Erro ao registrar feedback.' });
    }
});

app.get('/api/feedback', requireAuth, async (req, res) => {
    const status = FEEDBACK_STATUS_VALIDOS.includes(req.query.status) ? req.query.status : null;
    try {
        const { rows } = await pool.query(
            `SELECT id, mensagem, nota, anonimo, instagram_handle, autoriza_repost, status, criado_em
             FROM feedbacks
             ${status ? 'WHERE status = $1' : ''}
             ORDER BY criado_em DESC
             LIMIT 200`,
            status ? [status] : []
        );
        res.json(rows);
    } catch (e) {
        console.error('GET /api/feedback:', e.message);
        res.status(500).json({ error: 'Erro ao carregar feedbacks.' });
    }
});

app.put('/api/feedback/:id', requireAuth, writeLimiter, async (req, res) => {
    if (!FEEDBACK_STATUS_VALIDOS.includes(req.body.status))
        return res.status(400).json({ error: 'Status inválido.' });
    try {
        const r = await pool.query(
            `UPDATE feedbacks SET status = $1 WHERE id = $2 RETURNING id`,
            [req.body.status, req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Feedback não encontrado.' });
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/feedback/:id:', e.message);
        res.status(500).json({ error: 'Erro ao atualizar feedback.' });
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
    if (Sentry) Sentry.captureException(err);
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
