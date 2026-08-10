// [VZ] tests/lib/shims.mjs — troca temporária dos módulos cloudinary e
// groq-sdk por versões falsas, determinísticas, sem tocar rede nenhuma.
// Mesmo princípio já usado pro `pg` em sessões de desenvolvimento
// anteriores: mover o real pra um nome de lado, criar um fake no lugar,
// e sempre restaurar no fim, mesmo se o teste quebrar no meio.
import fs from 'fs';
import path from 'path';

const NM = path.resolve(process.cwd(), 'node_modules');

function swapIn(nome, arquivos) {
    const real = path.join(NM, nome);
    const realBak = path.join(NM, nome + '-real-backup');
    if (fs.existsSync(realBak)) {
        throw new Error(`${nome}-real-backup já existe — um teste anterior pode ter saído sem restaurar. Apague ${realBak} manualmente antes de rodar de novo.`);
    }
    fs.renameSync(real, realBak);
    fs.mkdirSync(real);
    for (const [arquivo, conteudo] of Object.entries(arquivos)) {
        fs.writeFileSync(path.join(real, arquivo), conteudo);
    }
}

function swapOut(nome) {
    const real = path.join(NM, nome);
    const realBak = path.join(NM, nome + '-real-backup');
    if (!fs.existsSync(realBak)) return; // nada pra restaurar
    fs.rmSync(real, { recursive: true, force: true });
    fs.renameSync(realBak, real);
}

export function instalarShims({ cdnPort, groqControlFile }) {
    swapIn('cloudinary', {
        'package.json': JSON.stringify({ name: 'cloudinary', version: '0.0.0-fake', main: 'index.js' }),
        'index.js': `
const v2 = {
    config() {},
    uploader: {
        upload_stream(options, callback) {
            return { end(_b) { process.nextTick(() => callback(null, {
                secure_url: 'http://localhost:${cdnPort}/' + options.public_id + '.jpg',
                public_id: options.folder + '/' + options.public_id,
            })); } };
        },
        destroy() { return Promise.resolve({ result: 'ok' }); }
    }
};
module.exports = { v2 };
`,
    });

    swapIn('groq-sdk', {
        'package.json': JSON.stringify({ name: 'groq-sdk', version: '0.0.0-fake', main: 'index.js' }),
        'index.js': `
const fs = require('fs');
const CONTROL = ${JSON.stringify(groqControlFile)};
class Groq {
    constructor() {
        this.chat = { completions: { create: async () => {
            let resposta = 'sem-resposta-configurada';
            try { resposta = fs.readFileSync(CONTROL, 'utf8'); } catch (_) {}
            return { choices: [{ message: { content: resposta } }] };
        } } };
    }
}
module.exports = Groq;
`,
    });
}

export function restaurarShims() {
    swapOut('cloudinary');
    swapOut('groq-sdk');
}
