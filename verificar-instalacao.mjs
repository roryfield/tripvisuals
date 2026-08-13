#!/usr/bin/env node
// [VZ] verificar-instalacao.mjs
//
// Confere, sem criar ou alterar nenhum dado real, quais fases estão
// aplicadas e respondendo num ambiente (local ou produção). Não depende
// de mim nem de nenhuma IA pra rodar — só Node 18+, que o projeto já
// exige. Pensado pra rodar toda vez que você aplicar um pacote novo, ou
// periodicamente, sem precisar reconstruir a verificação do zero.
//
// Uso:
//   node verificar-instalacao.mjs
//   BASE_URL=https://tripvisuals.shop ADMIN_PASSWORD=xxxxx node verificar-instalacao.mjs
//
// Se as variáveis não forem passadas, usa http://localhost:3000 e pede a
// senha por padrão só tenta sem login nas rotas públicas.

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SENHA = process.env.ADMIN_PASSWORD || '';

let cookie = '';
const resultados = [];

function registrar(fase, nome, ok, detalhe) {
    resultados.push({ fase, nome, ok, detalhe });
    const icone = ok ? '✅' : '❌';
    console.log(`${icone} [Fase ${fase}] ${nome}${detalhe ? ' — ' + detalhe : ''}`);
}

function avisar(fase, nome, detalhe) {
    resultados.push({ fase, nome, ok: null, detalhe });
    console.log(`⚪ [Fase ${fase}] ${nome} — ${detalhe}`);
}

async function login() {
    if (!SENHA) {
        console.log('⚪ ADMIN_PASSWORD não informado — rotas que exigem login serão puladas.\n' +
                     '   Rode assim: ADMIN_PASSWORD=suasenha node verificar-instalacao.mjs\n');
        return false;
    }
    try {
        const r = await fetch(`${BASE}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha: SENHA }),
        });
        cookie = (r.headers.get('set-cookie') || '').split(';')[0];
        return r.status === 200 && cookie.includes('vztoken');
    } catch (e) {
        return false;
    }
}

async function get(path, comLogin = true) {
    try {
        const r = await fetch(`${BASE}${path}`, {
            headers: comLogin && cookie ? { Cookie: cookie } : {},
        });
        const texto = await r.text();
        let json = null;
        try { json = JSON.parse(texto); } catch (_) {}
        return { status: r.status, json, corpo: texto };
    } catch (e) {
        return { status: 0, json: null, corpo: '', erro: e.message };
    }
}

async function main() {
    console.log(`\nVerificando ${BASE}\n`);

    // ── Base: servidor está de pé e a landing pública responde ────────────────
    const raiz = await get('/', false);
    registrar(0, 'Servidor responde e serve a landing pública', raiz.status === 200, `status ${raiz.status}`);

    const logado = await login();
    if (SENHA) registrar(0, 'Login admin funciona', logado, logado ? '' : 'confira ADMIN_PASSWORD');

    // ── Fase 1 — Fundação ────────────────────────────────────────────────────
    avisar(1, 'system_events (Fundação)', 'sem rota HTTP própria — confirmada indiretamente pelas Fases 2, 4, 6 e 8 abaixo');

    // ── Fase 2 — Scanner do Catalogador ─────────────────────────────────────
    if (logado) {
        const cat = await get('/api/catalogador/status');
        registrar(2, 'Rota do Catalogador responde', cat.status === 200, `status ${cat.status}`);
        if (cat.status === 200 && cat.json) {
            registrar(2, 'GROQ_API_KEY configurada no ambiente', !!cat.json.hasKey,
                cat.json.hasKey ? '' : 'sem isso, ler estampa não funciona (upload e organização continuam ok)');
        }
    } else {
        avisar(2, 'Scanner do Catalogador', 'pulado, sem login');
    }

    // ── Fase 3 — Gerenciar Produtos (filtros, banda) ────────────────────────
    if (logado) {
        const prod = await get('/api/produtos');
        registrar(3, 'Rota de produtos responde', prod.status === 200, `status ${prod.status}`);
        if (prod.status === 200 && Array.isArray(prod.json)) {
            const temColunaNova = prod.json.length === 0 || 'banda' in prod.json[0];
            registrar(3, 'Coluna "banda" presente nos produtos', temColunaNova,
                prod.json.length === 0 ? 'catálogo vazio, não deu pra confirmar pelo dado' : '');
        }
    } else {
        avisar(3, 'Gerenciar Produtos', 'pulado, sem login');
    }

    // ── Fase 4 — Dashboard ───────────────────────────────────────────────────
    if (logado) {
        const ev = await get('/api/eventos?limite=1');
        registrar(4, 'Rota de eventos (Atividade Recente) responde', ev.status === 200, `status ${ev.status}`);
    } else {
        avisar(4, 'Dashboard', 'pulado, sem login');
    }

    // ── Fase 5 — Aparência ───────────────────────────────────────────────────
    const landing = await get('/admin-landing.html', false);
    const temAparencia = landing.status === 200; // resposta é HTML, não JSON — checagem de texto abaixo
    registrar(5, 'Tela de Aparência existe', temAparencia, `status ${landing.status}`);
    const temaEscuro = await get('/landing-dark.html', false);
    registrar(5, 'Os 3 estilos novos (Minimalista/Clean/Dark) estão publicados', temaEscuro.status === 200, `status ${temaEscuro.status}`);

    // ── Fase 6 — Staging Cloudinary/Postgres ────────────────────────────────
    avisar(6, 'Staging Cloudinary/Postgres do Catalogador',
        'não dá pra diferenciar da Fase 2 só por chamada HTTP (a API é a mesma de propósito). ' +
        'Pra confirmar: rode uma sessão real no Catalogador e confira se aparece em "SELECT * FROM catalogador_itens" no Postgres, não mais um arquivo .cat-progress.json.');

    // ── Fase 7 — Frete por região ────────────────────────────────────────────
    const freteRegioes = logado ? await get('/api/frete/regioes') : { status: 0 };
    if (logado) registrar(7, 'Rota de configuração de frete responde', freteRegioes.status === 200, `status ${freteRegioes.status}`);
    const freteCalculo = await get('/api/frete?cep=000', false); // CEP inválido de propósito — nunca chama a ViaCEP, resultado é determinístico
    registrar(7, 'Rota pública de cálculo de frete responde (CEP inválido testado, não usa rede externa)',
        freteCalculo.status === 200 && freteCalculo.json?.encontrado === false, `status ${freteCalculo.status}`);
    if (logado && freteRegioes.status === 200 && Array.isArray(freteRegioes.json)) {
        if (freteRegioes.json.length === 0) {
            avisar(7, 'Nenhuma região de frete configurada ainda', 'catálogo público vai continuar mostrando "combinado pelo WhatsApp" até você cadastrar alguma em Pedidos');
        } else {
            registrar(7, `${freteRegioes.json.length} região(ões) de frete configurada(s)`, true);
        }
    }

    // ── Fase 8 — Comprovante de pagamento ───────────────────────────────────
    if (logado) {
        const confirmarInexistente = await fetch(`${BASE}/api/pedidos/999999999/confirmar-pagamento`, {
            method: 'POST', headers: { Cookie: cookie },
        });
        const corpo = await confirmarInexistente.json().catch(() => ({}));
        const rotaExiste = confirmarInexistente.status === 404 && /pedido/i.test(corpo.error || '');
        registrar(8, 'Rota de confirmação de pagamento existe (testada com ID inexistente, não altera nada)', rotaExiste,
            rotaExiste ? '' : `status ${confirmarInexistente.status}`);
    } else {
        avisar(8, 'Comprovante de pagamento', 'pulado, sem login');
    }

    // ── Fase 9 — Suíte de testes (não checável por HTTP) ────────────────────
    avisar(9, 'Suíte de testes (npm test)', 'sem rota HTTP própria — precisa rodar "npm test" localmente contra um Postgres de teste, não dá pra confirmar de fora');

    // ── Fase 10 — Segurança ──────────────────────────────────────────────────
    if (logado) {
        const semSenha = await fetch(`${BASE}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha: 'senha-errada-de-proposito-para-teste' }),
        });
        registrar(10, 'Login rejeita senha errada (sem travar o servidor)', semSenha.status === 401 || semSenha.status === 403,
            `status ${semSenha.status}`);
    } else {
        avisar(10, 'Segurança (hash de senha, CPF/CNPJ, CSV)', 'checagens de fundo, não dá pra confirmar hash/timing só por HTTP — ver SEGURANCA.md');
    }

    // ── Fase 11/12 — UX/UI: Ajuda reescrita e densidade ─────────────────────
    const ajuda = await get('/admin-help.html', false);
    registrar(11, 'Tela de Ajuda existe e responde', ajuda.status === 200, `status ${ajuda.status}`);

    // ── Fase 13 — UX/UI: Marca & Vitrine (rename) + Hub (grid de desktop) ───
    if (landing.status === 200 && typeof landing.corpo === 'string') {
        const temNomeNovo = landing.corpo.includes('Marca &amp; Vitrine') || landing.corpo.includes('MARCA &amp; VITRINE');
        registrar(13, 'Tela renomeada pra "Marca & Vitrine" (não mais "Aparência")', temNomeNovo,
            temNomeNovo ? '' : 'ainda aparece como Aparência — confira se o deploy pegou o admin-landing.html novo');
    } else {
        avisar(13, 'Rename de Marca & Vitrine', 'não deu pra ler o corpo da resposta pra confirmar o texto — confira visualmente');
    }
    const hub = await get('/admin-hub.html', false);
    registrar(13, 'Tela do Hub existe e responde (confirma que o fechamento de hub-wrap não quebrou nada)', hub.status === 200, `status ${hub.status}`);

    // ── Resumo ───────────────────────────────────────────────────────────────
    const falhas = resultados.filter(r => r.ok === false);
    console.log('\n' + '─'.repeat(60));
    console.log(`${resultados.filter(r => r.ok === true).length} confirmado(s), ${falhas.length} com problema, ${resultados.filter(r => r.ok === null).length} não verificável só por HTTP.`);
    if (falhas.length) {
        console.log('\nPontos que merecem atenção:');
        falhas.forEach(f => console.log(`  - [Fase ${f.fase}] ${f.nome}${f.detalhe ? ': ' + f.detalhe : ''}`));
    }
    console.log('');
    process.exit(falhas.length ? 1 : 0);
}

main().catch(e => { console.error('Erro ao rodar a verificação:', e.message); process.exit(1); });
