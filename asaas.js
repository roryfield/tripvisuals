// ============================================================
//  asaas.js — Asaas API client (PIX charges)
//  VOIDZONE · Trip Visuals Wear
//
//  This module is INERT until ASAAS_API_KEY is set in the
//  environment. It is only ever called from routes that are
//  gated behind the 'checkout_automatico_enabled' config flag,
//  which defaults to 'false' and must be turned on deliberately
//  — see ATIVACAO_PAGAMENTOS.md for the activation checklist.
//
//  Uses Node's built-in https module (no extra dependency),
//  consistent with the rest of this codebase's style.
// ============================================================
'use strict';

const https = require('https');

const ASAAS_HOST = {
    sandbox:    'sandbox.asaas.com',
    production: 'api.asaas.com'
};

function getHost() {
    const env = (process.env.ASAAS_ENVIRONMENT || 'sandbox').toLowerCase();
    return ASAAS_HOST[env] || ASAAS_HOST.sandbox;
}

function isConfigured() {
    return !!process.env.ASAAS_API_KEY;
}

// Low-level request helper. Asaas API base path is /v3 on both hosts.
function asaasRequest(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        if (!process.env.ASAAS_API_KEY) {
            return reject(new Error('ASAAS_API_KEY não configurada — pagamentos automáticos indisponíveis.'));
        }
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: getHost(),
            path: '/v3' + urlPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                'access_token': process.env.ASAAS_API_KEY,
                'User-Agent': 'TripVisualsWear/1.0'
            }
        };
        if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed;
                try { parsed = data ? JSON.parse(data) : {}; }
                catch (e) { return reject(new Error('Resposta inválida da Asaas.')); }
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
                else {
                    const msg = (parsed.errors && parsed.errors[0] && parsed.errors[0].description)
                        || `Asaas retornou status ${res.statusCode}.`;
                    reject(new Error(msg));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('Timeout ao contatar a Asaas.')));
        if (payload) req.write(payload);
        req.end();
    });
}

// ── Customers ────────────────────────────────────────────────
// Asaas requires a customer record before creating a charge.
// We do NOT store CPF in our own database (LGPD: minimize PII)
// — it is sent straight through to Asaas and only their ID
// comes back into our pedidos table.
async function criarOuBuscarCliente({ nome, whatsapp, cpfCnpj }) {
    // Reuse an existing Asaas customer by phone if one already matches,
    // to avoid creating duplicate customer records on repeat purchases.
    if (whatsapp) {
        const found = await asaasRequest('GET', `/customers?mobilePhone=${encodeURIComponent(whatsapp)}`);
        if (found && Array.isArray(found.data) && found.data.length) {
            return found.data[0].id;
        }
    }
    const created = await asaasRequest('POST', '/customers', {
        name: nome || 'Cliente Trip Visuals',
        mobilePhone: whatsapp || undefined,
        cpfCnpj: cpfCnpj || undefined
    });
    return created.id;
}

// ── PIX charge ───────────────────────────────────────────────
// Creates the charge, then fetches the QR code + copy-paste payload.
// dueDate is required by Asaas even for PIX; we set it to today,
// since PIX QR codes are honored immediately regardless of due date.
async function criarCobrancaPix({ customerId, valor, descricao }) {
    const hoje = new Date().toISOString().slice(0, 10);
    const payment = await asaasRequest('POST', '/payments', {
        customer: customerId,
        billingType: 'PIX',
        value: Number(valor),
        dueDate: hoje,
        description: descricao || 'Pedido Trip Visuals Wear'
    });
    const qr = await asaasRequest('GET', `/payments/${payment.id}/pixQrCode`);
    return {
        asaas_payment_id: payment.id,
        pix_qr_code:       qr.encodedImage || '',   // base64 PNG, no data: prefix
        pix_copia_cola:    qr.payload || '',
        pix_expira_em:     qr.expirationDate || null,
        status_asaas:      payment.status
    };
}

// Events that mean "money has arrived" — used by the webhook handler
// to decide whether to auto-advance a pedido to 'confirmado'.
const EVENTOS_PAGAMENTO_CONFIRMADO = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];

module.exports = {
    isConfigured,
    criarOuBuscarCliente,
    criarCobrancaPix,
    EVENTOS_PAGAMENTO_CONFIRMADO
};
