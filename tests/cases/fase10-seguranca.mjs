import { criarRelator, getBase } from '../lib/ctx.mjs';
import { validarCPF, validarCNPJ, validarCpfCnpj } from '../../documentos.js';

export default async function run() {
    const r = criarRelator('Fase 10 — Segurança (senha, CPF/CNPJ, CSV)');

    // ── CPF/CNPJ: dígito verificador real, não só contagem de dígitos ────────
    r.checar('CPF válido (gerado pelo algoritmo) é aceito', validarCPF('11144477735'));
    r.checar('CPF com dígito verificador errado é rejeitado', !validarCPF('11144477736'));
    r.checar('CPF com todos os dígitos iguais é rejeitado', !validarCPF('11111111111'));
    r.checar('string de 11 dígitos aleatórios (só contagem) é rejeitada', !validarCPF('12345678901'));

    r.checar('CNPJ válido (gerado pelo algoritmo) é aceito', validarCNPJ('11014447000136'));
    r.checar('CNPJ com dígito verificador errado é rejeitado', !validarCNPJ('11014447000137'));

    r.checar('validarCpfCnpj aceita CPF válido com pontuação', validarCpfCnpj('111.444.777-35'));
    r.checar('validarCpfCnpj rejeita tamanho errado', !validarCpfCnpj('123'));

    // ── Login: senha com hash bcrypt ──────────────────────────────────────────
    const loginOk = await fetch(`${getBase()}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: process.env.TEST_ADMIN_PASSWORD }),
    });
    r.checar('login com a senha certa funciona com ADMIN_PASSWORD_HASH configurado', loginOk.status === 200, loginOk.status);
    r.checar('resposta de login traz cookie de sessão', (loginOk.headers.get('set-cookie') || '').includes('vztoken'));

    const loginErrado = await fetch(`${getBase()}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: 'senha-inteiramente-errada' }),
    });
    r.checar('login com senha errada é rejeitado (401)', loginErrado.status === 401, loginErrado.status);

    // ── CSV: campo começando com = não vira fórmula ao abrir no Excel ───────
    const cookie = (loginOk.headers.get('set-cookie') || '').split(';')[0];
    await fetch(`${getBase()}/api/pedidos`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_nome: '=cmd|"/c calc"!A1', cliente_nome: '+SOMA(1+1)', valor: 10 }),
    });
    const csvRes = await fetch(`${getBase()}/api/pedidos/export`, { headers: { Cookie: cookie } });
    const csvTexto = await csvRes.text();
    r.checar('nome de produto que começa com "=" vem prefixado com apóstrofo no CSV',
        csvTexto.includes("\"'=cmd"), csvTexto.slice(0, 300));
    r.checar('nome de cliente que começa com "+" vem prefixado com apóstrofo no CSV',
        csvTexto.includes("\"'+SOMA"), csvTexto.slice(0, 300));

    return r.total();
}
