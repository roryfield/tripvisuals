// [VZ] tests/lib/ctx.mjs — contexto compartilhado entre os casos de teste.
// Usa o pacote `pg` que o projeto já tem como dependência, não a ferramenta
// de linha de comando psql — assim a suíte roda em qualquer máquina que já
// rode o projeto, sem exigir mais nada instalado.
import pg from 'pg';

const { Pool } = pg;
export function getBase() {
    return process.env.TEST_BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
}

let pool = null;
export function getPool() {
    if (!pool) pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    return pool;
}
export async function fecharPool() {
    if (pool) { await pool.end(); pool = null; }
}
export async function query(sql, params) {
    const r = await getPool().query(sql, params);
    return r.rows;
}

// [VZ] Cacheia o cookie entre os arquivos de teste. O rate limiter de
// login (5 tentativas por 15 minutos) é uma proteção real do projeto —
// a suíte inteira deve logar uma vez só, não uma vez por fase testada.
let cookieCache = null;
export async function login(senha) {
    if (cookieCache) return cookieCache;
    try {
        const r = await fetch(`${getBase()}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha: senha || process.env.TEST_ADMIN_PASSWORD }),
        });
        cookieCache = (r.headers.get('set-cookie') || '').split(';')[0];
        return cookieCache;
    } catch (e) {
        console.error('DEBUG login() falhou:', e.message, e.cause);
        throw e;
    }
}

/** Cada arquivo de teste usa isto pra montar seu próprio relatório e devolver a contagem de falhas. */
export function criarRelator(nomeSuite) {
    let falhas = 0;
    console.log(`\n── ${nomeSuite} ──`);
    return {
        checar(nome, cond, extra = '') {
            console.log((cond ? '  OK   - ' : '  FALHA- ') + nome + (cond ? '' : ' ' + extra));
            if (!cond) falhas++;
        },
        total() { return falhas; },
    };
}
