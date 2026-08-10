import fs from 'fs';
import { criarRelator, login, query, getBase } from '../lib/ctx.mjs';

const GROQ_CONTROL = process.env.TEST_GROQ_CONTROL_FILE;
function setGroqResposta(obj) { fs.writeFileSync(GROQ_CONTROL, JSON.stringify(obj)); }

export default async function run() {
    const r = criarRelator('Fase 8 — Conferência de comprovante de pagamento');
    const cookie = await login();

    const pedido = await fetch(`${getBase()}/api/pedidos`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_nome: 'Teste comprovante', valor: 89.90 }),
    }).then(res => res.json());

    const bytes = fs.readFileSync(process.env.TEST_IMAGE_PATH);
    async function enviar() {
        const form = new FormData();
        form.append('comprovante', new Blob([bytes], { type: 'image/jpeg' }), 'comp.jpg');
        return fetch(`${getBase()}/api/pedidos/${pedido.id}/comprovante`, { method: 'POST', headers: { Cookie: cookie }, body: form }).then(res => res.json());
    }

    setGroqResposta({ valor: 89.90, dataHora: '03/08/2026', nomePagador: 'Maria' });
    const confereRes = await enviar();
    r.checar('valor lido igual ao esperado marca confere=true', confereRes.confere === true, JSON.stringify(confereRes));

    const antesDeConfirmar = await query('SELECT payment_status, status FROM pedidos WHERE id = $1', [pedido.id]);
    r.checar('IA sozinha NÃO altera o status do pedido', antesDeConfirmar[0]?.payment_status === 'manual' && antesDeConfirmar[0]?.status === 'novo', JSON.stringify(antesDeConfirmar));

    const confirmar = await fetch(`${getBase()}/api/pedidos/${pedido.id}/confirmar-pagamento`, { method: 'POST', headers: { Cookie: cookie } });
    r.checar('confirmar manualmente responde 200', confirmar.status === 200);

    const depoisDeConfirmar = await query('SELECT payment_status, status FROM pedidos WHERE id = $1', [pedido.id]);
    r.checar('depois do clique manual, status avança (mesmo padrão do webhook Asaas)', depoisDeConfirmar[0]?.payment_status === 'pago' && depoisDeConfirmar[0]?.status === 'confirmado', JSON.stringify(depoisDeConfirmar));

    const pedido2 = await fetch(`${getBase()}/api/pedidos`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_nome: 'Teste divergente', valor: 200 }),
    }).then(res => res.json());
    setGroqResposta({ valor: 50, dataHora: null, nomePagador: null });
    const form2 = new FormData();
    form2.append('comprovante', new Blob([bytes], { type: 'image/jpeg' }), 'comp2.jpg');
    const divergeRes = await fetch(`${getBase()}/api/pedidos/${pedido2.id}/comprovante`, { method: 'POST', headers: { Cookie: cookie }, body: form2 }).then(res => res.json());
    r.checar('valor diferente do esperado marca confere=false', divergeRes.confere === false, JSON.stringify(divergeRes));

    return r.total();
}
