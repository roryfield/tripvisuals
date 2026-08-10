// [VZ] tripvisuals-adapter.js — Único arquivo autorizado a escrever na
// tabela `produtos` a partir do Catalogador. Existe pra manter
// catalogador-router.js genérico, sem nenhuma referência a "produtos" ou
// a qualquer schema específico da Trip Visuals, para que ele possa virar
// template pro vdzn-sm (ou outro cliente) sem precisar ser reescrito.
//
// [VZ] Fase 6 — desde que o staging do catalogador passou a subir pra
// Cloudinary no momento do upload (não mais no momento de aplicar), este
// arquivo não sobe imagem nenhuma: só referencia o asset que já existe.
'use strict';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {(url: string, transform: string) => string} deps.cloudTransform
 * @param {string} deps.TRANSFORM_PRODUCT
 * @param {Function} [deps.registrarEvento]  De eventos.js — opcional, só não loga se ausente
 */
function criarAdapter({ pool, cloudTransform, TRANSFORM_PRODUCT, registrarEvento }) {

    function nomeAPartirDoSlug(slug) {
        return String(slug || 'sem-identificacao')
            .split('-')
            .filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    /**
     * Cria um produto rascunho (oculto, preço 0) a partir de um item já lido
     * pelo scanner e já hospedado na Cloudinary. Oculto por padrão de
     * propósito: ninguém deve conseguir comprar uma camiseta por R$0 só
     * porque o scanner já rodou nela — a dona da loja preenche preço e
     * detalhe antes de tornar visível.
     */
    async function aplicarItem({ cloudinaryUrl, cloudinaryId, band, tipoPadrao = 'Camiseta', generoPadrao = '' }) {
        if (!cloudinaryUrl || !cloudinaryId) {
            throw Object.assign(new Error('Item sem imagem associada na Cloudinary.'), { status: 400 });
        }

        const imagem_url = cloudTransform(cloudinaryUrl, TRANSFORM_PRODUCT);
        const nome = nomeAPartirDoSlug(band);

        const r = await pool.query(
            `INSERT INTO produtos (nome, preco, imagem_url, cloudinary_id, cor, tipo, genero, banda, oculto, descricao, busca_tsv)
             VALUES ($1, 0, $2, $3, '', $4, $5, $6, true, '',
                     to_tsvector('portuguese', $1 || ' ' || $4 || ' ' || $5))
             RETURNING id`,
            [nome, imagem_url, cloudinaryId, tipoPadrao, generoPadrao, band]
        );
        const produtoId = r.rows[0].id;

        if (registrarEvento) {
            await registrarEvento(pool, {
                modulo:   'catalogador',
                tipo:     'produto_criado_via_scanner',
                resumo:   `Produto "${nome}" criado a partir do scanner (rascunho oculto, preço a definir).`,
                detalhes: { produtoId, band },
            });
        }

        return { produtoId, nome, imagem_url };
    }

    return { aplicarItem };
}

module.exports = { criarAdapter };
