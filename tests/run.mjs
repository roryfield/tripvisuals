#!/usr/bin/env node
// [VZ] tests/run.mjs — roda a suíte inteira contra um banco de teste e um
// servidor real (subido como processo filho), sem precisar de mim nem de
// nenhuma IA. Sempre restaura os módulos reais no final, mesmo se algo
// quebrar no meio.
//
// Uso:
//   TEST_DATABASE_URL=postgresql://... TEST_ADMIN_PASSWORD=senha npm test
//
// TEST_DATABASE_URL precisa ser um banco vazio ou descartável — a suíte
// cria tabelas e grava dados de teste nele. NUNCA aponte isso pro banco
// de produção.

import bcrypt from 'bcryptjs';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { instalarShims, restaurarShims } from './lib/shims.mjs';
import { fecharPool } from './lib/ctx.mjs';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const PORT = process.env.TEST_PORT || 3100;
const CDN_PORT = process.env.TEST_CDN_PORT || 3101;

if (!TEST_DATABASE_URL) {
    console.error(
        '\n❌ TEST_DATABASE_URL não informado.\n\n' +
        'A suíte precisa de um banco de teste, vazio ou descartável — ela cria\n' +
        'tabelas e grava dados nele. NUNCA aponte isso pro banco de produção.\n\n' +
        'Exemplo:\n' +
        '  TEST_DATABASE_URL=postgresql://postgres:senha@localhost:5432/tv_test npm test\n'
    );
    process.exit(1);
}
if (/railway\.app|rlwy\.net/.test(TEST_DATABASE_URL)) {
    console.error('\n❌ TEST_DATABASE_URL parece apontar pro Railway. Por segurança, a suíte recusa rodar contra um host que parece produção.\n');
    process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-tests-'));
const groqControlFile = path.join(tmpDir, 'groq-resposta.json');
const imagePath = path.join(tmpDir, 'teste.jpg');
// JPEG mínimo válido (1x1 px), só pra passar na checagem de magic bytes.
fs.writeFileSync(imagePath, Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
    'base64'
));

const cdnServer = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(fs.readFileSync(imagePath));
}).listen(CDN_PORT);

process.env.TEST_BASE_URL = `http://localhost:${PORT}`;
process.env.TEST_GROQ_CONTROL_FILE = groqControlFile;
process.env.TEST_IMAGE_PATH = imagePath;
process.env.TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'teste-local-1234';
fs.writeFileSync(groqControlFile, '{}');

async function esperarServidor(url, tentativas = 40) {
    let sucessosSeguidos = 0;
    for (let i = 0; i < tentativas; i++) {
        try {
            const r = await fetch(url);
            if (r.status) {
                sucessosSeguidos++;
                if (sucessosSeguidos >= 2) return true; // duas respostas seguidas, não só a primeira depois de um retry de sorte
            } else {
                sucessosSeguidos = 0;
            }
        } catch (_) {
            sucessosSeguidos = 0;
        }
        await new Promise(res => setTimeout(res, 300));
    }
    return false;
}

async function main() {
    console.log(`Banco de teste: ${TEST_DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    instalarShims({ cdnPort: CDN_PORT, groqControlFile });

    const server = spawn('node', ['server.js'], {
        env: {
            ...process.env,
            DATABASE_URL: TEST_DATABASE_URL,
            PORT: String(PORT),
            ADMIN_PASSWORD_HASH: bcrypt.hashSync(process.env.TEST_ADMIN_PASSWORD, 10),
            CLOUDINARY_CLOUD_NAME: 'teste', CLOUDINARY_API_KEY: 'teste', CLOUDINARY_API_SECRET: 'teste',
            GROQ_API_KEY: process.env.TEST_GROQ_API_KEY || 'chave-falsa-suficiente-pro-shim',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logServidor = '';
    server.stdout.on('data', d => { logServidor += d; });
    server.stderr.on('data', d => { logServidor += d; });

    let totalFalhas = 0;
    try {
        const subiu = await esperarServidor(`http://localhost:${PORT}/`);
        if (!subiu) {
            console.error('\n❌ O servidor não respondeu a tempo. Log:\n' + logServidor);
            process.exitCode = 1;
            return;
        }
        await new Promise(res => setTimeout(res, 800)); // folga extra depois do primeiro sinal de vida

        const casos = [
            'fase1-eventos.mjs',
            'fase3-produtos.mjs',
            'fase4-dashboard.mjs',
            'fase5-aparencia.mjs',
            'fase6-catalogador.mjs',
            'fase7-frete.mjs',
            'fase8-comprovante.mjs',
            'fase10-seguranca.mjs',
        ];
        for (const arquivo of casos) {
            try {
                const mod = await import(`./cases/${arquivo}?t=${Date.now()}`);
                totalFalhas += await mod.default();
            } catch (e) {
                console.log(`\n❌ Suíte "${arquivo}" quebrou antes de terminar: ${e.message}`);
                totalFalhas += 1;
            }
        }
    } finally {
        server.kill();
        cdnServer.close();
        await fecharPool();
        restaurarShims();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('\n' + '─'.repeat(60));
    console.log(totalFalhas === 0 ? '✅ TODOS OS TESTES PASSARAM' : `❌ ${totalFalhas} TESTE(S) FALHARAM`);
    if (totalFalhas > 0) {
        console.log('\n── log do servidor de teste (diagnóstico) ──\n' + logServidor);
    }
    process.exitCode = totalFalhas === 0 ? 0 : 1;
    process.exit(process.exitCode); // handles pendentes (ex.: sockets do child) não devem prender o processo
}

main().catch(e => {
    console.error('Erro ao rodar a suíte:', e);
    restaurarShims();
    process.exit(1);
});
