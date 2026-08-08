// [VZ] eventos.js — Registro central de eventos do sistema (system_events).
// Log estruturado e append-only: erros, sucessos e ações em lote de qualquer
// módulo (catalogador, produtos, dashboard) gravam aqui através de uma única
// função. Os nomes de campo (projeto, tipo, resumo) seguem a mesma convenção
// já usada em historico/registro.jsonl, para que uma exportação deste log
// fique no mesmo formato que o material já usado nas auditorias manuais.
'use strict';

/**
 * Grava um evento em system_events. Nunca lança: uma falha ao registrar
 * não pode derrubar a rota que chamou (mesmo princípio do webhook_log).
 *
 * @param {import('pg').Pool} pool
 * @param {object} evento
 * @param {string} evento.modulo      Ex.: 'catalogador', 'produtos', 'auth'
 * @param {string} evento.tipo        Ex.: 'sessao_iniciada', 'erro_leitura'
 * @param {'info'|'sucesso'|'erro'} [evento.severidade='info']
 * @param {string} evento.resumo      Frase curta, legível, sem dado sensível
 * @param {object|null} [evento.detalhes=null]  Dado estruturado adicional
 */
async function registrarEvento(pool, { modulo, tipo, severidade = 'info', resumo, detalhes = null }) {
    if (!modulo || !tipo || !resumo) {
        console.error('⚠️  registrarEvento chamado sem modulo/tipo/resumo — evento descartado.');
        return;
    }
    try {
        await pool.query(
            `INSERT INTO system_events (modulo, tipo, severidade, resumo, detalhes)
             VALUES ($1, $2, $3, $4, $5)`,
            [modulo, tipo, severidade, resumo, detalhes ? JSON.stringify(detalhes) : null]
        );
    } catch (err) {
        console.error('⚠️  Falha ao registrar evento em system_events:', err.message);
    }
}

/**
 * Lê os últimos eventos, mais recentes primeiro. Usado pelo dashboard
 * (Fase 4) e pela exportação de auditoria sob demanda.
 *
 * @param {import('pg').Pool} pool
 * @param {object} [opts]
 * @param {number} [opts.limite=50]
 * @param {string} [opts.modulo]      Filtra por módulo, se informado
 */
async function listarEventos(pool, { limite = 50, modulo = null } = {}) {
    const limiteSeguro = Math.min(Math.max(1, +limite || 50), 500);
    const params = [limiteSeguro];
    let where = '';
    if (modulo) {
        params.push(modulo);
        where = 'WHERE modulo = $2';
    }
    const { rows } = await pool.query(
        `SELECT id, projeto, modulo, tipo, severidade, resumo, detalhes, criado_em
         FROM system_events
         ${where}
         ORDER BY criado_em DESC
         LIMIT $1`,
        params
    );
    return rows;
}

module.exports = { registrarEvento, listarEventos };
