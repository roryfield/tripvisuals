// [VZ] comprovante-ia.js — Lê um comprovante de pagamento (imagem) e
// extrai valor, data/hora e nome do pagador via IA. Não sabe nada sobre
// pedidos, produtos ou qualquer coisa específica da Trip Visuals — só
// recebe bytes de imagem e devolve o que conseguiu ler. A ponte com o
// pedido real vive em server.js, do mesmo jeito que tripvisuals-adapter.js
// é a ponte entre o Catalogador e a tabela produtos.
//
// [VZ] Fase 8 — nasceu da mesma trava do CNPJ: sem gateway de pagamento
// automatizado, a alternativa realista é a dona da loja continuar
// recebendo PIX na chave pessoal dela e a IA conferir o comprovante em
// vez de fazer a conferência de olho, número por número.
'use strict';

const Groq = require('groq-sdk');

const PROMPT = 'Esta imagem é um comprovante de pagamento PIX ou transferência bancária. ' +
    'Extraia os dados e responda SOMENTE em JSON, sem nenhum texto antes ou depois, ' +
    'no formato exato: {"valor": <número ou null>, "dataHora": "<string ou null>", "nomePagador": "<string ou null>"}. ' +
    'O campo valor deve ser só o número, sem "R$" e com ponto decimal (ex.: 89.90). ' +
    'Se não conseguir identificar algum campo com confiança, use null nesse campo específico. ' +
    'Se a imagem claramente não é um comprovante de pagamento, responda ' +
    '{"valor": null, "dataHora": null, "nomePagador": null, "naoEComprovante": true}.';

/**
 * @param {object} params
 * @param {Buffer} params.buffer
 * @param {string} params.mimeType  'image/jpeg' | 'image/png' | 'image/webp'
 * @param {string} params.groqApiKey
 * @param {string} [params.model]
 * @returns {Promise<{valor:number|null, dataHora:string|null, nomePagador:string|null, naoEComprovante?:boolean, erroLeitura?:boolean}>}
 */
async function lerComprovante({ buffer, mimeType, groqApiKey, model }) {
    if (!groqApiKey) {
        throw Object.assign(new Error('GROQ_API_KEY não configurada.'), { status: 503 });
    }
    const groq = new Groq({ apiKey: groqApiKey });
    const b64 = buffer.toString('base64');

    const res = await groq.chat.completions.create({
        model:       model || 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens:  200,
        temperature: 0,
        messages: [{
            role: 'user',
            content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
                { type: 'text', text: PROMPT },
            ],
        }],
    });

    const bruto = res.choices[0]?.message?.content || '{}';
    try {
        const limpo = bruto.replace(/```json|```/g, '').trim();
        const dado = JSON.parse(limpo);
        return {
            valor:            typeof dado.valor === 'number' ? dado.valor : null,
            dataHora:         typeof dado.dataHora === 'string' ? dado.dataHora : null,
            nomePagador:      typeof dado.nomePagador === 'string' ? dado.nomePagador : null,
            naoEComprovante:  dado.naoEComprovante === true,
        };
    } catch (_) {
        return { valor: null, dataHora: null, nomePagador: null, erroLeitura: true };
    }
}

module.exports = { lerComprovante };
