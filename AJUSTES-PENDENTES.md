# AJUSTES-PENDENTES.md — coisas pra revisar no final, não agora

Regra de entrada nesta lista: só cosmético, não estrutural, não trava nenhum pacote, não mexe em dado nem em segurança. Qualquer coisa que não se encaixe nesses critérios eu aviso na hora, não guardo pra depois.

---

## Resolvidos na v1.1 (ver `VERSIONING.md` pra detalhe técnico)

- ~~1. Ícone de busca sobrepondo o texto em Produtos~~ — causa raiz era empate de especificidade CSS, corrigido.
- ~~2. Zoom na imagem do produto ao passar o mouse~~ — aplicado conforme `MOTION.md`.
- ~~4. Navegação da tela de Ajuda sem volta fácil~~ — sidebar virou barra de chips sticky com busca.

---

## 3. Grade de produtos otimizada pro desktop — parcialmente investigado, verificação ainda pendente do seu lado

**Onde:** `admin-produtos.html`, view padrão (grade).
**O que foi pedido:** hoje os cards empilham em coluna única mesmo em tela grande. No desktop, aproveitar a largura de verdade, mais de um card por linha.
**O que a v1.1 já fez:** o CSS base da grade (`repeat(auto-fill, minmax(300px,1fr))`) foi lido e está correto, produz múltiplas colunas em tela larga sem nenhum bug. A causa mais provável não é CSS quebrado, é a view salva em `localStorage` (`vz-produtos-view`) estar em `compact` ou `gallery` de uma sessão de teste anterior, que força coluna única de propósito (funcionalidade, não bug). Foi adicionada uma blindagem contra valor inválido/corrompido nessa chave, mas isso não reverte um valor válido salvo intencionalmente.
**O que falta:** confirmar qual é o cenário real. Abra o DevTools em Produtos, rode `localStorage.getItem('vz-produtos-view')` no console.
- Se voltar `"compact"` ou `"gallery"`: não é bug, é a view que você mesmo selecionou numa sessão anterior. Troca pra "Grade" na tela mesmo, ou avisa se quiser que o padrão volte a ser sempre grade a cada visita (isso muda comportamento esperado, vale conversar antes).
- Se voltar `"grid"` ou vazio e mesmo assim aparecer coluna única: aí sim é bug real de CSS não capturado pela leitura de código, e volta pra fila de trabalho com prioridade, dessa vez com o dado que faltava.
**Risco de deixar pra depois:** nenhum. Cosmético isolado.

---

# TESTES-PENDENTES.md — validação funcional ainda não confirmada

Diferente da lista acima: isso não é bug conhecido, é teste que ainda não rodou. O deploy em si já foi confirmado saudável (logs limpos), só falta confirmar que a funcionalidade se comporta como esperado no uso real.

## Pacote 6 — desfazer em edição em massa
Fazer uma edição em massa em Produtos, ir no Hub → Atividade Recente, clicar em desfazer, confirmar que reverte certo. Teste extra: editar um produto manualmente depois da edição em massa, confirmar que o desfazer não sobrescreve essa edição mais recente.

## Pacote 6 — staging do Catalogador na Cloudinary
Precisa de `GROQ_API_KEY` configurada. Rodar uma sessão pequena, aplicar um item, confirmar que a imagem do produto criado carrega normal (prova que veio da Cloudinary).

## Pacote 9 — rodar a suíte de testes de verdade

**Situação:** arquivos aplicados no repositório (`package.json` e `tests/`), mas a execução real (`npm test`) ainda não rolou.
**Por que ficou pra depois:** precisa de um Postgres de teste rodando na sua máquina, separado do de produção — o mesmo tipo de configuração que faltou lá atrás pro `pg_dump`. Não é um teste de 2 minutos como os outros, envolve decidir como e onde rodar esse Postgres local (instalar direto, usar Docker, ou outra forma), então merece uma sessão própria, com atenção dedicada, não um encaixe no meio da aplicação dos outros pacotes.
**Risco de deixar pra depois:** nenhum pro rollout em si — a suíte não roda em produção, não afeta nenhum pacote seguinte. O único custo de esperar é não ter ainda a rede de segurança automatizada rodando, mas isso já era verdade antes desse pacote existir, então não é uma regressão, só uma melhoria que ainda não foi ativada.

## Pacote 10 — migrar a senha de admin pra hash (ADMIN_PASSWORD_HASH)

**Situação:** sistema continua funcionando com a senha atual em texto plano, sem nenhum efeito colateral, só o aviso no log do Railway a cada boot.
**O que fazer quando chegar a hora:**
```bash
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_ATUAL', 10))"
```
Copiar a saída inteira (começa com `$2a$` ou `$2b$`) e colar no Railway como a variável `ADMIN_PASSWORD_HASH`. Depois disso, o aviso no log some sozinho.
**Risco de deixar pra depois:** baixo. A senha continua protegida contra o ataque de tempo de resposta mesmo em texto plano (isso já foi corrigido incondicionalmente nesta mesma fase, não depende do hash). O hash é uma camada a mais de proteção, não a única.

---

## Resolvidos na v1.2 (ver `VERSIONING.md` pra detalhe técnico)

- ~~Paginação em Produtos~~ — lista fatiada em páginas de 24 no front, sem mudar o backend.
- ~~Edição em massa confusa~~ — código real tinha um único menu, não dois; o problema real era o campo de valor sem opções fixas pra `tipo`, corrigido.

