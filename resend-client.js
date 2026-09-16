// ============================================================
//  resend-client.js — cliente HTTP compartilhado pra Resend
//  VOIDZONE · Trip Visuals Wear
//
//  Extraído do feedback-notify.js quando o pedido-notify.js
//  precisou do mesmo envio de e-mail — em vez de duplicar o
//  request de baixo nível em dois arquivos, os dois módulos de
//  notificação (feedback e pedido) passam a depender só deste.
//
//  INERTE até RESEND_API_KEY estar configurada — mesmo espírito
//  do asaas.js: nunca quebra o fluxo principal se não estiver
//  configurado ou se a chamada externa falhar (quem chama decide
//  o que fazer com o erro, mas o send em si nunca lança pra fora
//  sem contexto).
//
//  Uses Node's built-in https module — sem dependência nova no
//  package.json, mesmo padrão do asaas.js.
// ============================================================
'use strict';

const https = require('https');

function isConfigured() {
    return !!process.env.RESEND_API_KEY;
}

// Low-level Resend request.
function resendRequest(body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const options = {
            hostname: 'api.resend.com',
            path: '/emails',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
                else reject(new Error('Resend retornou status ' + res.statusCode + ': ' + data));
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => req.destroy(new Error('Timeout ao contatar a Resend.')));
        req.write(payload);
        req.end();
    });
}

/**
 * Envia um e-mail via Resend. Lança se RESEND_API_KEY não estiver
 * configurada ou se a chamada falhar — quem chama decide se isso vira
 * um evento de log silencioso ou uma falha real (ver feedback-notify.js
 * e pedido-notify.js pro padrão de uso).
 *
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 */
async function enviarEmail({ to, subject, html }) {
    if (!isConfigured()) throw new Error('RESEND_API_KEY não configurada.');
    return resendRequest({
        from: process.env.RESEND_FROM || 'Trip Visuals <onboarding@resend.dev>',
        to,
        subject,
        html
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { isConfigured, enviarEmail, escapeHtml };
