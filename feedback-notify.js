// ============================================================
//  feedback-notify.js — notificação por e-mail de novo feedback
//  VOIDZONE · Trip Visuals Wear
//
//  INERTE até RESEND_API_KEY e FEEDBACK_EMAIL_TO estarem
//  configuradas — mesmo espírito do asaas.js (fica desligado até
//  alguém ligar de propósito, nunca quebra o fluxo principal se
//  não estiver configurado ou se a chamada externa falhar).
//
//  O envio de baixo nível mora em resend-client.js, compartilhado
//  com pedido-notify.js — aqui só fica a lógica específica de
//  feedback: quem recebe (a equipe, via FEEDBACK_EMAIL_TO) e como
//  o e-mail é montado.
// ============================================================
'use strict';

const resend = require('./resend-client');

function isConfigured() {
    return resend.isConfigured() && !!process.env.FEEDBACK_EMAIL_TO;
}

function destinatarios() {
    return (process.env.FEEDBACK_EMAIL_TO || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);
}

function montarHtml(feedback) {
    const estrelas = feedback.nota ? '★'.repeat(feedback.nota) + '☆'.repeat(5 - feedback.nota) : '(sem nota)';
    const identidade = feedback.anonimo
        ? 'Anônimo'
        : ('@' + resend.escapeHtml(feedback.instagram_handle || '(sem @ informado)') +
           (feedback.autoriza_repost ? ' — autorizou repost' : ' — não autorizou repost'));
    return `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
            <h2 style="color:#111;">Novo feedback — Trip Visuals</h2>
            <p style="color:#555; font-size:14px;">${estrelas}</p>
            <p style="color:#111; font-size:15px; line-height:1.5; white-space:pre-wrap; border-left:3px solid #9d00ff; padding-left:12px;">${resend.escapeHtml(feedback.mensagem)}</p>
            <p style="color:#777; font-size:13px;">Identificação: ${identidade}</p>
            <p style="color:#aaa; font-size:12px;">Recebido em ${new Date(feedback.criado_em || Date.now()).toLocaleString('pt-BR')}</p>
        </div>
    `;
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
        await resend.enviarEmail({
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
