# AJUSTES-PENDENTES.md — coisas pra revisar, estado real pós Fase 24

Regra de entrada nesta lista: só cosmético, não estrutural, não trava nenhum pacote, não mexe em dado nem em segurança. Qualquer coisa que não se encaixe nesses critérios eu aviso na hora, não guardo pra depois.

---

## Resolvido nesta rodada (Fase 24 — painel lateral + memória do guia + índice)

Os três pontos que ficaram da frente "guia contextual + layout fluido", todos testados ao vivo contra o admin em produção (login real, dado real — 199 produtos, 1 pedido) antes de empacotar:

- **Painel lateral contextual** (Oficina/Produtos, Catalogador IA, Pedidos) — `.vz-main-split` em grid de duas colunas, só a partir de 1440px de viewport (abaixo disso a tela continua exatamente como estava, uma coluna só). Em Produtos, três contadores clicáveis (sem banda identificada, ocultos, preço zero) que já filtram a lista ao clicar, não só mostram o número — testados contra o acervo real. Em Catalogador IA, log compacto das últimas 5 identificações, espelhado via `MutationObserver` do que a própria tela já mostra (sem chamada de rede extra). Em Pedidos, os mesmos contadores de status do Hub, replicados e fixos (`position: sticky`) pra não precisar rolar — reaproveita a classe `.status-filter-chip` já existente, mesmo clique, mesmo comportamento.
- **Memória do guia por navegador** — completar um fluxo do guia contextual até o fim grava `vz-guia-visto-<fluxo>` no `localStorage`; da próxima vez que a mesma pessoa, no mesmo navegador, visitar aquela tela, o guia não dispara mais sozinho por inatividade. Testado com motor real: primeira execução marca, segunda é bloqueada, terceira com `forcar:true` ignora a memória de propósito.
- **Índice de fluxos guiados, com "relembrar"** — nova seção no Manual (`#fluxos-guiados`), listando os três fluxos existentes com um botão "Relembrar esse fluxo" cada, que leva pra tela certa com `?vzguia=relembrar` na URL — ignora a memória só naquela visita, sem apagar o que já foi marcado como visto.

**Dois bugs reais encontrados no caminho, corrigidos antes de seguir (não empurrados pra depois):**

- **Guia do Catalogador IA não disparava ao trocar de aba manualmente.** `admin-guia-catalogador.js` escuta o evento `vz-oficina-tab` pra saber quando entrar na aba Catalogador, mas `admin-oficina.js` nunca disparava esse evento — só existia o atalho por URL (`?tab=catalogador`, usado pelos redirects antigos). Na prática, o guia só ligava chegando por link direto, nunca clicando na aba como qualquer pessoa realmente usa a tela. Confirmado ao vivo (evento não chegava) antes da correção; `irPara()` agora dispara o evento em toda troca de aba.
- **`body { display:flex; align-items:center; justify-content:center }` vazando pra todo o admin.** Regra extraída de `admin-layout.html` (página morta, só redireciona) foi parar no `admin.css` sem escopo — um seletor `body` puro, herdado por toda tela do sistema. Inofensivo até aqui só por acidente (todo conteúdo real é mais alto que a viewport, a centralização vertical nunca tinha espaço livre pra atuar), mas errado e frágil — numa viewport muito larga, o `.main` passaria a flutuar centralizado em vez de ficar colado no topo/esquerda. Confirmado ao vivo (o `body` de toda página computava `display:flex`, não só a de redirect) e medido antes/depois da correção: nenhuma mudança visual em nenhuma tela real, porque o efeito prático já vinha do `max-width` + `margin:auto` do `.main`, não do flex. Escopado agora pra `body.vz-redirect-shell`, só na página que precisa.

---

## Pendências reais, sem relação com esta rodada — continuam do jeito que estavam

Nenhuma dessas trava as outras. Ordem sugerida, não obrigatória.

- [ ] **Testar desfazer em edição em massa.** Nunca foi confirmado ao vivo em nenhuma sessão desta conversa. Edição em massa em Produtos (dentro da Oficina) → Hub → Atividade Recente → desfazer.
- [ ] **Suíte de testes (`npm test`).** Decisão em aberto sobre Postgres local (Docker é o caminho mais simples). Não é urgente, é "sessão dedicada".
- [ ] **Cadastrar mais regiões de frete**, se fizer sentido pro volume de vendas — hoje só o que já foi configurado manualmente existe. Tela em Pedidos, não mudou de lugar.
- [ ] **Fluxo completo de "criar pedido via comprovante"** — construído, mas ainda sem confirmação ao vivo com Groq e Cloudinary reais processando um comprovante de verdade ponta a ponta.

## Nota sobre o campo "banda", pra não confundir depois

O contador "Sem banda identificada" do novo painel lateral mostra hoje **199 de 199** — não é bug do contador, é o estado real: o campo `banda` existe na tabela desde a Fase 3, mas o upload em massa original (onde entraram a maior parte das 199 peças) nunca teve esse campo no formulário de lote, só Tipo/Cor/Gênero/Preço. O nome da banda ficou só dentro do campo `nome` (ex.: "CAMISETA DEFTONES"), nunca replicado pro campo `banda` separado. Produtos criados pelo Catalogador IA e aplicados ao catálogo **preenchem `banda` corretamente** (confirmado no código do adaptador) — então esse contador só passa a ser útil como filtro de verdade conforme mais produtos entrarem por ali, ou se alguém rodar uma edição em massa preenchendo banda nos já existentes (o próprio painel de Produtos já tem essa ferramenta, campo "Banda" no editor em massa).

## Resolvido em rodadas anteriores, só formalizando o registro

- ~~GROQ_API_KEY ausente~~ — configurada, confirmada via `verificar-instalacao.mjs`.
- ~~Modelo da Groq desatualizado~~ — trocado pra `qwen/qwen3.6-27b`, testado ao vivo com identificação real de produto.
- ~~Senha em texto plano~~ — migrada pra hash bcrypt, `ADMIN_PASSWORD` removida do Railway.
- ~~SSE quebrado no Catalogador~~ — trocado por polling, confirmado funcionando.
- ~~Auditoria de frete sem registro~~ — `PUT`/`DELETE` de região de frete agora logam em `system_events`.
- ~~FAQ e política de privacidade desatualizadas sobre frete~~ — corrigidas.
- ~~Gráficos do Hub não carregavam~~ — CDN externo bloqueado pela própria CSP; Chart.js agora hospedado localmente.
- ~~Bug de tema claro/escuro~~ — quatro cópias de uma regra CSS quebrada removidas.
- ~~Busca no painel flutuante de ajuda~~ — campo de busca ao vivo adicionado.
- ~~Botão "Novo via comprovante" renderizando gigante~~ — corrigido e confirmado ao vivo.
- ~~Motor do guia contextual (Catalogador, Marca & Vitrine, Pedidos)~~ — construído e confirmado ao vivo.
- ~~Layout fluido em telas largas (fix de flex-grow no `.main`)~~ — construído e confirmado ao vivo.
- ~~Base de Conhecimento (`admin-conhecimento.html`, 11 documentos)~~ — construída.
- ~~Modal de imagem no manual~~ — construído.
- ~~Grupos de navegação no manual~~ — construídos.

---

## Itens mencionados em conversa, nunca confirmados como dor real — não viraram trabalho

Nada pendente aqui no momento.
