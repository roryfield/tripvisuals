# Relatório de Auditoria Técnica — Tripvisuals

## Segurança

**Injeção SQL:** não encontrei nenhum ponto de concatenação de string em query SQL. Todas as consultas em `server.js`, `frete.js`, `eventos.js`, `catalogador-router.js` usam parâmetros (`$1`, `$2`...). Bom.

**XSS:** a disciplina de escapar saída é real e consistente — `esc()`/`escapeHTML()` aparece em `catalogo.js`, `admin-produtos.js`, `admin-catalogador.js`, `admin-landing.js`, `admin-hub.js`. `onerror` de `<img>` é setado via propriedade JS (não atributo inline), coerente com a CSP sem `unsafe-inline`.

**CSP:** forte e bem pensada — `script-src 'self'`, `style-src 'self' https://fonts.googleapis.com` (sem `unsafe-inline` em nenhum dos dois), `frame-ancestors 'none'` relaxado *apenas* para `catalogo.html` e apenas para `'self'`. Cabeçalhos complementares (`HSTS`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) presentes.

**Autenticação/sessão:** sessões em Postgres (sobrevivem a redeploy), token de 32 bytes aleatórios, cookie `HttpOnly + Secure + SameSite=Strict`, TTL de 8h, rota para derrubar todas as sessões (`DELETE /api/sessions/all`). Senha via bcrypt com fallback documentado a texto-plano + comparação com hash SHA-256 antes do `timingSafeEqual` (mitiga timing attack de forma razoável). Sem token CSRF explícito, mas mitigado por `SameSite=Strict`.

**Rate limiting:** cobertura ampla e correta — login (5/15min), upload, escrita, checkout, webhook, export, cálculo de frete, clique. Consistente.

**Segredos hardcoded:** nenhuma chave de API hardcoded — tudo via env var. **Porém**: `cookie.txt` na raiz do projeto contém um cookie Netscape com um token de sessão (`vztoken=1233ddf24a...`) em texto puro, com validade até 2026. Isso é uma credencial de sessão real dentro do código-fonte entregue, não coberta pelo `.gitignore` (que só bloqueia `.env*`, não `*.txt`). Ver achado crítico abaixo.

**Validação de entrada:** boa — allowlist de chaves em `POST /api/config` (`CONFIG_KEYS_PERMITIDAS`), allowlist de UF em frete, checagem de assinatura binária real (magic bytes) em upload de imagem tanto em `server.js` quanto em `catalogador-router.js`, preço do checkout PIX buscado sempre no servidor (nunca confiado do cliente — comentário explícito no código sobre isso).

**Achado adicional:** o webhook da Asaas (`POST /api/webhook/asaas`) compara o token recebido com `!==` simples, não com comparação de tempo constante — inconsistente com o cuidado tomado no login.

## Arquitetura e consistência

Não há uma separação formal em camadas (rota/repository/service). `server.js` é reconhecidamente monolítico — os próprios documentos do projeto (`AJUSTES-PENDENTES.md`, `admin-conhecimento.html`) admitem isso como dívida técnica. Módulos mais novos (`frete.js`, `eventos.js`, `documentos.js`, `asaas.js`, `catalogador-router.js` + `tripvisuals-adapter.js`) mostram um padrão melhor: injeção de dependência explícita (`setPool`, `setAdapter`, `setCloudinary`) e isolamento de domínio (`catalogador-router.js` genuinamente não sabe o nome da tabela `produtos`). Esse é o ponto mais forte da arquitetura.

Padrões duplicados que deveriam ser unificados:
- **`mostrarToast`/`showToast`**: reimplementado quase idêntico em `admin-hub.js`, `admin-landing.js`, `admin-layout.js`, `admin-produtos.js`, `admin-pedidos.js`, `admin-catalogador.js` — apesar de `admin-shared.js` já ser carregado em toda página admin e ser o lugar óbvio para essa função única.
- **`esc()`/`escapeHTML()`**: reescrito de forma independente em `admin-catalogador.js`, `admin-produtos.js`, `admin-landing.js` (`escapeHTML`/`escapeAttr`), `catalogo.js`, e `admin-hub.js` (`escapeHTMLLocal`, cujo próprio comentário reconhece "admin-hub não tinha esse helper antes" — confirmando a duplicação em vez de resolvê-la).
- **Parsing do cookie de sessão** (`/vztoken=([^;]+)/`) duplicado em pelo menos 3 pontos de `server.js` (`requireAuth`, `GET /api/produtos`, `GET /api/me`) em vez de uma função só.
- **Hidratação de config na landing pública**: `landing-loader.js` e `sobre-loader.js` reimplementam separadamente a mesma lógica de "buscar `/api/config` e aplicar em elementos por id".

Seis arquivos HTML (`admin.html`, `admin-catalogador.html`, `admin-produtos.html`, `admin-layout.html`, `admin-config.html`, `admin-curadoria.html`) existem só para redirecionar via `<meta refresh>` — transição razoável, mas acumulação de arquivos-fantasma que merece limpeza eventual.

O motor de guia contextual (`admin-guia.js` + `admin-guia-*.js`) é, ao contrário, um exemplo positivo de consistência: mesmo padrão de registro em três fluxos diferentes, sem duplicar o motor.

## Cobertura de testes

O que está **genuinamente testado**: a suíte em `tests/` sobe um servidor real de verdade (processo filho) contra um Postgres descartável, e troca `cloudinary`/`groq-sdk` por shims determinísticos em `node_modules` (abordagem inteligente, não é mock raso). Os casos cobrem cenários reais, não só "retorna 200":
- fluxo completo do Catalogador (upload → processar → aplicar → bloqueio de reaplicação → reset não destrói item já aplicado);
- lógica de "desfazer" inteligente em edição em massa (reverte só o que não foi editado de novo depois — testa o caso de concorrência real, não só o caminho feliz);
- confirmação de que a IA de comprovante **não** altera status sozinha (só a confirmação manual altera) — teste correto de um controle de segurança de processo;
- validação real de dígito verificador de CPF/CNPJ (não só contagem de dígitos);
- proteção contra injeção de fórmula em CSV.

O que **só parece testado** ou está totalmente ausente:
- **Checkout PIX/Asaas (`asaas.js`, `/api/checkout/pix`, `/api/webhook/asaas`) não tem nenhum teste.** É a única rota que lida com valor monetário real e tem uma correção de segurança explícita no código (preço nunca vem do cliente) — exatamente o tipo de regra que precisa de teste de regressão e não tem nenhum.
- Nenhum teste do `catalogo.js` (loja pública) — filtros, modal de produto, geração de mensagem de WhatsApp, fluxo de tamanho obrigatório.
- Nenhum teste de rate limiting (bloqueio após 5 tentativas de login) nem de expiração/revogação de sessão.
- Nenhum teste de upload malicioso (arquivo não-imagem com extensão de imagem) para confirmar que a checagem de magic bytes realmente rejeita — só o caminho de imagem válida é exercitado.
- Nenhum teste do allowlist de `POST /api/config` rejeitando chave não permitida.

## Tratamento de erros

Em geral, boa disciplina: rotas em `server.js` fazem `try/catch` com `console.error(rota, e.message)` e devolvem mensagem genérica ao cliente, sem vazar stack trace. O error handler global do Express também não vaza `err.stack`. `registrarEvento()` (`eventos.js`) é deliberadamente projetada para nunca lançar, evitando que uma falha de log derrube a rota que a chamou — usada de forma fire-and-forget em vários pontos, de propósito.

Achados pontuais:
- **`admin-produtos.js`** (`carregar()`) constrói o próprio erro incluindo até 200 caracteres do corpo bruto da resposta do servidor (`'HTTP ' + res.status + ' — ' + corpo.slice(0,200)`) e renderiza isso na tela. Hoje é inofensivo porque o servidor só devolve JSON genérico, mas o padrão vazaria detalhe interno se uma resposta de erro futura incluir algo mais específico.
- **Endpoint SSE morto** (`GET /api/catalogador/events`, em `catalogador-router.js`) continua montado e acessível mesmo depois de a própria documentação do projeto (`PROBLEMAS-CONHECIDOS`, dentro de `admin-conhecimento.html`) registrar que SSE foi abandonado e substituído por polling por incompatibilidade confirmada com a infraestrutura do Railway. Nenhum frontend atual o chama — é uma conexão de longa duração, autenticada, ainda ativa em produção sem propósito.
- Falhas silenciosas deliberadas em `admin-catalogador.js` (`.catch(function () {})` em `pollStatus`, `fetchResults`, `fetchFileCount`) — justificadas em comentário ("próximo ciclo tenta de novo"), mas se o servidor cair de verdade (não só uma falha pontual de rede), o anel de progresso simplesmente para de atualizar sem nenhum aviso visível na tela.

## Documentação vs. realidade

- **`README.md` afirma "Vulnerabilidades | 0 (auditoria mais recente: 27/27 controles)".** Essa é uma alegação de certeza absoluta ("zero vulnerabilidades") que nenhuma auditoria autoavaliada deveria fazer — e esta própria auditoria encontrou achados reais (o cookie exposto, a comparação não constant-time do webhook). É a linha mais otimista de todo o conjunto de documentos, e está num README voltado a cliente/portfólio, onde o incentivo a superestimar é claro.
- **Inconsistência entre `VERSIONING.md` e os demais documentos sobre a suíte de testes.** `VERSIONING.md` lista "Suíte de testes | 45 verificações automatizadas, rodáveis com `npm test`, sem depender de mim nem de IA nenhuma" como item entregue da v1.0 — linguagem de recurso pronto e funcionando. Mas `AJUSTES-PENDENTES.md` e o artigo "Limitações Técnicas" em `admin-conhecimento.html` dizem, no mesmo conjunto de documentos: *"Suíte de testes automatizados existe no código, mas nunca rodou de verdade... porque isso exige decidir onde rodar esse banco de teste... e essa decisão ainda está em aberto."* Quem lê só a tabela de versão sai com a impressão errada de que a cobertura de teste é comprovada.
- **Contraponto positivo, para não distorcer o quadro:** a contagem "45 verificações" bate razoavelmente com o total real de `checar(...)` nos arquivos de `tests/cases/` (cerca de 50) — não é um número inventado. E os artigos da base de conhecimento (`Protocolo Refresh`, `Problemas Conhecidos`) são incomumente disciplinados em separar explicitamente "confirmado" de "hipótese" — um padrão de honestidade que a maior parte da documentação de projeto não tem.
- A alegação "Nenhum estilo inline restante no projeto" (`SEGURANCA.md`, `PATCH_NOTES.md`) é tecnicamente verdadeira no sentido estrito de atributo `style="..."` em HTML, mas o texto não deixa claro que dezenas de lugares seguem manipulando `.style.propriedade =` via JS (o que é esperado e não é o mesmo problema de CSP) — um leitor sem o contexto técnico pode entender "zero estilo inline" de forma mais ampla do que é real.

## Padrões de UI (Grid/Form/Filtro)

- Entidade: Produtos | Campos: nome, preço, cor, tipo, gênero, banda, descrição, oculto, destaque | Tem filtro/paginação: sim (busca + filtros de tipo/banda/gênero + paginação de 24 por página)
- Entidade: Pedidos | Campos: produto_nome, tamanho, cliente_nome, cliente_whatsapp, cep, valor, status, notas, comprovante | Tem filtro/paginação: filtro sim (chips por status), paginação não (carrega tudo de uma vez)
- Entidade: Catalogador IA (itens identificados) | Campos: arquivo original, banda, arquivo de saída, aplicado/produto_id | Tem filtro/paginação: não
- Entidade: Frete por região (UF) | Campos: uf, valor, prazo_dias | Tem filtro/paginação: não

## Achados por severidade

**CRÍTICO**
- `cookie.txt` (raiz do projeto): arquivo em formato Netscape contendo um token de sessão (`vztoken`) em texto puro com validade até 2026, não coberto pelo `.gitignore`. Se este arquivo estiver ou vier a ser versionado/compartilhado, qualquer pessoa com acesso a ele ganha uma sessão de admin válida sem precisar da senha.

**IMPORTANTE**
- `README.md`, seção de segurança: alegação de "0 vulnerabilidades (27/27 controles)" — certeza absoluta indevida numa auditoria autoavaliada; esta auditoria encontrou achados reais que contradizem a afirmação.
- `server.js`, rota `POST /api/webhook/asaas`: comparação do token do webhook (`incomingToken !== expectedToken`) não é de tempo constante, diferente do padrão usado no login (`timingSafeStringCompare`)/bcrypt. Exploração prática improvável via rede, mas inconsistente com o próprio padrão de segurança do projeto.
- `catalogador-router.js`, rota `GET /api/catalogador/events` (SSE): endpoint morto ainda montado e acessível depois de a própria documentação do projeto registrar que SSE foi definitivamente abandonado por incompatibilidade com o Railway — superfície de conexão autenticada de longa duração sem uso real.
- `VERSIONING.md` (tabela v1.0, item 9) vs. `AJUSTES-PENDENTES.md`/`admin-conhecimento.html`: a suíte de testes é listada como recurso entregue e pronto, enquanto outro documento do mesmo projeto admite que ela nunca rodou de fato contra um Postgres real.
- `tests/cases/`: nenhum teste cobre `asaas.js` / `/api/checkout/pix` / `/api/webhook/asaas` — a única rota que move valor monetário real, e que tem uma correção de segurança explícita (preço nunca vindo do cliente) sem nenhum teste de regressão protegendo essa correção.

**SUGESTÃO**
- `mostrarToast`/`showToast` e `esc`/`escapeHTML` duplicados quase palavra por palavra em 5–6 arquivos JS do admin, apesar de `admin-shared.js` já ser carregado em toda página — candidatos óbvios a centralização.
- `server.js`: regex de parsing do cookie `vztoken` duplicada em 3 pontos (`requireAuth`, `GET /api/produtos`, `GET /api/me`).
- `admin-produtos.js` (`carregar()`): repassa até 200 caracteres do corpo bruto da resposta do servidor para a tela do admin em caso de erro — inofensivo hoje, mas um padrão que vazaria detalhe interno se a resposta de erro do servidor mudar no futuro.
- Seis arquivos HTML de redirecionamento (`admin.html`, `admin-catalogador.html`, `admin-produtos.html`, `admin-layout.html`, `admin-config.html`, `admin-curadoria.html`) acumulados como shims — candidatos a limpeza quando não houver mais links externos apontando para eles.
- `landing-loader.js`: `landing_bg_image_url` (configurável pelo admin) é interpolado direto em `background-image: url(...)` sem nenhuma validação de formato — risco baixo (só admin autenticado escreve essa config), mas vale uma sanitização básica como defesa em profundidade.