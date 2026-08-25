# Relatório de Auditoria Técnica — Tripvisuals

## Segurança

**Injeção (SQL/XSS):** as queries usam parametrização (`$1, $2...`) de forma consistente — não encontrei concatenação de valor de usuário em SQL. Há, porém, um padrão frágil: `PATCH /api/produtos/bulk-campo` e o endpoint de desfazer em `server.js` interpolam o **nome da coluna** diretamente na string SQL (`UPDATE produtos SET ${campo} = $1 ...`). Hoje isso é seguro porque `campo` passa por um allowlist (`BULK_CAMPOS_PERMITIDOS`) antes de chegar à query, mas é um padrão perigoso de se replicar — qualquer novo call-site que esqueça o allowlist vira SQL injection real. No lado do XSS, o padrão de `escapeHTML`/`esc()` antes de `innerHTML` é aplicado de forma consistente em todos os arquivos client-side que verifiquei (admin-produtos.js, admin-catalogador.js, catalogo.js, admin-landing.js).

**Autenticação/sessão:** sessões em Postgres (sobrevivem a redeploy), token de 32 bytes aleatórios, TTL de 8h, comparação de senha timing-safe (bcrypt ou hash+`timingSafeEqual`). Isso é sólido. Porém o webhook da Asaas (`POST /api/webhook/asaas`) compara o token com `incomingToken !== expectedToken` — comparação **não** timing-safe, inconsistente com o cuidado explícito tomado no login no mesmo arquivo.

**CSP:** política estrita, sem `unsafe-inline` em script/style — bem feito. Mas achei uma **quebra funcional real** causada pela própria CSP: `admin-pedidos.js` (`consultarCep`) faz `fetch('https://viacep.com.br/...')` **direto do navegador**, enquanto `connect-src` é `'self'`. Isso é bloqueado pelo browser em produção — a única razão de não ter sido percebido é que o `catch` engole o erro silenciosamente (`cepInfo.textContent = ''`). O restante do projeto já resolveu isso corretamente noutro lugar (o catálogo público consulta CEP via `/api/frete`, que chama o ViaCEP no servidor) — só o formulário de pedidos do admin não segue esse padrão.

**Segredos hardcoded:** não encontrei chave/segredo hardcoded no código-fonte (tudo vem de `process.env`). Porém **existe um `cookie.txt` na raiz do projeto** com um valor de sessão em formato real (`vztoken=1233ddf24a94951aed...`). O próprio `SECURITY-CHECKLIST.md` do projeto reconhece esse artefato como parte de um incidente de exposição de segredos e afirma que esse token específico já expirou — mas a existência do arquivo, com conteúdo em formato de credencial real, dentro do material entregue para auditoria, é por si só uma falha de higiene que não deveria persistir independente da validade do token.

**Rate limiting:** cobertura boa e granular (login, upload, escrita, checkout, export, catalogador, frete) — melhor do que a média para um projeto deste porte.

**Validação de entrada:** validação de CPF/CNPJ com dígito verificador real (`documentos.js`), proteção contra injeção de fórmula em CSV, validação de magic bytes em upload de imagem (além do MIME type) — pontos genuinamente bons. Porém a validação de magic bytes está **duplicada** em duas implementações independentes (`detectImageType` em `server.js` e `bufferPareceImagemValida` em `catalogador-router.js`), risco de uma ser corrigida/atualizada e a outra não.

## Arquitetura e consistência

O projeto é uma mistura de dois estilos de maturidade: os módulos mais recentes (`frete.js`, `documentos.js`, `eventos.js`, `comprovante-ia.js`, `catalogador-router.js` + `tripvisuals-adapter.js`) são bem isolados, com dependências injetadas explicitamente e responsabilidade única. O núcleo (`server.js`) continua monolítico — mais de mil linhas com rotas, regras de negócio e acesso a dado misturados —, o que o próprio time já documenta como dívida conhecida (não é achado novo, mas confirmo que a divisão é real e desigual).

Padrões duplicados que deveriam ser unificados:
- **`mostrarToast`/`showToast`**: implementação quase idêntica copiada em pelo menos 5 arquivos (`admin-hub.js`, `admin-landing.js`, `admin-layout.js`, `admin-produtos.js`, `admin-pedidos.js`), apesar de `admin-shared.js` já ser carregado em toda página e ser o lugar natural para isso.
- **`esc()`/`escapeHTML()`**: reimplementada de forma idêntica em pelo menos 5 arquivos client-side.
- **Lista de tipos de produto** (`Camiseta/Regata/Babylook/Moletom`): hardcoded separadamente em `admin-upload.js` (chaves de `PRECOS`), no HTML de `admin-oficina.html` (`<select>`), e em `admin-produtos.js` (`valoresFixosPara`) — três fontes de verdade para o mesmo enum.
- **Consulta de CEP via ViaCEP**: duas abordagens diferentes convivendo no mesmo projeto (uma correta, proxied pelo backend, no catálogo; uma direta do browser, quebrada pela CSP, em Pedidos) — ver seção Segurança.
- **Validação de magic bytes de imagem**: duas implementações independentes (ver Segurança).

## Cobertura de testes

O que está genuinamente testado (`tests/cases/*.mjs`, executados contra um Postgres real com shims para Cloudinary/Groq): eventos de auditoria, edição em massa de produtos + desfazer "inteligente", dashboard, telas de aparência (via jsdom), fluxo do Catalogador IA (upload → identificação → aplicar → bloqueio de reaplicar), frete por região, conferência de comprovante, e um bloco de segurança (CPF/CNPJ, login, CSV injection). Isso é mais rigoroso do que a média de projetos deste porte, e os testes verificam efeito real no banco, não só status HTTP.

O que só parece testado / lacunas reais:
- **PIX/Asaas (`asaas.js`, rota `/api/checkout/pix`) tem zero cobertura de teste** — é justamente o caminho mais sensível (preço vem do servidor, não do cliente) e não há nenhum teste confirmando esse invariante nem o fluxo de webhook.
- A própria documentação do projeto (`AJUSTES-PENDENTES.md`) admite que a decisão de rodar a suíte contra um Postgres real "está em aberto" — ou seja, mesmo essa suíte que existe não faz parte de nenhum processo de CI ou release confirmado.
- Nenhum teste para expiração/invalidação de sessão, para o botão "Encerrar todas as sessões", ou para os cabeçalhos de segurança (CSP/HSTS) realmente presentes na resposta.
- O allowlist de campos em `bulk-campo` (`BULK_CAMPOS_PERMITIDOS`) — que é a única barreira contra o SQL de coluna dinâmica citado na seção de Segurança — não tem teste negativo (tentar um campo fora da lista).
- A lógica de parada automática por erro sistêmico (`state.pararPorErro`, `classificarErro`) no Catalogador é razoavelmente complexa e tem zero cobertura de teste dos caminhos de erro.
- `tests/lib/shims.mjs` renomeia fisicamente `node_modules/cloudinary` e `node_modules/groq-sdk` para instalar fakes, restaurando no `finally`. Se o processo for morto com SIGKILL no meio do teste, os módulos reais ficam presos em `*-real-backup` e o projeto quebra até correção manual — o próprio código reconhece isso na mensagem de erro, mas não há proteção automática (ex.: hook de `process.on('exit')`).
- Praticamente todo o JS client-side (filtros/paginação de `admin-produtos.js`, busca/filtro de `catalogo.js`, máquina de estados de `admin-catalogador.js`) não tem nenhum teste, fora do caso isolado de `admin-landing.js` via jsdom.

## Tratamento de erros

O handler de erro global em `server.js` evita vazar stack trace (`res.status(500).json({error: 'Erro interno do servidor.'})`), e a maioria das rotas tem try/catch individual com log server-side via `console.error`. O tratamento do webhook Asaas é deliberadamente bem pensado (loga antes de processar, sempre responde 200 mesmo em erro interno, para não disparar retry storm) — isso é maduro.

Pontos reais de preocupação:
- **`admin-produtos.js`, função `carregar()`**: em caso de falha no `fetch`, monta a mensagem de erro incluindo até 200 caracteres do corpo bruto da resposta (`corpo.slice(0, 200)`) e injeta no `innerHTML` da tela removendo só `<` e `>` (não é escape HTML completo). Em condição normal a API sempre responde JSON limpo, mas sob uma falha não-JSON (ex.: página de erro HTML do proxy da Railway em um 502/503) isso pode expor detalhe interno na tela do admin, com uma sanitização incompleta.
- A quebra do ViaCEP no formulário de Pedidos (seção Segurança) é um exemplo de **falha silenciosa real**: o `catch` esconde completamente o erro de CSP, e o único sintoma visível é o campo de cidade/UF nunca preencher — nada loga, nada avisa, ninguém percebe a causa raiz sem inspecionar o console do navegador.
- Não há `process.on('unhandledRejection')`/`uncaughtException` no nível do processo Node. A disciplina de `.catch(() => {})` em chamadas fire-and-forget é boa e reduz bastante o risco real, mas ainda não existe uma rede de segurança de último nível — uma única promise esquecida sem catch pode derrubar o processo inteiro (comportamento padrão do Node desde a v15).

## Documentação vs. realidade

- **README.md afirma "Vulnerabilidades | 0 (auditoria mais recente: 27/27 controles)."** Essa é uma alegação forte, numérica e sem link para metodologia ou relatório de auditoria. Esta própria revisão encontrou itens reais (comparação não timing-safe no webhook, validador de imagem duplicado, quebra de CSP no ViaCEP do admin, artefato de credencial em `cookie.txt`) — o suficiente para contradizer a alegação de "0 vulnerabilidades". É exatamente o tipo de afirmação otimista que o próprio "Protocolo Refresh" do projeto (na Base de Conhecimento) adverte contra: "confirmar com dado real, nunca com aparência."
- **Contradição entre documentos do próprio repositório sobre a suíte de testes.** O README apresenta "Suíte própria (`npm test`), 45+ verificações automatizadas" como uma capacidade entregue e funcionando. Já `AJUSTES-PENDENTES.md` (o documento de status mais atual do próprio projeto) diz textualmente: "Suíte de testes (`npm test`). Decisão em aberto sobre Postgres local... Não é urgente." Ou seja, o mesmo projeto se descreve de duas formas incompatíveis para o mesmo fato — o README vende como pronto algo que o próprio time interno ainda trata como pendência não iniciada.
- **`SECURITY-CHECKLIST.md` descreve um incidente de segurança ainda não fechado** (vazamento de `.env`/`cookie.txt` no histórico do git), com passos que dependem de ação manual do usuário (rotacionar credenciais na Railway/Cloudinary) — nada no checklist está marcado como concluído, e o artefato `cookie.txt` mencionado no incidente ainda existe fisicamente no diretório do projeto. Isso não bate com o tom geral de "sistema seguro, pronto" do README.
- Em contraste, alegações específicas e verificáveis se sustentaram bem no código real: validação de CPF/CNPJ com dígito verificador (confirmado em `documentos.js`), ausência de estilo inline (confirmado por amostragem no CSS/HTML), e a prática (visível em `PATCH_NOTES_FASE24.md`) de testar contra dado real de produção antes de empacotar — isso é bom sinal de que nem toda a documentação é inflada, só as afirmações mais absolutas/numéricas de segurança é que não resistem a uma checagem fresca.

## Padrões de UI (Grid/Form/Filtro)

- Entidade: Produtos | Campos: nome, preço, imagem, cor, tipo, gênero, banda, descrição, destaque, oculto, cliques | Tem filtro/paginação: sim (busca texto + filtros de tipo/banda/gênero + 3 atalhos rápidos, paginação de 24 itens)
- Entidade: Pedidos | Campos: produto_nome, tamanho, cliente_nome, cliente_whatsapp, valor, cep, notas, status, comprovante | Tem filtro/paginação: tem filtro (chips de status), sem paginação
- Entidade: Regiões de frete (UF) | Campos: uf, valor, prazo_dias | Tem filtro/paginação: não (lista simples, no máx. 27 linhas)

## Achados por severidade

**CRÍTICO**
- `cookie.txt` (raiz do projeto) — arquivo contendo um valor de cookie de sessão (`vztoken=...`) em formato real, presente no material auditado. O próprio `SECURITY-CHECKLIST.md` do projeto trata isso como parte de um incidente de vazamento de segredo já detectado, afirmando que este token específico expirou — mas o artefato continua existindo em um local revisável/compartilhável, e não há como confirmar de forma independente, a partir do próprio arquivo, se a sessão correspondente ainda é válida no banco (`sessoes`). Recomendação: apagar o arquivo, confirmar via `DELETE /api/sessions/all` que nenhuma sessão residual segue ativa, e não deixar esse tipo de artefato circular mesmo gitignored.

**IMPORTANTE**
- `admin-pedidos.js`, função `consultarCep` — faz `fetch('https://viacep.com.br/...')` diretamente do navegador, mas a CSP do admin define `connect-src 'self'`. Em produção, a chamada é bloqueada pelo browser e o erro é engolido pelo `catch`, quebrando silenciosamente o preenchimento de cidade/UF no formulário de pedido. O padrão correto (proxy via `/api/...` no servidor) já existe no próprio projeto, usado no catálogo público — só não foi replicado aqui.
- `server.js`, rota `POST /api/webhook/asaas` — comparação do token do webhook (`incomingToken !== expectedToken`) não é timing-safe, inconsistente com o cuidado explícito (`timingSafeStringCompare`) aplicado ao login no mesmo arquivo.
- `README.md`, seção de segurança ("Vulnerabilidades | 0 ... 27/27 controles") — alegação numérica absoluta não corroborada por relatório/metodologia linkada, e contradita pelos próprios achados desta revisão e pelo `SECURITY-CHECKLIST.md` do repositório, que descreve um incidente de exposição de credenciais ainda com passos de remediação não confirmados como concluídos.
- `README.md` vs `AJUSTES-PENDENTES.md` — o README apresenta a suíte de testes ("45+ verificações automatizadas") como entrega funcional; o próprio `AJUSTES-PENDENTES.md` do projeto afirma que rodar essa suíte contra Postgres real ainda é "decisão em aberto" — os dois documentos descrevem o mesmo fato de forma incompatível.
- `server.js` (`detectImageType`) e `catalogador-router.js` (`bufferPareceImagemValida`) — duas implementações independentes do mesmo controle de segurança (validação de magic bytes de imagem), com risco real de divergência silenciosa se uma for corrigida/estendida e a outra não.
- `admin-produtos.js`, função `carregar()` — em falha de rede, injeta no DOM até 200 caracteres do corpo bruto da resposta de erro, com sanitização incompleta (só remove `<`/`>`), podendo vazar detalhe interno de backend/proxy sob condições de erro não-JSON.

**SUGESTÃO**
- `mostrarToast`/`showToast` duplicado em pelo menos 5 arquivos admin (`admin-hub.js`, `admin-landing.js`, `admin-layout.js`, `admin-produtos.js`, `admin-pedidos.js`) — deveria ser centralizado em `admin-shared.js`, que já é carregado em toda página.
- `esc()`/`escapeHTML()` reimplementado de forma idêntica em pelo menos 5 arquivos — mesmo caso de centralização perdida.
- Lista fixa de tipos de produto (Camiseta/Regata/Babylook/Moletom) duplicada em `admin-upload.js`, `admin-oficina.html` e `admin-produtos.js` — deveria ter uma única fonte de verdade.
- `admin-catalogador.js` — a constante `JSON_HDRS` (`{ 'Content-Type': 'application/json', ...CREDS.credentials && {} }`) é um spread que sempre resulta em no-op e nunca é de fato usada nas chamadas reais (`apiJSON` define headers próprios inline) — código morto/confuso, candidato a remoção.
- Ausência de `process.on('unhandledRejection'/'uncaughtException')` no `server.js` como rede de segurança de último nível, apesar da boa disciplina de `.catch()` em chamadas fire-and-forget espalhadas pelo código.
- Padrão de coluna dinâmica em SQL (`UPDATE produtos SET ${campo} = $1...`) depende inteiramente da disciplina do chamador em checar o allowlist antes — vale extrair para um helper que valide `campo` internamente, reduzindo a chance de um futuro call-site esquecer a checagem.