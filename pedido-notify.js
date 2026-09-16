// ============================================================
//  pedido-notify.js — confirmação e atualização de status de
//  pedido por e-mail, pro cliente final
//  VOIDZONE · Trip Visuals Wear
//
//  INERTE até RESEND_API_KEY estar configurada (mesmo padrão dos
//  outros módulos de notificação). Diferente de feedback-notify.js
//  (que avisa a equipe), este avisa o PRÓPRIO CLIENTE — só dispara
//  quando o pedido tem `cliente_email` preenchido, porque o
//  checkout desta loja roda inteiro por WhatsApp e e-mail nunca
//  foi um campo obrigatório em lugar nenhum do fluxo. Sem e-mail
//  no pedido, a rota que chama isso simplesmente não notifica —
//  não é erro, é o cliente não tendo informado esse dado.
// ============================================================
'use strict';

const resend = require('./resend-client');

function isConfigured() {
    return resend.isConfigured();
}

const STATUS_LABEL = {
    novo:       'Recebemos seu pedido',
    confirmado: 'Pagamento confirmado',
    producao:   'Sua peça está em produção',
    enviado:    'Seu pedido foi enviado',
    entregue:   'Pedido entregue'
};
const STATUS_COPY = {
    novo:       'Recebemos os detalhes do seu pedido e já estamos cuidando dele.',
    confirmado: 'Seu pagamento foi confirmado — a produção começa em seguida.',
    producao:   'Sua peça está sendo confeccionada agora, sob encomenda.',
    enviado:    'Seu pedido saiu pra entrega. Qualquer dúvida sobre o rastreio, é só chamar no WhatsApp.',
    entregue:   'Seu pedido foi entregue. Esperamos que curta a peça — e se quiser deixar um feedback, o catálogo tem um espaço pra isso.'
};

function montarHtml(pedido, tipo) {
    const status = pedido.status || 'novo';
    const titulo = tipo === 'recebido' ? STATUS_LABEL.novo : (STATUS_LABEL[status] || 'Atualização do seu pedido');
    const corpo  = tipo === 'recebido' ? STATUS_COPY.novo : (STATUS_COPY[status] || 'O status do seu pedido foi atualizado.');
    return `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
            <h2 style="color:#111;">${resend.escapeHtml(titulo)}</h2>
            <p style="color:#333; font-size:15px; line-height:1.5;">${resend.escapeHtml(corpo)}</p>
            <table style="width:100%; margin-top:16px; border-collapse:collapse; font-size:14px; color:#333;">
                <tr><td style="padding:6px 0; color:#777;">Peça</td><td style="padding:6px 0; text-align:right;">${resend.escapeHtml(pedido.produto_nome || '')}</td></tr>
                ${pedido.tamanho ? `<tr><td style="padding:6px 0; color:#777;">Tamanho</td><td style="padding:6px 0; text-align:right;">${resend.escapeHtml(pedido.tamanho)}</td></tr>` : ''}
                ${pedido.valor ? `<tr><td style="padding:6px 0; color:#777;">Valor</td><td style="padding:6px 0; text-align:right;">R$ ${Number(pedido.valor).toFixed(2)}</td></tr>` : ''}
                <tr><td style="padding:6px 0; color:#777;">Status</td><td style="padding:6px 0; text-align:right; font-weight:600;">${resend.escapeHtml(STATUS_LABEL[status] || status)}</td></tr>
            </table>
            <p style="color:#aaa; font-size:12px; margin-top:18px;">Trip Visuals Wear · dúvidas, chame no WhatsApp.</p>
        </div>
    `;
}

/**
 * Notifica o cliente por e-mail sobre o pedido. NUNCA lança — uma
 * falha aqui não pode derrubar a rota de admin que criou/atualizou
 * o pedido. Loga o resultado via registrarEvento, sucesso ou erro.
 * Não faz nada (silenciosamente) se o pedido não tiver e-mail — a
 * ausência de e-mail é o caso comum, não uma falha.
 *
 * @param {import('pg').Pool} pool
 * @param {function} registrarEvento
 * @param {object} pedido  linha da tabela pedidos (precisa de cliente_email)
 * @param {'recebido'|'status'} tipo
 */
async function notificarPedido(pool, registrarEvento, pedido, tipo) {
    const email = (pedido.cliente_email || '').trim();
    if (!email) return false;
    if (!isConfigured()) {
        await registrarEvento(pool, {
            modulo: 'pedidos', tipo: 'notificacao_pulada', severidade: 'info',
            resumo: `Pedido #${pedido.id} tem e-mail mas notificação está desligada (RESEND_API_KEY ausente).`
        });
        return false;
    }
    try {
        const assunto = tipo === 'recebido'
            ? `Pedido recebido — Trip Visuals`
            : `${STATUS_LABEL[pedido.status] || 'Atualização do pedido'} — Trip Visuals`;
        await resend.enviarEmail({ to: email, subject: assunto, html: montarHtml(pedido, tipo) });
        await registrarEvento(pool, {
            modulo: 'pedidos', tipo: 'notificacao_enviada', severidade: 'sucesso',
            resumo: `E-mail de ${tipo === 'recebido' ? 'confirmação' : 'status'} enviado pro pedido #${pedido.id}.`,
            detalhes: { pedidoId: pedido.id, status: pedido.status }
        });
        return true;
    } catch (err) {
        await registrarEvento(pool, {
            modulo: 'pedidos', tipo: 'notificacao_falhou', severidade: 'erro',
            resumo: `Falha ao enviar e-mail do pedido #${pedido.id}: ${err.message}`
        });
        return false;
    }
}

module.exports = { isConfigured, notificarPedido };
