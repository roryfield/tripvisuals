# Tripvisuals — v1.0 (linha de base)

A partir de agora, isto é a versão de referência. Qualquer mudança futura parte daqui, vira v1.1, v1.2, e assim por diante, cada uma com seu próprio registro nesta tabela. Nenhum arquivo abaixo foi aplicado em produção ainda.

## Tudo que existe, numa lista só

| # | Nome | O que entrega |
|---|---|---|
| 1 | Fundação | Tabela `system_events`, log central de auditoria. Duas correções soltas de `credentials: 'include'`. |
| 2 | Scanner do Catalogador | Leitura de estampa por IA, revisão, aplicar/descartar item a item. |
| 3 | Gerenciar Produtos | Filtros por tipo/banda/gênero, edição em massa, campo banda. |
| 4 | Dashboard | Produção de pedidos por estágio, atividade recente, exportar auditoria. |
| 5 | Aparência | Vitrine e Marca unificadas, 5 estilos de landing, Arsenal com prévia, Cores e Fundo com prévia ao vivo. |
| 6 | Pendências resolvidas | Staging do Catalogador migrado pra Cloudinary/Postgres. Desfazer inteligente na edição em massa. |
| 7 | Frete por região | Cálculo de frete no catálogo público, configurável por estado, sem depender de CNPJ. |
| 8 | Comprovante de pagamento | Conferência assistida por IA de PIX recebido na chave pessoal, confirmação sempre manual. |
| 9 | Suíte de testes | 45 verificações automatizadas, rodáveis com `npm test`, sem depender de mim nem de IA nenhuma. |
| 10 | Segurança | Hash de senha (bcrypt), fim do vazamento de tempo na comparação de senha, CPF/CNPJ com dígito verificador, proteção contra injeção de fórmula em CSV, zero estilo inline. |
| 11 | UX/UI — Ajuda e consistência | Manual de ajuda reescrito pra bater com o sistema real. `alert()` nativo trocado pelo toast padrão. |
| 12 | UX/UI — Densidade | Card de produto reorganizado por hierarquia. Atividade Recente do Hub virou recolhível. |
| 13 | UX/UI — Ajustes pendentes | Ver `v1.1` abaixo. |

Cada fase mora na sua própria pasta dentro do zip consolidado, com seu próprio `LEIA-ME.md` explicando o que muda, o passo a passo e como confirmar que funcionou. A ordem de aplicação é 1 → 12, sem pular, porque os arquivos que se repetem entre pastas já vêm acumulados a cada fase.

## O que ainda não está aqui, de propósito

- **Gerenciamento de usuários e acessos** (Fase 13) — ainda em desenho, precisa de uma decisão sua antes de eu construir. Ver seção própria na resposta desta conversa.
- **Sistema de movimento e animação** (Fase 14) — os princípios já estão documentados em `MOTION.md`, a aplicação nas telas já construídas ainda não começou (exceto o zoom de hover em Produtos, aplicado na v1.1, ver abaixo).
- Revisão de UX/UI mais profunda nas telas que não passaram pelo levantamento geral ainda.
- `server.js` monolítico e funções duplicadas entre arquivos do admin — dívida de manutenção, não vulnerabilidade.
- Paginação/carregamento sob demanda em Produtos, e revisão do fluxo de edição em massa (campo de valor livre sem opções fixas) — mencionados em conversa, mas nunca formalmente registrados em `AJUSTES-PENDENTES.md` nem confirmados como dor real ainda. Não estão em nenhuma versão até serem confirmados.

## Convenção de versão daqui pra frente

- **v1.0** = as doze fases desta entrega, aplicadas em ordem.
- Cada mudança nova depois disso ganha um número (v1.1, v1.2...) e uma linha nova nesta tabela, no mesmo formato: número, nome, o que entrega.
- Mudança que quebra algo de uma versão anterior (raro, e sempre evitável dado o padrão aditivo já usado em todo o projeto) muda o número antes do ponto (v2.0). Mudança aditiva ou correção muda o número depois do ponto.
- Este arquivo é o único lugar que precisa ser consultado pra saber "o que tem nessa versão", sem precisar voltar em nenhuma conversa.

---

## v1.1 — AJUSTES-PENDENTES.md, itens 1, 2 e 4 + blindagem do item 3

Aplicada sobre a v1.0, aditiva, nenhum arquivo reescrito do zero.

| Item | O que entrega | Arquivos tocados |
|---|---|---|
| 1. Ícone de busca sobrepondo texto | Causa raiz identificada por leitura de código (empate de especificidade CSS entre `.produtos-search` e a regra global `input[type="text"]`), não era cache nem renderização de navegador. Corrigido igualando a especificidade (`input.produtos-search`), ganha por ordem de origem, sem `!important`. | `admin.css` |
| 2. Zoom no hover da miniatura | `transform: scale(1.04)` no hover, 250ms, `ease-out`, só anima `transform`. Imagem envolvida num wrapper com `overflow: hidden` próprio pra evitar vazamento sobre o card-body (que não tem background próprio). Mesmo valor de escala já usado no modo Mosaico, por consistência. | `admin-produtos.js`, `admin.css` |
| 3. Grade em coluna única no desktop | CSS base já está correto (`repeat(auto-fill, minmax(300px,1fr))`), não precisa de patch de layout. Causa mais provável é a view salva em `localStorage` (`vz-produtos-view`) estar em `compact` ou `gallery` de uma sessão de teste anterior, não um bug. Adicionada blindagem contra valor inválido/corrompido no `localStorage` (se não for `grid`, `compact` ou `gallery`, volta pro padrão `grid`), mas isso não força a view de volta pra grade se o valor salvo for um dos três válidos — isso é escolha do usuário, não bug. | `admin-produtos.js` |
| 4. Navegação da Ajuda sem volta fácil | Sidebar vertical (que sumia por completo abaixo de 900px, sem navegação nenhuma no mobile) substituída por barra de chips horizontal com `position: sticky`, sempre visível em qualquer largura, mais um campo de busca que filtra os chips por texto. Elimina a causa raiz de um bug antigo documentado no próprio CSS (overlay de `position:sticky` com `display:none` cacheado), não reintroduz o padrão que causou aquele bug. | `admin-help.html`, `admin-help.js`, `admin.css`, `admin-shared.js` |

**Achados registrados durante o trabalho, corrigidos por estarem no mesmo escopo:**
- `admin-help.js` alternava a classe `.current` na seção ativa da navegação, mas o CSS antigo só estilizava `.active`. Nunca bateram — o destaque de "seção atual" nunca funcionou desde que foi escrito. Corrigido junto com a reescrita da navegação.
- O drawer de ajuda flutuante (`admin-shared.js`, acessível de qualquer tela do admin) removia `.help-sidebar` antes de injetar o conteúdo. Atualizado pra remover `.help-topics-bar` no lugar — sem isso, a barra de chips sticky nova ia duplicar dentro do drawer.

**Em aberto, não incluído nesta versão por falta de confirmação:** paginação da lista de Produtos e revisão da UX de edição em massa (campo de valor livre). Nenhum dos dois está documentado em `AJUSTES-PENDENTES.md`, e o código real de edição em massa hoje tem um único menu de campo, não dois menus parecidos como descrito em conversa. Precisa de confirmação antes de virar patch.

---

## v1.2 — paginação de Produtos + revisão da edição em massa (confirmados pelo usuário em conversa, agora aplicados)

Aplicada sobre a v1.1, aditiva.

| Item | O que entrega | Arquivos tocados |
|---|---|---|
| Paginação em Produtos | Sem mudança de backend — `/api/produtos` continua trazendo tudo de uma vez (o payload de rede nunca foi o gargalo real). O que mudou é o que entra no DOM: a lista filtrada agora é fatiada em páginas de 24 itens antes de virar cards, com botões Anterior/Próxima e contador "X–Y de Z". Isso ataca a causa real do problema de performance (reconstrução de ~200 cards inteiros a cada busca/filtro), não o sintoma. Seleção em massa continua funcionando entre páginas, porque já era baseada em IDs num `Set`, não em elementos do DOM. Página volta pra 1 automaticamente sempre que busca ou filtro muda, e se auto-corrige se ficar fora do intervalo (produto removido, filtro reduziu o total). | `admin-produtos.js`, `admin.css` |
| Revisão da edição em massa | O código real tinha (e continua tendo) um único menu de campo, não dois menus parecidos — isso ficou registrado como divergência na v1.1. O que era real e ficou corrigido: o campo de valor era sempre texto livre, sem validação, mesmo para `tipo`, que já tem um conjunto fixo de 4 opções usado no editor individual (Camiseta/Regata/Babylook/Moletom) — e o backend não valida isso, então um erro de digitação ali criava um valor de `tipo` que o editor individual nem consegue exibir depois (o `<select>` de lá não mostra nenhuma opção marcada se o valor salvo não for uma das 4). Agora o campo de valor na edição em massa muda de acordo com o campo escolhido: `tipo` vira um menu fixo com as mesmas 4 opções do editor individual; `gênero` reaproveita a mesma lista sugerida (`#generosList`) que já existe na página; `banda` deriva as opções dos valores já em uso nos produtos carregados (evita erro de digitação criando uma banda nova sem querer), sempre com a opção "Outro (digitar)..." pra cadastrar um valor genuinamente novo em qualquer um dos três campos — nenhuma das opções fixas bloqueia a entrada de dado novo, só evita repetir um erro sem querer. | `admin-produtos.js`, `admin.css` |

**Observação, não é bug, é reflexo de dado real:** a lista de bandas sugeridas na edição em massa não normaliza maiúsculas/minúsculas — "Iron Maiden" e "iron maiden" aparecem como duas opções distintas se os dois já existem nos produtos carregados. Optei por não mesclar isso automaticamente, porque não dá pra saber de longe qual grafia é a "certa" sem contexto seu, e forçar uma escolha errada de forma silenciosa seria pior do que mostrar a inconsistência como ela é. Se isso for ruído real no seu catálogo, vale uma limpeza de dado à parte, não um patch de UI.

