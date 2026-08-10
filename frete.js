// [VZ] frete.js — Cálculo de frete por região (UF), configurável pela loja.
//
// Sem CNPJ não dá pra contratar API de frete de transportadora de verdade
// (Correios e a maioria exigem contrato empresarial). A saída realista é
// uma estimativa fixa por estado, definida pela própria dona da loja, com
// o endereço resolvido via ViaCEP (público, gratuito, sem chave). Não é
// cotação em tempo real de transportadora, é a mesma lógica que hoje
// acontece na cabeça dela durante a conversa do WhatsApp, só que
// automatizada e consistente.
//
// Desenhado pra ser reaproveitável em outro projeto (vdzn-sm, record-store):
// não depende de nada específico da Trip Visuals além do pool injetado.
'use strict';

async function ensureSchema(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS frete_regioes (
            uf          CHAR(2) PRIMARY KEY,
            valor       NUMERIC(10,2) NOT NULL,
            prazo_dias  INTEGER NOT NULL DEFAULT 7,
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

/** Resolve um CEP em endereço via ViaCEP. Retorna null se inválido/não encontrado. */
async function buscarEnderecoPorCep(cepBruto) {
    const cep = String(cepBruto || '').replace(/\D/g, '');
    if (cep.length !== 8) return null;
    try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        if (!r.ok) return null;
        const d = await r.json();
        if (d.erro) return null;
        return { cep, cidade: d.localidade || '', uf: d.uf || '', bairro: d.bairro || '' };
    } catch (_) {
        return null;
    }
}

/**
 * @returns {{encontrado:false}}
 *        | {encontrado:true, atendido:false, endereco}
 *        | {encontrado:true, atendido:true, endereco, valor:number, prazoDias:number}
 */
async function calcularFrete(pool, cepBruto) {
    const endereco = await buscarEnderecoPorCep(cepBruto);
    if (!endereco) return { encontrado: false };

    const r = await pool.query('SELECT valor, prazo_dias FROM frete_regioes WHERE uf = $1', [endereco.uf]);
    if (!r.rows.length) return { encontrado: true, atendido: false, endereco };

    return {
        encontrado: true,
        atendido:   true,
        endereco,
        valor:      Number(r.rows[0].valor),
        prazoDias:  r.rows[0].prazo_dias,
    };
}

async function listarRegioes(pool) {
    const r = await pool.query('SELECT uf, valor, prazo_dias FROM frete_regioes ORDER BY uf');
    return r.rows;
}

async function definirRegiao(pool, uf, valor, prazoDias) {
    await pool.query(
        `INSERT INTO frete_regioes (uf, valor, prazo_dias, atualizado_em)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (uf) DO UPDATE SET valor = $2, prazo_dias = $3, atualizado_em = NOW()`,
        [uf, valor, prazoDias]
    );
}

async function removerRegiao(pool, uf) {
    await pool.query('DELETE FROM frete_regioes WHERE uf = $1', [uf]);
}

module.exports = { ensureSchema, buscarEnderecoPorCep, calcularFrete, listarRegioes, definirRegiao, removerRegiao };
