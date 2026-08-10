// [VZ] documentos.js — Validação de CPF e CNPJ com dígito verificador real
// (algoritmo módulo 11 padrão da Receita Federal, público, sem nada
// proprietário). Extraído do server.js pra virar testável isoladamente e
// reaproveitável em qualquer projeto que precise validar documento
// brasileiro, sem trazer nada específico da Trip Visuals junto.
'use strict';

function validarCPF(cpf) {
    if (!/^\d{11}$/.test(cpf)) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false; // todos os dígitos iguais nunca é válido
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
    let resto = (soma * 10) % 11;
    if (resto >= 10) resto = 0;
    if (resto !== parseInt(cpf[9], 10)) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto >= 10) resto = 0;
    return resto === parseInt(cpf[10], 10);
}

function validarCNPJ(cnpj) {
    if (!/^\d{14}$/.test(cnpj)) return false;
    if (/^(\d)\1{13}$/.test(cnpj)) return false;
    const dv = base => {
        const pesos = base.length === 12
            ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
            : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const soma = base.split('').reduce((acc, d, i) => acc + parseInt(d, 10) * pesos[i], 0);
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };
    const base12 = cnpj.slice(0, 12);
    const dv1 = dv(base12);
    if (dv1 !== parseInt(cnpj[12], 10)) return false;
    const dv2 = dv(base12 + dv1);
    return dv2 === parseInt(cnpj[13], 10);
}

/** Aceita string com ou sem pontuação; decide CPF ou CNPJ pelo tamanho. */
function validarCpfCnpj(valor) {
    const digitos = String(valor || '').replace(/\D/g, '');
    if (digitos.length === 11) return validarCPF(digitos);
    if (digitos.length === 14) return validarCNPJ(digitos);
    return false;
}

module.exports = { validarCPF, validarCNPJ, validarCpfCnpj };
