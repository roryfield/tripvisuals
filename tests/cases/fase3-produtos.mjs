import { criarRelator, login, query, getBase } from '../lib/ctx.mjs';

export default async function run() {
    const r = criarRelator('Fase 3 — Produtos (banda, bulk-campo, desfazer)');
    const cookie = await login();

    async function criarProduto(nome, genero) {
        const f = new FormData();
        f.append('nome', nome); f.append('preco', '50'); f.append('genero', genero); f.append('banda', 'teste-banda');
        return fetch(`${getBase()}/api/produtos`, { method: 'POST', headers: { Cookie: cookie }, body: f }).then(res => res.json());
    }

    const p1 = await criarProduto('PRODUTO TESTE A', 'Original');
    const p2 = await criarProduto('PRODUTO TESTE B', 'Original');
    r.checar('produtos de teste criados com banda', !!p1.id && !!p2.id);

    const lista = await fetch(`${getBase()}/api/produtos`, { headers: { Cookie: cookie } }).then(res => res.json());
    const item1 = lista.find(p => p.id === p1.id);
    r.checar('GET /api/produtos retorna a coluna banda', item1?.banda === 'teste-banda', JSON.stringify(item1));

    const bulk = await fetch(`${getBase()}/api/produtos/bulk-campo`, {
        method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [p1.id, p2.id], campo: 'genero', valor: 'Editado em Massa' }),
    }).then(res => res.json());
    r.checar('bulk-campo afeta os dois produtos e retorna eventoId', bulk.affected === 2 && Number.isInteger(bulk.eventoId), JSON.stringify(bulk));

    // edita p2 manualmente depois da edição em massa
    await fetch(`${getBase()}/api/produtos/${p2.id}`, {
        method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'PRODUTO TESTE B', preco: 50, genero: 'Editado Depois', tipo: 'Camiseta' }),
    });

    const desfazer = await fetch(`${getBase()}/api/produtos/bulk-campo/desfazer/${bulk.eventoId}`, { method: 'POST', headers: { Cookie: cookie } }).then(res => res.json());
    r.checar('desfazer reverte 1 e ignora 1 (o editado depois)', desfazer.revertidos === 1 && desfazer.ignorados === 1, JSON.stringify(desfazer));

    const listaFinal = await fetch(`${getBase()}/api/produtos`, { headers: { Cookie: cookie } }).then(res => res.json());
    const p1Final = listaFinal.find(p => p.id === p1.id);
    const p2Final = listaFinal.find(p => p.id === p2.id);
    r.checar('produto não editado depois voltou ao valor original', p1Final.genero === 'Original', p1Final.genero);
    r.checar('produto editado depois manteve a edição mais recente', p2Final.genero === 'Editado Depois', p2Final.genero);

    return r.total();
}
