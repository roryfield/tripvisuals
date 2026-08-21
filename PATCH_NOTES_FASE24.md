# Fase 24 — painel lateral, memória do guia, índice de fluxos

Fecha os três pontos pendentes da frente "guia contextual + layout fluido". Testado ao vivo contra o admin em produção (login real, dado real) antes de empacotar — nada aqui subiu de hipótese.

## O que muda

**1. Painel lateral contextual** (Oficina → Produtos, Oficina → Catalogador IA, Pedidos)
Grid de duas colunas via `.vz-main-split`, só a partir de 1440px de largura de tela — abaixo disso, tudo continua exatamente igual, uma coluna só. Medi o acervo real antes de construir: hoje o conteúdo já preenche a largura útil do `.main`, então isto não é "aproveitar espaço vazio que sobrava", é reservar uma coluna nova de propósito.

- **Produtos**: três contadores clicáveis — Sem banda identificada, Ocultos, Preço zero — que já filtram a lista ao clicar (clicar de novo desliga o filtro). Testados contra os 199 produtos reais do catálogo.
- **Catalogador IA**: log compacto das últimas 5 identificações, espelhado via `MutationObserver` do que a própria tabela de resultados já mostra — nenhuma chamada de rede nova.
- **Pedidos**: os mesmos contadores de status que já existem (a versão do Hub é "Produção de Pedidos"), replicados aqui e fixos (`position: sticky`), reaproveitando a classe `.status-filter-chip` já existente — mesmo clique, mesmo comportamento, nenhuma lógica duplicada.

**2. Memória do guia por navegador**
Completar um fluxo do guia contextual até o fim grava `vz-guia-visto-<fluxo>` no `localStorage`. Da próxima vez que a mesma pessoa, no mesmo navegador, visitar aquela tela, o guia não dispara mais sozinho por inatividade. Testado com o motor real: primeira execução marca, segunda é bloqueada, terceira com `forcar:true` ignora a memória de propósito (é o mecanismo que o item 3 usa).

**3. Índice de fluxos guiados, com "relembrar"**
Nova seção no Manual — `Guias → Fluxos guiados`. Lista os três fluxos existentes com um botão "Relembrar esse fluxo" cada, que leva pra tela certa com `?vzguia=relembrar` na URL. Isso ignora a memória só naquela visita — não apaga o que já foi marcado como visto.

## Dois bugs reais encontrados no caminho, corrigidos antes de seguir

**Guia do Catalogador IA não disparava clicando na aba manualmente.** `admin-guia-catalogador.js` escuta o evento `vz-oficina-tab`, mas `admin-oficina.js` nunca disparava esse evento — só existia o atalho por URL (`?tab=catalogador`, usado pelos redirects antigos de `admin-catalogador.html`). Na prática, o guia só ligava chegando por link direto; clicar na aba do jeito que qualquer pessoa realmente usa a tela nunca acionava o guia. Confirmado ao vivo (evento não chegava, testei com um listener real) antes da correção.

**`body { display:flex; align-items:center; justify-content:center }` vazando pra todo o admin.** Regra extraída de `admin-layout.html` (página morta, só redireciona pra `/admin-landing.html`) foi parar no `admin.css` sem escopo — um seletor `body` puro que todo o resto do sistema herdava. Inofensivo até aqui só por acidente (todo conteúdo real é mais alto que a viewport). Confirmado ao vivo que o `body` de toda página computava `display:flex`, e medi antes/depois: nenhuma mudança visual em nenhuma tela real (o efeito prático de esticar já vinha do `max-width` + `margin:auto` do `.main`, não do flex). Escopado agora pra `body.vz-redirect-shell`, só na página que precisa.

## Nota sobre "Sem banda identificada" mostrar 199/199

Não é bug do contador novo — é o estado real do catálogo. O upload em massa original (a maior parte das 199 peças) nunca teve campo "Banda" no formulário de lote, só Tipo/Cor/Gênero/Preço; o nome da banda ficou só dentro do campo `nome`. Produtos criados pelo Catalogador IA preenchem `banda` corretamente (confirmei no código do adaptador) — o contador vira filtro útil de verdade conforme mais produtos entrarem por ali, ou se rodar uma edição em massa preenchendo banda nos já existentes (o editor em massa de Produtos já tem essa opção).

## Arquivos neste pacote

12 modificados, 2 novos (`admin-oficina-side.js`, `AJUSTES-PENDENTES.md` recriado). `entrega-fase24-diff.patch` (fora desta pasta, no mesmo envio) tem o diff completo se preferir `git apply` em vez de copiar arquivo por arquivo.

## Passos

1. `git status` limpo no seu `~/tripvisuals` antes de aplicar.
2. Copie os arquivos desta pasta pra dentro de `~/tripvisuals`, sobrescrevendo os existentes — ou aplique `entrega-fase24-diff.patch` com `git apply`.
3. `git diff` pra revisar, se quiser.
4. Commit e push. Railway faz o redeploy automático.

## O que conferir depois do deploy (2 minutos)

- [ ] Oficina → Produtos, em tela larga (≥1440px): painel lateral aparece, os três contadores batem com o real, clicar filtra.
- [ ] Oficina → Catalogador IA: aba clicada manualmente já ativa o guia contextual (bug corrigido — antes só funcionava vindo de link direto).
- [ ] Pedidos, em tela larga: painel lateral com status replicado, clique filtra igual ao pill do topo.
- [ ] Manual → Guias → Fluxos guiados → "Relembrar esse fluxo" em cada um dos três leva pra tela certa e o guia aparece de novo.
- [ ] Completar um fluxo do guia, recarregar a tela, esperar — não deve mais aparecer sozinho.
- [ ] Nenhuma tela do admin mudou de largura/alinhamento visualmente (correção do `body` é invisível por design).
