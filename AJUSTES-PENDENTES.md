# AJUSTES-PENDENTES.md — coisas pra revisar, estado real pós v2.0

Regra de entrada nesta lista: só cosmético, não estrutural, não trava nenhum pacote, não mexe em dado nem em segurança. Qualquer coisa que não se encaixe nesses critérios eu aviso na hora, não guardo pra depois.

---

## Pendências novas desta rodada (Fase 23 — layout fluido + marca)

- [ ] **Conteúdo pro espaço lateral, próxima versão.** O espaço em si já foi resolvido (`.main` agora estica de verdade em tela larga) — o que falta é decidir o que colocar ali de propósito: filtros ativos, estatísticas rápidas, atalhos. Isso é design de informação, merece sessão própria, não encaixar rápido numa rodada de bug fix.
- [ ] **Ideia de agenda/CRM pessoal (contatos, reuniões, ficha do dono do projeto)** — nasceu numa conversa sobre a Oficina do Tripvisuals, mas **não é escopo deste projeto**. Registrado aqui só como rastro de onde a ideia surgiu; o desenvolvimento real e a lógica por trás disso pertencem ao roadmap do **VDZN-SM**, não a nenhum projeto de cliente.

---

## Resolvido nesta rodada (Fase 23)


- **Bug real de tema claro/escuro** — quatro cópias de uma regra CSS quebrada (`html[data-init] body { visibility: visible !important; }`) anulavam a proteção contra "flash" de tema errado em toda troca de página. Removidas as quatro, sobrou só a regra original correta. Achado a partir de vídeo real gravado no celular, não suposição.
- **Busca no painel flutuante de ajuda** — antes só tinha barra de rolagem pra 13 seções; agora tem campo de busca que filtra ao vivo, mesmo padrão visual do resto do admin.
- **Botão "Novo via comprovante" corrigido** — tinha renderizado gigante (ícone SVG sem tamanho travado), corrigido e confirmado ao vivo.

**Ainda não testado ao vivo:** os itens acima foram corrigidos e testados isoladamente (sintaxe, lógica), mas não confirmados em produção depois do último deploy. Ver `RETOMAR-AQUI.md`.

## Pendência nova, aguardando teste real

- [ ] **Fluxo completo de "criar pedido via comprovante"** — construído, corrigido o bug visual do botão, mas nunca testado com Groq de verdade nem Cloudinary de verdade. Precisa: subir uma foto de comprovante real, confirmar que cria o pedido, confirmar que "Confirmar pagamento" funciona.

---

## Resolvido na v2.0 (ver `VERSIONING.md` pra detalhe técnico completo)

Tudo isso já foi construído, testado (sintaxe verificada, lógica testada isolada, e boa parte confirmada ao vivo em produção nesta mesma sessão) e entregue nos 25 arquivos do pacote v2.0:

- Sidebar em telas largas, unificada numa fonte só (`admin-shared.js`)
- Hub com gráficos reais + largura fluida
- Oficina (Upload + Catalogador + Produtos fundidos, 3 abas)
- Painel de comando com anel de progresso, pílulas de Log/Resultados, botão travado com motivo, indicador de próximo passo
- Configurações de velocidade/concorrência trancadas por padrão
- Prévia embutida do catálogo em Marca & Vitrine
- Suporte real a GIF no upload (dois validadores)
- Botão de auditoria discreto

---

## Pendências reais, sem relação com a v2.0 — continuam do jeito que estavam

Nenhuma dessas trava as outras. Ordem sugerida, não obrigatória.

- [ ] **Testar desfazer em edição em massa.** Nunca foi confirmado ao vivo em nenhuma sessão desta conversa. Edição em massa em Produtos (agora dentro da Oficina) → Hub → Atividade Recente → desfazer.
- [ ] **Suíte de testes (`npm test`).** Decisão em aberto sobre Postgres local (Docker é o caminho mais simples). Não é urgente, é "sessão dedicada", como o próprio projeto já rotulou desde a Fase 9.
- [ ] **Cadastrar mais regiões de frete**, se fizer sentido pro volume de vendas — hoje só o que você já configurou manualmente existe. Tela em Pedidos, não mudou de lugar em nenhuma versão.

## Resolvido em rodadas anteriores, só formalizando o registro

- ~~GROQ_API_KEY ausente~~ — configurada, confirmada via `verificar-instalacao.mjs`.
- ~~Modelo da Groq desatualizado~~ — trocado pra `qwen/qwen3.6-27b`, testado ao vivo com identificação real de produto.
- ~~Senha em texto plano~~ — migrada pra hash bcrypt, `ADMIN_PASSWORD` removida do Railway.
- ~~SSE quebrado no Catalogador~~ — trocado por polling, confirmado funcionando.
- ~~Auditoria de frete sem registro~~ — `PUT`/`DELETE` de região de frete agora logam em `system_events`.
- ~~FAQ e política de privacidade desatualizadas sobre frete~~ — corrigidas.
- ~~Gráficos do Hub não carregavam~~ — CDN externo bloqueado pela própria CSP; Chart.js agora hospedado localmente.

---

## Itens mencionados em conversa, nunca confirmados como dor real — não viraram trabalho

Nada pendente aqui no momento.

