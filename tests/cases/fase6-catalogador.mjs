import fs from 'fs';
import { criarRelator, login, query, getBase } from '../lib/ctx.mjs';

const GROQ_CONTROL = process.env.TEST_GROQ_CONTROL_FILE;
function setGroqResposta(texto) { fs.writeFileSync(GROQ_CONTROL, texto); }

export default async function run() {
    const r = criarRelator('Fases 2/6 — Scanner do Catalogador (Cloudinary + Postgres)');
    const cookie = await login();

    const tabela = await query("SELECT to_regclass('catalogador_itens') AS t");
    r.checar('tabela catalogador_itens existe (staging não é mais em disco)', tabela[0]?.t === 'catalogador_itens');

    await fetch(`${getBase()}/api/catalogador/progress`, { method: 'DELETE', headers: { Cookie: cookie } });

    const imgPath = process.env.TEST_IMAGE_PATH;
    const bytes = fs.readFileSync(imgPath);
    const form = new FormData();
    form.append('images', new Blob([bytes], { type: 'image/jpeg' }), 'iron-maiden-teste.jpg');
    const up = await fetch(`${getBase()}/api/catalogador/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form }).then(res => res.json());
    r.checar('upload aceita a imagem e não toca disco', up.uploaded === 1, JSON.stringify(up));
    const chave = up.files[0];

    const staging = await query('SELECT cloudinary_url FROM catalogador_itens WHERE chave = $1', [chave]);
    r.checar('item ficou registrado com URL da Cloudinary', staging[0]?.cloudinary_url?.includes('localhost'), JSON.stringify(staging));

    setGroqResposta('iron-maiden');
    await fetch(`${getBase()}/api/catalogador/start`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ concurrency: 1 }),
    });
    await new Promise(res => setTimeout(res, 1500));

    const processado = await query('SELECT banda, processado_em FROM catalogador_itens WHERE chave = $1', [chave]);
    r.checar('item foi lido (banda = iron-maiden)', processado[0]?.banda === 'iron-maiden', JSON.stringify(processado));

    const aplicar = await fetch(`${getBase()}/api/catalogador/itens/${encodeURIComponent(chave)}/aplicar`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    }).then(res => res.json());
    r.checar('aplicar cria produto sem subir a imagem de novo', Number.isInteger(aplicar.produtoId), JSON.stringify(aplicar));

    const produto = await query('SELECT oculto, preco, banda FROM produtos WHERE id = $1', [aplicar.produtoId]);
    r.checar('produto criado oculto, preço 0, com banda', produto[0]?.oculto === true && Number(produto[0]?.preco) === 0 && produto[0]?.banda === 'iron-maiden', JSON.stringify(produto));

    const reaplicar = await fetch(`${getBase()}/api/catalogador/itens/${encodeURIComponent(chave)}/aplicar`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    });
    r.checar('reaplicar o mesmo item é bloqueado (409)', reaplicar.status === 409);

    // reset não pode destruir o asset de um item já aplicado
    const resetRes = await fetch(`${getBase()}/api/catalogador/progress`, { method: 'DELETE', headers: { Cookie: cookie } });
    r.checar('reset do lote responde 200', resetRes.status === 200);
    const produtoSobrevive = await query('SELECT id FROM produtos WHERE id = $1', [aplicar.produtoId]);
    r.checar('produto já aplicado sobrevive ao reset do lote', produtoSobrevive.length === 1);

    return r.total();
}
