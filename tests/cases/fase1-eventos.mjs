import { criarRelator, login, query, getBase } from '../lib/ctx.mjs';

export default async function run() {
    const r = criarRelator('Fase 1 — Fundação (system_events)');

    const tabela = await query("SELECT to_regclass('system_events') AS t");
    r.checar('tabela system_events existe', tabela[0]?.t === 'system_events');

    const cookie = await login();
    r.checar('login funciona (pré-requisito de quase tudo abaixo)', cookie.includes('vztoken'));

    // Gera um evento de verdade via uma ação que já sabemos que loga (bulk-campo em produtos)
    const prod = await fetch(`${getBase()}/api/produtos`, {
        method: 'POST', headers: { Cookie: cookie },
        body: (() => { const f = new FormData(); f.append('nome', 'PRODUTO TESTE FASE1'); f.append('preco', '10'); return f; })(),
    }).then(res => res.json());

    await fetch(`${getBase()}/api/produtos/bulk-campo`, {
        method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [prod.id], campo: 'genero', valor: 'Teste Fase 1' }),
    });

    const eventos = await query("SELECT tipo, modulo FROM system_events WHERE tipo = 'edicao_em_massa' ORDER BY id DESC LIMIT 1");
    r.checar('uma ação real gera uma linha em system_events', eventos.length === 1 && eventos[0].modulo === 'produtos', JSON.stringify(eventos));

    return r.total();
}
