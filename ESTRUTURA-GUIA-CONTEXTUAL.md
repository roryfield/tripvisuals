# ESTRUTURA-GUIA-CONTEXTUAL.md — pensamento, lógica e plano completo

Este documento é a "lógica e estrutura" que você pediu — o motor (`admin-guia.js`) já existe e já está provado funcionando no Catalogador IA. O resto do sistema segue exatamente o mesmo padrão, é questão de escrever a lista de passos de cada fluxo, não reinventar o mecanismo.

---

## O padrão, resumido

Inspirado no MTG Arena, mas mais simples de propósito: **nunca bloqueia a tela inteira**. Se o usuário ficar parado depois de começar um processo, aparece um destaque sutil (contorno pulsante) no elemento certo, com um balão de dica ao lado explicando o que fazer. Quando a ação certa acontece, uma confirmação rápida (✓ verde) aparece e o guia avança sozinho pro próximo passo. Se o usuário já sabe o que fazer e age antes da dica aparecer, ela nunca chega a aparecer — não atrapalha quem já é fluente no sistema.

## Por que não bloquear outras ações (diferente do MTGA "puro")

O MTG Arena pode travar ações irrelevantes porque é um jogo com regras fixas — só existe um próximo movimento válido por vez. Um painel administrativo não é assim: a dona da loja pode legitimamente querer fazer outra coisa no meio de um processo (checar um pedido, por exemplo) sem isso ser "errado". Por isso o guia **aponta, não impede** — decisão de design, não limitação técnica.

## Como cada novo fluxo se registra (3 passos, sempre os mesmos)

1. **Lista de passos**, cada um com: qual elemento apontar (seletor CSS), qual mensagem mostrar, e como saber que aquele passo foi cumprido (`condicaoAvanco`, uma função que olha o estado já visível na tela — nunca precisa inventar chamada de rede nova, os contadores já existem).
2. **Gatilho de início** — geralmente o evento de troca de aba que já existe (`vz-oficina-tab` na Oficina; Marca & Vitrine e Pedidos precisariam de um evento equivalente, mesmo padrão).
3. **Um arquivo `.js` pequeno**, só com essa lista — nunca precisa tocar no motor (`admin-guia.js`) nem na lógica de negócio da tela em si.

## Mapa de onde aplicar em seguida — pendência estruturada, não vaga

### Marca & Vitrine
- Passo 1: aponta pros 5 cards de estilo. Avança quando um estilo é selecionado (evento de clique já existe).
- Passo 2: aponta pro botão "Prévia ao vivo do catálogo". Avança quando o painel abre.
- Passo 3: aponta pra "VER AO VIVO". Sem condição de avanço (é o fim do fluxo, só uma sugestão final).

### Pedidos
- Passo 1: aponta pro botão "+ Novo Pedido" (ou "Novo via comprovante", dependendo de qual a loja usa mais). Avança quando um pedido é criado.
- Passo 2, condicional: se o pedido criado tiver `status: novo`, aponta pro card do pedido, sugerindo mudar pra "Confirmado" quando o pagamento cair.
- Passo 3: aponta pra "Configurar frete por região" **só na primeira visita** (não repetir depois que já configurou pelo menos uma região — isso vira uma condição extra de nem sequer iniciar o fluxo, não só de avançar).

### Hub
Só faz sentido um passo único: na primeira visita de todas (conta nova), aponta pra sidebar, mensagem tipo "Essa barra lateral leva pra tudo — Oficina cadastra produto, Marca & Vitrine cuida da loja, Pedidos organiza venda." Não é um fluxo de várias etapas, é uma apresentação de uma vez só.

## Extensão natural — "primeira vez" vs "sempre"

Faz sentido guardar (`localStorage`, por navegador, sem precisar de tabela nova no banco) quais fluxos o usuário já completou uma vez, e não repetir o guia automático depois disso — só reaparece se a pessoa pedir explicitamente ("relembrar como funciona", um botão pequeno, mesma ideia do "Replay Tutorial" que aparece no seu vídeo de referência do MTGA). Isso não está implementado ainda no motor atual (que sempre reativa a cada visita à aba) — é o próximo incremento natural, registrado como pendência abaixo.

## A parte que você disse pra não construir agora — só deixando a lógica escrita

A "tela de tutoriais com todos os tópicos", linkando pra um site futuro (fórum, base de conhecimento, suporte, comercial) — a peça que falta pra isso se conectar ao que já existe é só um **índice central**: uma tela (poderia viver dentro do próprio Manual que já existe) listando todos os fluxos que têm guia contextual, com um botão "relembrar esse fluxo" em cada um — que simplesmente chama `VZGuia.iniciarFluxo(nome, passos)` de novo, manualmente. O link pro site externo é só isso mesmo, um link — não precisa de nada especial de lógica, só existir quando o site existir.

---

## Pendências registradas desta rodada

- [ ] Aplicar o mesmo padrão de guia em Marca & Vitrine e Pedidos (specs acima já prontas, só falta escrever os arquivos `.js` de cada fluxo)
- [ ] Guardar "já vi esse fluxo" por navegador (`localStorage`), pra não repetir toda visita
- [ ] Índice central de fluxos guiados, com "relembrar" manual por fluxo
- [ ] Tela de tutoriais/tópicos + link pro site futuro — só depois que o site existir
