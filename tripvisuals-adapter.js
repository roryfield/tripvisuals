// [VZ] tripvisuals-adapter.js — Único arquivo autorizado a escrever na
// tabela `produtos` a partir do Catalogador. Existe pra manter
// catalogador-router.js genérico, sem nenhuma referência a "produtos" ou
// a qualquer schema específico da Trip Visuals, para que ele possa virar
// template pro vdzn-sm (ou outro cliente) sem precisar ser reescrito.
//
// Reaproveita as mesmas funções de upload/validação de imagem que
// POST /api/produtos já usa em server.js — não duplica lógica de Cloudinary.
'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {(buffer: Buffer, filename: string) => Promise<{url:string, public_id:string}>} deps.uploadToCloudinary
 * @param {(url: string, transform: string) => string} deps.cloudTransform
 * @param {string} deps.TRANSFORM_PRODUCT
 * @param {(buffer: Buffer) => (string|null)} deps.detectImageType
 * @param {Function} [deps.registrarEvento]  De eventos.js — opcional, só não loga se ausente
 */
function criarAdapter({ pool, uploadToCloudinary, cloudTransform, TRANSFORM_PRODUCT, detectImageType, registrarEvento }) {

    function nomeAPartirDoSlug(slug) {
        return String(slug || 'sem-identificacao')
            .split('-')
            .filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    /**
     * Cria um produto rascunho (oculto, preço 0) a partir de um item já lido
     * pelo scanner. Oculto por padrão de propósito: ninguém deve conseguir
     * comprar uma camiseta por R$0 só porque o scanner já rodou nela — a
     * dona da loja preenche preço e detalhe antes de tornar visível.
     */
    async function aplicarItem({ absPath, band, outputFile, tipoPadrao = 'Camiseta', generoPadrao = '' }) {
        if (!fs.existsSync(absPath)) {
            throw Object.assign(new Error('Arquivo de staging não encontrado (pode já ter sido limpo).'), { status: 404 });
        }
        const buffer = await fs.promises.readFile(absPath);
        if (!detectImageType(buffer)) {
            throw Object.assign(new Error('Arquivo não é uma imagem válida (JPG, PNG ou WebP).'), { status: 400 });
        }

        const baseName = path.basename(outputFile || absPath, path.extname(absPath))
            .replace(/[^\w-]/g, '_').slice(0, 60);
        const cloud = await uploadToCloudinary(buffer, Date.now() + '_' + baseName);
        const imagem_url    = cloudTransform(cloud.url, TRANSFORM_PRODUCT);
        const cloudinary_id = cloud.public_id;
        const nome = nomeAPartirDoSlug(band);

        const r = await pool.query(
            `INSERT INTO produtos (nome, preco, imagem_url, cloudinary_id, cor, tipo, genero, oculto, descricao, busca_tsv)
             VALUES ($1, 0, $2, $3, '', $4, $5, true, '',
                     to_tsvector('portuguese', $1 || ' ' || $4 || ' ' || $5))
             RETURNING id`,
            [nome, imagem_url, cloudinary_id, tipoPadrao, generoPadrao]
        );
        const produtoId = r.rows[0].id;

        if (registrarEvento) {
            await registrarEvento(pool, {
                modulo:   'catalogador',
                tipo:     'produto_criado_via_scanner',
                resumo:   `Produto "${nome}" criado a partir do scanner (rascunho oculto, preço a definir).`,
                detalhes: { produtoId, band, outputFile },
            });
        }

        return { produtoId, nome, imagem_url };
    }

    /** Descarta um item lido: apaga o arquivo de staging, nada é escrito no banco. */
    async function descartarItem({ absPath }) {
        await fs.promises.unlink(absPath).catch(() => {});
    }

    return { aplicarItem, descartarItem };
}

module.exports = { criarAdapter };
