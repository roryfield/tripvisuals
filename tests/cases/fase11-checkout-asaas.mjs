import { criarRelator, login, getBase, query } from '../lib/ctx.mjs';

// [VZ] Fase 11 — checkout PIX/Asaas era a única rota que move dinheiro real
// sem nenhum teste automatizado (apontado na auditoria de encerramento de
// ciclo). Cobertura possível sem credenciais reais da Asaas:
//
//   1. o gate (checkout_automatico_enabled + ASAAS_API_KEY) bloqueia a rota
//      quando desligado — é o estado padrão em produção hoje;
//   2. o webhook, que NÃO faz nenhuma chamada de saída pra Asaas, só recebe
//      e processa — dá pra testar de ponta a ponta simulando uma notificação
//      real, incluindo a comparação de token em tempo constante corrigida
//      nesta rodada.
//
// Criar uma cobrança PIX de verdade (POST /api/checkout/pix com o gate
// ligado) exigiria ASAAS_API_KEY real ou um shim do módulo `https` nativo —
// fora do escopo deste arquivo. Registrado aqui, não escondido: essa parte
// da rota segue sem teste automatizado.
export default async function run() {
    const r = criarRelator('Fase 11 — Checkout PIX/Asaas');
    const cookie = await login();

    // ── Gate: automático desligado (padrão) ───────────────────────────
    const status = await fetch(`${getBase()}/api/checkout/status`);
    const statusJson = await status.json();
    r.checar('GET /api/checkout/status responde 200 sem login', status.status === 200);
    r.checar('checkout automático reporta desligado (nem config nem ASAAS_API_KEY setados no ambiente de teste)',
        statusJson.enabled === false, JSON.stringify(statusJson));

    const pixDesligado = await fetch(`${getBase()}/api/checkout/pix`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: 1, cliente_whatsapp: '11999998888', cpfCnpj: '11144477735' }),
    });
    r.checar('POST /api/checkout/pix com gate desligado responde 503, não gera cobrança',
        pixDesligado.status === 503, pixDesligado.status);

    // ── Webhook: token ausente/errado é rejeitado, mas ainda fica logado ──
    const semToken = await fetch(`${getBase()}/api/webhook/asaas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_teste_semtoken' } }),
    });
    r.checar('webhook sem token é rejeitado (401)', semToken.status === 401, semToken.status);

    const logSemToken = await query(
        `SELECT id FROM webhook_log WHERE payload::text LIKE '%pay_teste_semtoken%' ORDER BY id DESC LIMIT 1`);
    r.checar('notificação sem token válido ainda assim fica registrada em webhook_log (auditável antes de qualquer validação)',
        logSemToken.length === 1);

    const tokenErrado = await fetch(`${getBase()}/api/webhook/asaas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'asaas-access-token': 'token-inventado-errado' },
        body: JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_teste_tokenerrado' } }),
    });
    r.checar('webhook com token errado (mesmo tamanho ou não) é rejeitado (401)', tokenErrado.status === 401, tokenErrado.status);

    // ── Webhook: token certo confirma pagamento e avança o pedido ─────
    const TOKEN = process.env.TEST_WEBHOOK_TOKEN || 'teste-webhook-token-fixo-nao-usar-em-producao';
    const paymentId = 'pay_teste_' + Date.now();

    const pedido = await query(
        `INSERT INTO pedidos (produto_nome, valor, status, payment_status, asaas_payment_id)
         VALUES ('CAMISETA TESTE WEBHOOK', 99.90, 'novo', 'pendente', $1) RETURNING id`,
        [paymentId]);
    const pedidoId = pedido[0].id;

    const webhookOk = await fetch(`${getBase()}/api/webhook/asaas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'asaas-access-token': TOKEN },
        body: JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: paymentId } }),
    });
    r.checar('webhook com token correto responde 200', webhookOk.status === 200, webhookOk.status);

    const pedidoDepois = await query('SELECT status, payment_status FROM pedidos WHERE id = $1', [pedidoId]);
    r.checar('PAYMENT_CONFIRMED avança o pedido pra confirmado/pago automaticamente',
        pedidoDepois[0].status === 'confirmado' && pedidoDepois[0].payment_status === 'pago',
        JSON.stringify(pedidoDepois[0]));

    const logOk = await query(
        `SELECT processado FROM webhook_log WHERE payload::text LIKE $1 ORDER BY id DESC LIMIT 1`,
        ['%' + paymentId + '%']);
    r.checar('notificação processada com sucesso fica marcada em webhook_log', logOk[0]?.processado === true, JSON.stringify(logOk[0]));

    // ── Replay: mesmo evento de novo não deveria quebrar nem reprocessar sem sentido ──
    const replay = await fetch(`${getBase()}/api/webhook/asaas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'asaas-access-token': TOKEN },
        body: JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: paymentId } }),
    });
    r.checar('reenvio do mesmo evento (comum em webhooks) continua respondendo 200, sem erro', replay.status === 200, replay.status);

    return r.total();
}
