// ============================================================
//  feedback-notify.js — notificação por e-mail de novo feedback
//  VOIDZONE · Trip Visuals Wear
//
//  INERTE até RESEND_API_KEY estar configurada no ambiente —
//  mesmo espírito do asaas.js (fica desligado até alguém ligar
//  de propósito, nunca quebra o fluxo principal se não estiver
//  configurado ou se a chamada externa falhar).
//
//  Por quê Resend em vez de SMTP direto: Railway historicamente
//  bloqueia/limita as portas SMTP tradicionais (25/587), e SMTP
//  exigiria pedir senha de app de uma conta pessoal de alguém
//  (Rory ou a cliente) — frágil e um pedido desconfortável. Resend
//  é só uma API HTTP (como a Asaas já é aqui), a chave fica só
//  com a VOIDZONE, e os destinatários recebem na caixa de sempre
//  (Gmail pessoal ou qualquer outra) sem precisar configurar nada
//  do lado deles.
//
//  Uses Node's built-in https module — mesmo padrão do asaas.js,
//  sem dependência nova no package.json.
// ============================================================
'use strict';

const https = require('https');

function isConfigured() {
    return !!process.env.RESEND_API_KEY && !!process.env.FEEDBACK_EMAIL_TO;
}

function destinatarios() {
    return (process.env.FEEDBACK_EMAIL_TO || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function montarHtml(feedback) {
    const estrelas = feedback.nota ? '★'.repeat(feedback.nota) + '☆'.repeat(5 - feedback.nota) : '(sem nota)';
    const identidade = feedback.anonimo
        ? 'Anônimo'
        : ('@' + escapeHtml(feedback.instagram_handle || '(sem @ informado)') +
           (feedback.autoriza_repost ? ' — autorizou repost' : ' — não autorizou repost'));
    return `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
            <h2 style="color:#111;">Novo feedback — Trip Visuals</h2>
            <p style="color:#555; font-size:14px;">${estrelas}</p>
            <p style="color:#111; font-size:15px; line-height:1.5; white-space:pre-wrap; border-left:3px solid #9d00ff; padding-left:12px;">${escapeHtml(feedback.mensagem)}</p>
            <p style="color:#777; font-size:13px;">Identificação: ${identidade}</p>
            <p style="color:#aaa; font-size:12px;">Recebido em ${new Date(feedback.criado_em || Date.now()).toLocaleString('pt-BR')}</p>
        </div>
    `;
}

// Low-level Resend request — mesmo estilo de asaasRequest em asaas.js.
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
 * Notifica por e-mail que um novo feedback chegou. NUNCA lança —
 * uma falha aqui não pode derrubar a rota pública que recebeu o
 * feedback (mesmo princípio do registrarEvento). Loga o resultado
 * via registrarEvento pra ficar auditável no Hub, sucesso ou erro.
 *
 * @param {import('pg').Pool} pool
 * @param {function} registrarEvento
 * @param {object} feedback  linha da tabela feedbacks já inserida
 */
async function notificarNovoFeedback(pool, registrarEvento, feedback) {
    if (!isConfigured()) {
        await registrarEvento(pool, {
            modulo: 'feedback', tipo: 'notificacao_pulada', severidade: 'info',
            resumo: 'Feedback registrado sem notificação por e-mail (RESEND_API_KEY/FEEDBACK_EMAIL_TO ausente).'
        });
        return false;
    }
    const to = destinatarios();
    if (!to.length) return false;
    try {
        await resendRequest({
            from: process.env.RESEND_FROM || 'Trip Visuals <onboarding@resend.dev>',
            to,
            subject: '💬 Novo feedback no catálogo — Trip Visuals',
            html: montarHtml(feedback)
        });
        await registrarEvento(pool, {
            modulo: 'feedback', tipo: 'notificacao_enviada', severidade: 'sucesso',
            resumo: 'E-mail de notificação de feedback enviado com sucesso.',
            detalhes: { destinatarios: to.length }
        });
        return true;
    } catch (err) {
        await registrarEvento(pool, {
            modulo: 'feedback', tipo: 'notificacao_falhou', severidade: 'erro',
            resumo: 'Falha ao enviar e-mail de notificação de feedback: ' + err.message
        });
        return false;
    }
}

module.exports = { isConfigured, notificarNovoFeedback };
