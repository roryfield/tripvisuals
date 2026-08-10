import { criarRelator, login, getBase } from '../lib/ctx.mjs';

export default async function run() {
    const r = criarRelator('Fase 4 — Dashboard (eventos, exportar auditoria)');
    const cookie = await login();

    const evRes = await fetch(`${getBase()}/api/eventos?limite=5`, { headers: { Cookie: cookie } });
    r.checar('GET /api/eventos responde 200', evRes.status === 200);
    const eventos = await evRes.json();
    r.checar('retorna uma lista', Array.isArray(eventos));

    const expRes = await fetch(`${getBase()}/api/eventos/export`, { headers: { Cookie: cookie } });
    r.checar('exportar auditoria responde 200', expRes.status === 200);
    r.checar('exportação vem como anexo pra download', (expRes.headers.get('content-disposition') || '').includes('attachment'));

    const semAuth = await fetch(`${getBase()}/api/eventos`);
    r.checar('sem login, /api/eventos bloqueia (401)', semAuth.status === 401);

    return r.total();
}
