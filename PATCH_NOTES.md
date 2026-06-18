# Como aplicar este patch

Este pacote parte do zip real que você me passou (`tripvisuals-main.zip`),
não de uma reconstrução. Toda mudança é aditiva — nenhum arquivo existente
foi reescrito do zero, e o diff confirma isso:

```
server.js        +242 linhas  -7 linhas
admin-pedidos.js +2 linhas
admin.css        +19 linhas  -6 linhas
catalogo.css     +90 linhas  -7 linhas
catalogo.js      +185 linhas  -3 linhas  (reescrita do focus-trap do modal, intencional)
catalogo.html    +41 linhas
style.css        +3 linhas   -1 linha
login.css        +1 linha    -1 linha
privacidade.css  +1 linha    -1 linha
landing-retro.css +2 linhas
index.html       +1 linha    -1 linha   (removeu um style inline que a CSP já bloqueava)
landing-retro.html +1 linha  -1 linha   (mesma correção)
admin-hub.html   +6 linhas
admin-hub.js     +16 linhas
.env.example     +11 linhas

Novos arquivos: asaas.js, ATIVACAO_PAGAMENTOS.md

## Segunda rodada: segurança, consistência, acessibilidade

Depois da automação de PIX, fiz uma auditoria separada cobrindo quatro
frentes: segurança, consistência visual, acessibilidade e camada de
efeitos/animação. Resumo do que foi corrigido:

**Segurança**
- 3 rotas autenticadas estavam sem rate limit que rotas irmãs já tinham:
  upload de fotos do produto, remoção de fotos, e toggle de visibilidade
  individual (a versão em lote já tinha, a individual não)
- Exportação CSV de pedidos (dados pessoais de clientes em massa) ganhou
  um limitador dedicado — não é uma escrita, então não fazia sentido
  reusar o writeLimiter, mas também não devia ficar sem limite nenhum
- `POST /api/config` aceitava qualquer chave arbitrária vinda de uma
  sessão autenticada. Agora só aceita as 22 chaves que o sistema
  realmente usa
- Arquivos `.md` (este aqui incluso, e o `ATIVACAO_PAGAMENTOS.md`) agora
  são bloqueados de serem servidos publicamente — antes, qualquer um
  podia acessar `tripvisuals.shop/ATIVACAO_PAGAMENTOS.md` e ler detalhes
  da infraestrutura de pagamento ainda não lançada

**Acessibilidade (contraste de texto)**
- Encontrei `#555` e `#444` usados como cor de texto em 6 arquivos CSS
  diferentes, herdados de um padrão antigo antes da variável
  `--text-muted` existir. Em tema escuro (o padrão), `#555` dá contraste
  de 2.7:1 e `#444` dá 2.1:1 — ambos falham até o mínimo de 3:1 do WCAG
  para texto grande, e ficam bem abaixo do 4.5:1 exigido pra texto
  pequeno
- O link de Política de Privacidade no rodapé da landing page (tema
  clássico e retrô) estava efetivamente em ~1.7:1 de contraste — quase
  invisível — porque herdava uma cor já escura E ainda aplicava
  opacidade 0.6 por cima. Corrigido para ter cor própria
- Importante: ao revisar isso, percebi que uma correção parecida no
  rodapé de `privacidade.html` NÃO era necessária — aquele link já
  herdava uma regra `a { color: var(--cyan) }` que dava contraste de
  13:1. Cheguei a aplicar a correção por hábito e revertida ao perceber
  o engano, então vale destacar: nem todo "parece igual" é igual, e a
  cascata do CSS importa antes de qualquer ajuste.

**Consistência visual**
- O botão "Pagar com PIX agora" e o botão de submit do formulário PIX
  (adicionados na rodada anterior) não combinavam com o botão de
  WhatsApp ao lado — raio de borda diferente, sem letter-spacing, sem
  uppercase, sem o efeito de levantar no hover. Ajustados pra usar
  exatamente o mesmo tratamento tipográfico

**Efeitos**
- A transição do formulário PIX para o QR code era um corte seco (troca
  de `hidden` sem animação), inconsistente com o resto do modal que
  sempre usa fade-and-rise. Agora usa a mesma animação.

Nada disso muda comportamento visível pro cliente além dos dois pontos
de contraste (que ficam mais legíveis) — é reforço estrutural sobre o
que já existia.

## Terceira rodada: auditoria completa vs. live + correção estrutural

Comparei este patch contra o que está realmente no ar em tripvisuals.shop
(não contra a página do GitHub, que está mostrando uma versão antiga
desatualizada do repositório — confirmei isso buscando a privacidade.html
real no ar, que bate exatamente com o conteúdo de LGPD que já tínhamos).

A descoberta mais importante: nem o fluxo de WhatsApp (o único que
realmente está em uso agora) nem o fluxo de PIX que construí pediam o
TAMANHO da peça em nenhum momento. A automação de pagamento, como estava,
deixava o pagamento confirmado sem a loja saber qual tamanho a pessoa
queria — ou seja, "automatizar o pagamento" não eliminava a necessidade
de uma conversa manual depois, só adiava ela.

Corrigido adicionando um seletor de tamanho (P/M/G/GG/XG) na view
principal do modal de produto, usado pelos DOIS botões de compra:
- **WhatsApp:** a mensagem pré-preenchida agora inclui o tamanho
  escolhido e pergunta apenas confirmação de disponibilidade + frete,
  ao invés de perguntar "quais tamanhos vocês têm"
- **PIX:** o tamanho selecionado é enviado junto com a cobrança e já
  aparece no card do pedido em `/admin-pedidos.html` (a coluna já
  existia no banco, só não estava sendo preenchida)

Ambos os botões agora bloqueiam o avanço com uma mensagem inline se
nenhum tamanho foi selecionado, e o seletor reseta automaticamente
toda vez que um produto diferente é aberto no modal (evita que o
tamanho escolhido pro produto anterior seja enviado por engano pro
produto errado).
```

## Passos

1. Confira `git status` no seu `~/tripvisuals` local — deve estar limpo
   (sem mudanças não commitadas) antes de aplicar isto, pra não perder nada.

2. Copie todos os arquivos desta pasta para dentro de `~/tripvisuals`,
   sobrescrevendo os existentes. Não inclui `.env` real (nunca devolvo
   esse arquivo) — seu `.env` local não é afetado.

3. Revise o diff antes de commitar, se quiser:
   ```bash
   cd ~/tripvisuals
   git diff
   ```

4. Commit e push:
   ```bash
   git add -A
   git commit -m "Infra de pagamento automatico via PIX (Asaas), gated por flag + CNPJ pendente"
   git push origin main
   ```

5. Railway faz o redeploy automático. As migrações de banco (novas
   colunas em `pedidos`, tabela `webhook_log`) rodam sozinhas no
   próximo start do servidor — são idempotentes, então mesmo que o
   deploy reinicie sozinho mais de uma vez, nada quebra.

## O que verificar depois do deploy (2 minutos)

- [ ] `/admin-hub.html` carrega normalmente e mostra o novo card
      "Pagamentos Automáticos: ⚪ Inativo"
- [ ] `/catalogo.html` continua funcionando exatamente como antes —
      abra um produto, confirme que só aparece o botão de WhatsApp
      (o botão de PIX deve estar invisível, porque a flag está 'false')
- [ ] `/admin-pedidos.html` continua funcionando normalmente
- [ ] Nenhum erro novo nos logs do Railway

Nenhum desses pontos deveria mudar de comportamento — esse é o teste
de que a automação está corretamente inerte até você decidir ativá-la.

Para o passo a passo de ativação quando o CNPJ + Asaas estiverem
prontos, veja `ATIVACAO_PAGAMENTOS.md`.
