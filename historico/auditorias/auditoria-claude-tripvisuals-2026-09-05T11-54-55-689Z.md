# Relatório de Auditoria Técnica — Tripvisuals

## Segurança

**Pontos genuinamente bem feitos:** SQL parametrizado na esmagadora maioria das queries; escape de XSS consistente (embora duplicado, ver seção de arquitetura); CSP sem `unsafe-inline` em script/style; hash bcrypt de senha com fallback documentado; comparação de senha e do token de webhook em tempo constante (`timingSafeStringCompare`, `tokensCoincidem`); validação de CPF/CNPJ com dígito verificador real; proteção contra injeção de fórmula em CSV; validação de magic-bytes além do MIME/extensão em upload de imagem; preço do checkout PIX é sempre buscado no servidor, nunca confiado do corpo da requisição (`server.js`, rota `/api/checkout/pix`) — isso é o tipo de coisa que muitos projetos erram e este acertou.

**Achados reais:**

1. **Segredo real presente no repositório.** `cookie.txt` contém um token de sessão com formato real (`vztoken 1233ddf24a94951aed...`) e uma data de expiração plausível (~ago/2026). Mesmo estando no `.gitignore`, o arquivo existe fisicamente no diretório de trabalho e foi incluído neste próprio dump de auditoria — ou seja, circula fora do controle de versão de qualquer forma (backups, screenshots, esta conversa). Isso é exatamente a classe de incidente que `SECURITY-CHECKLIST.md` já documentou como ocorrido antes; o fato de aparecer de novo sugere que o hábito de gerar esse arquivo durante testes (`curl` com cookie jar) continua, e o item "delete o arquivo depois de usar" não virou processo.

2. **CSP idêntica para admin e público, apesar do que a documentação e os comentários afirmam.** Em `server.js`:
   ```js
   const CSP_PUBLIC = CSP_COMMON;
   const CSP_ADMIN  = CSP_COMMON;
   ```
   O comentário acima ("mais restritivo no admin") e o README ("CSP estrito por rota, mais restritivo no admin") descrevem um comportamento que o código não implementa — as duas constantes são o mesmo valor.

3. **Upload do Catalogador permite até 500 arquivos × 20 MB por requisição** (`catalogador-router.js`, `MAX_MB = 20`, `limits: { fileSize: MAX_MB * 1024 * 1024, files: 500 }`), usando `multer.memoryStorage()` e processados via `Promise.all` sobre todos os arquivos simultaneamente — no pior caso, ~10 GB retidos em memória de uma vez, num processo Node único (plano Hobby da Railway). Protegido por auth, mas é uma rota que uma sessão comprometida (ou um upload acidental de lote grande) pode usar pra derrubar o processo.

4. **Falhas ao apagar imagem na Cloudinary são silenciadas sem log** em três pontos de `catalogador-router.js` (`/itens/:file/descartar`, `/forcar-parada`, `DELETE /progress`): `.catch(() => {})`, sem nenhum `console.error`. Isso difere do padrão usado em `server.js` no `DELETE /api/produtos/:id`, que loga o erro. O resultado prático: imagem órfã cobrada na Cloudinary, sem nenhum rastro de que a exclusão falhou.

## Arquitetura e consistência

- **`esc()`/`escapeHTML()` reimplementado de forma idêntica em pelo menos 6 arquivos** (`admin-catalogador.js`, `admin-produtos.js`, `admin-landing.js` como `escapeHTML`/`escapeAttr`, `admin-hub.js` como `escapeHTMLLocal`, `admin-pedidos.js`, `catalogo.js`), sempre a mesma regex `[&<>"']`. `admin-shared.js` já centraliza `showToast` — o mesmo não foi feito para escape de HTML, que é justamente a função mais sensível a ficar consistente.
- **`mostrarToast` reimplementado como wrapper redundante** em ~5 arquivos (`function mostrarToast(msg, erro) { window.showToast(msg, erro); }`) — não agrega nada, é indireção sem propósito depois que `showToast` foi centralizado.
- **Rate limiters quase idênticos, duplicados ~9 vezes** em `server.js` (`loginLimiter`, `uploadLimiter`, `writeLimiter`, `checkoutLimiter`, `webhookLimiter`, `exportLimiter`, `freteLimiter`, `catalogadorLimiter`, `clickLimiter`) — cada um com sua própria chamada `rateLimit({...})` inline, quando uma factory (`makeLimiter(max, windowMs, msg)`) resolveria isso em uma linha por rota.
- **Paginação aplicada em Produtos mas não em Pedidos.** `admin-produtos.js` pagina em blocos de 24 (v1.2, documentado); `admin-pedidos.js` carrega a lista inteira e filtra só no cliente. Mesmo padrão de tela (lista + filtro), resolvido de duas formas diferentes sem razão aparente — Pedidos tende a crescer tanto quanto Produtos.
- **Lógica de branching "Decor 3D vs. Vestuário"** (esconder gênero, trocar select de tipo por texto livre) reimplementada de forma paralela em `admin-produtos.js` e `admin-upload.js`, cada um com seu próprio bloco de troca de DOM — não é um bug, mas é a mesma decisão de produto codificada duas vezes.
- Fora isso, camadas de módulo dedicado (`frete.js`, `eventos.js`, `documentos.js`, `asaas.js`, `comprovante-ia.js`, `catalogador-router.js` + `tripvisuals-adapter.js`) são bem isoladas e documentadas — a maior parte das rotas CRUD em `server.js`, porém, não tem camada de repositório: é `pool.query()` direto dentro do handler, em todo lugar, de forma consistente (o próprio projeto já reconhece isso como dívida em `VERSIONING.md`: "server.js é um arquivo único, grande").

## Cobertura de testes

Existe uma suíte real (`tests/run.mjs` + `tests/cases/*.mjs`), com shims determinísticos para Cloudinary e Groq (`tests/lib/shims.mjs`) — isso é mais rigor do que a média de projetos deste porte. Contagem real de asserções (`r.checar(...)`) gira em torno de ~58, então a alegação de "45+" não é exagerada.

**O que é genuinamente testado:** CPF/CNPJ com dígito verificador, login certo/errado, escape de fórmula em CSV, fluxo completo do Catalogador (upload → identificação mockada → aplicar → bloqueio de reaplicar → reset não destrói item já aplicado), edição em massa com desfazer "inteligente" (não sobrescreve edição manual posterior), frete por região, conferência de comprovante (confere/diverge, confirmação nunca automática), gate do checkout PIX quando desligado, e validação de token do webhook Asaas (ausente/errado/certo) com avanço real do pedido.

**O que só parece testado:**
- A própria criação de cobrança PIX (`POST /api/checkout/pix` com o gate ligado) — o arquivo de teste **admite isso explicitamente**: "exigiria ASAAS_API_KEY real ou um shim do módulo `https` nativo — fora do escopo". É a única rota que move dinheiro real e é a que fica sem teste automatizado.
- Mais grave: por documentação própria do projeto (`AJUSTES-PENDENTES.md`, artigo "Limitações Técnicas" da Base de Conhecimento), a suíte **nunca foi executada contra um Postgres real** — "45 verificações escritas, prontas, nunca executadas... porque isso exige decidir onde rodar esse banco de teste". Ou seja: o código de teste existe e parece sólido lendo-o, mas não há confirmação de que ele realmente passa.
- Nenhum teste verifica que o rate limit de login realmente bloqueia na 5ª tentativa (fácil de testar, e é justamente um controle de segurança citado no README).
- Nenhum teste confirma que os headers de CSP/HSTS/X-Frame-Options são realmente enviados.
- Nenhum teste para `bulk-visibility`, para expiração/nuke de sessão, nem para o front-end público (`catalogo.js`: busca, filtros, fluxo PIX no navegador).
- Dentro dos próprios casos escritos: não há teste do caminho `sem-identificacao` (Groq retorna slug vazio), do caminho `erroLeitura` de comprovante, nem dos gatilhos de `classificarErro`/`pararPorErro` (erro sistêmico interrompendo a fila).

## Tratamento de erros

- Handler de erro genérico no fim de `server.js` retorna mensagem neutra (`'Erro interno do servidor.'`) — bom padrão default.
- Porém vários pontos vazam `err.message` cru para o cliente em vez de seguir esse padrão: `POST /api/catalogador/forcar-parada` (`res.status(500).json({ error: e.message, estadoZerado: true })`), `POST /api/pedidos/:id/comprovante` e `novo-via-comprovante` (`res.status(err.status || 500).json({ error: err.message || ... })`). Como são rotas autenticadas, o risco é baixo, mas quebra a consistência do próprio projeto.
- **Não há `process.on('unhandledRejection')` nem `process.on('uncaughtException')` em nenhum lugar de `server.js`.** Para uma aplicação Node em produção rodando sob PM2/Railway sem esses handlers, uma promise rejeitada em algum ponto não coberto por try/catch pode derrubar o processo sem log estruturado nem shutdown controlado — é uma lacuna de robustez real, não hipotética.
- Falhas silenciosas: ver o achado de segurança #4 acima (`catch(() => {})` sem log em `catalogador-router.js`) — este é também um problema de tratamento de erro, não só de segurança: erro real, sem log, sem consequência visível até alguém notar a fatura da Cloudinary ou um espaço órfão.
- Pontos bem pensados, vale reconhecer: o handler do webhook Asaas sempre retorna `200` mesmo em falha de processamento interno, de propósito documentado (evitar que a Asaas pause a fila de retries), gravando o evento cru em `webhook_log` **antes** de qualquer tentativa de processá-lo — isso é tratamento de erro feito corretamente, não display de bug.

## Documentação vs. realidade

- **README.md afirma "Vulnerabilidades | 0 (auditoria mais recente: 27/27 controles)".** Essa é uma alegação forte demais para o que o código realmente mostra — os quatro achados de segurança listados acima (segredo real presente, CSP admin=público apesar do que o código comenta, upload sem teto realista de payload, exclusões silenciosas na Cloudinary) já contradizem "0". Nenhum é crítico isoladamente, mas "0 vulnerabilidades" é uma afirmação absoluta que uma auditoria honesta dificilmente sustenta.
- **CSP "mais restritivo no admin" é uma alegação verificavelmente falsa** — como mostrado, `CSP_ADMIN` e `CSP_PUBLIC` são literalmente a mesma constante em `server.js`.
- **Contradição interna sobre a suíte de testes.** `docs/relatorio-encerramento-ciclo.html` lista como ponto forte da auditoria "suíte de testes real (sobe servidor + Postgres descartável) cobrindo o fluxo do Catalogador e edição em massa", com tom de capacidade comprovada. Já `AJUSTES-PENDENTES.md` e o artigo "Limitações Técnicas" da própria Base de Conhecimento dizem, sem rodeio, que essa mesma suíte "nunca rodou de verdade" contra um Postgres real. São dois documentos do mesmo projeto descrevendo o mesmo recurso de formas incompatíveis — o segundo é o mais honesto, mas o primeiro (voltado a leitura externa/cliente) dá a impressão errada.
- **`admin-help.html` promete "a sessão expira automaticamente após 8 horas de inatividade"** — o código (`server.js`, `dbCreateSession`/`dbValidateSession`, cookie `Max-Age=28800`) implementa expiração fixa de 8h **a partir do login**, sem nenhuma renovação por atividade. Um admin trabalhando continuamente por mais de 8 horas é deslogado no meio da tarefa, o que contradiz literalmente o texto de ajuda mostrado a ela.
- **README afirma "SQL injection | 100% parametrizado ($1, $2…), zero concatenação"** — impreciso: em `bulk-campo` e no respectivo `desfazer`, o **nome da coluna** é interpolado diretamente na string SQL (`` `UPDATE produtos SET ${campo} = $1 ...` ``). Não é explorável (há allowlist `BULK_CAMPOS_PERMITIDOS` revalidada em ambos os pontos), mas "zero concatenação" não é literalmente verdade.

## Padrões de UI (Grid/Form/Filtro)

- Entidade: Produtos | Campos: nome, preço, categoria, cor, tipo, gênero, banda, descrição, destaque, oculto | Tem filtro/paginação: sim (busca texto + filtros de tipo/banda/gênero/categoria + 3 filtros rápidos no painel lateral; paginação de 24 itens/página)
- Entidade: Pedidos | Campos: produto, tamanho, cliente, WhatsApp, valor, CEP, notas, status | Tem filtro/paginação: filtro sim (chips de status), paginação não (lista completa carregada de uma vez)
- Entidade: Resultados do Catalogador IA | Campos: imagem, arquivo original, banda identificada, arquivo de saída | Tem filtro/paginação: não (sem busca, sem paginação — lista cresce livremente durante a sessão)
- Entidade: Frete por região (UF) | Campos: UF, valor, prazo em dias | Tem filtro/paginação: não (lista pequena, só adicionar/remover, sem edição inline nem paginação)

## Achados por severidade

**CRÍTICO**
- `cookie.txt:1` — token de sessão real (`vztoken=1233ddf24a94951aed...`) presente no diretório de trabalho do projeto, fora do controle de versão mas ainda assim exposto em qualquer cópia/backup/auditoria do repositório. Recomendação: apagar o arquivo, revogar todas as sessões (`DELETE /api/sessions/all`), e tratar como novo incidente da mesma classe já documentada em `SECURITY-CHECKLIST.md`.

**IMPORTANTE**
- `server.js`, trecho `const CSP_PUBLIC = CSP_COMMON; const CSP_ADMIN = CSP_COMMON;` — CSP do admin e do público são idênticas, contradizendo o comentário no próprio arquivo e o README ("mais restritivo no admin"). Perde-se a chance real de reduzir superfície no painel administrativo.
- `catalogador-router.js`, `const MAX_MB = 20` + `limits: { fileSize: MAX_MB * 1024 * 1024, files: 500 }` em `catUpload`, combinado com `Promise.all(req.files.map(...))` em `/upload` — permite até ~10 GB retidos em memória numa única requisição autenticada, sem limite de memória agregado. Risco real de OOM num processo Node único.
- `catalogador-router.js`, três ocorrências de `.catch(() => {})` ao destruir asset na Cloudinary (rotas `/itens/:file/descartar`, `/forcar-parada`, `DELETE /progress`) — falha silenciosa, sem log, gera armazenamento órfão sem rastro.
- Ausência de `process.on('unhandledRejection')`/`process.on('uncaughtException')` em todo `server.js` — sem uma rede de segurança para exceções fora dos try/catch já escritos.
- `AJUSTES-PENDENTES.md` / Base de Conhecimento ("Limitações Técnicas") vs. `docs/relatorio-encerramento-ciclo.html` — a suíte de testes é descrita como capacidade comprovada num documento e como "nunca rodou de verdade" no outro. A suíte precisa ser executada ao menos uma vez para qualquer alegação de cobertura ser confiável.

**SUGESTÃO**
- `esc()`/`escapeHTML()` duplicada de forma idêntica em ~6 arquivos admin + `catalogo.js` — centralizar em `admin-shared.js`, mesmo tratamento já dado a `showToast`.
- `mostrarToast` como wrapper redundante de `window.showToast` em ~5 arquivos — remover a indireção, chamar `showToast` direto.
- 9 instâncias de `rateLimit({...})` quase idênticas em `server.js` — extrair para uma factory `makeLimiter(max, windowMs, msg)`.
- README, seção Segurança: "100% parametrizado, zero concatenação" — ajustar para reconhecer a interpolação de nome de coluna (segura, mas real) em `bulk-campo`/`desfazer`.
- `admin-help.html`: corrigir o texto de expiração de sessão para "8 horas após o login" em vez de "8 horas de inatividade", ou implementar renovação por atividade se a promessa original for a intenção real.