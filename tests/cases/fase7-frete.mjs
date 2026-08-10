import { criarRelator, login, getBase } from '../lib/ctx.mjs';

export default async function run() {
    const r = criarRelator('Fase 7 — Frete por região');
    const cookie = await login();

    const criar = await fetch(`${getBase()}/api/frete/regioes/SP`, {
        method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: 25.5, prazoDias: 5 }),
    });
    r.checar('cadastrar região SP responde 200', criar.status === 200);

    const invalida = await fetch(`${getBase()}/api/frete/regioes/XX`, {
        method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: 10, prazoDias: 5 }),
    });
    r.checar('UF inválida é rejeitada', invalida.status === 400);

    const publica = await fetch(`${getBase()}/api/frete?cep=123`); // CEP mal formado, não bate na ViaCEP
    const publicaJson = await publica.json();
    r.checar('rota pública não exige login e trata CEP mal formado sem erro', publica.status === 200 && publicaJson.encontrado === false, JSON.stringify(publicaJson));

    const remover = await fetch(`${getBase()}/api/frete/regioes/SP`, { method: 'DELETE', headers: { Cookie: cookie } });
    r.checar('remover região responde 200', remover.status === 200);

    return r.total();
}
