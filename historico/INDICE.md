# Histórico técnico

Log cronológico de auditorias, testes, correções e melhorias deste projeto.
Preenchido por `node historico.js auditar` e `node historico.js registrar`.
Entradas mais novas ficam no final.

| Data | Tipo | Resumo | Arquivo |
|---|---|---|---|
| 2026-07-15 18:52 | auditoria-gemini | 46 arquivos, modelo gemini-3.5-flash | `historico/auditorias/auditoria-gemini-2026-07-15T21-52-06-146Z.md` |
| 2026-07-15 18:52 | ui-padrao | Entidade: Produtos \| Campos: Nome, Preço, Cor, Tipo, Gênero, Descrição, Cliques \| Tem filtro/paginação: sim (filtro por busca textual de nome/cor; sem paginação). | — |
| 2026-07-15 18:52 | ui-padrao | Entidade: Pedidos \| Campos: Produto, Tamanho, Cliente, WhatsApp, Valor, CEP, Status, Observações \| Tem filtro/paginação: sim (filtro por status; sem paginação). | — |
| 2026-08-25 12:38 | auditoria-claude | 90 arquivos, modelo sonnet | `historico/auditorias/auditoria-claude-tripvisuals-2026-08-25T15-38-20-769Z.md` |
| 2026-08-25 12:38 | ui-padrao | Entidade: Produtos \| Campos: nome, preço, imagem, cor, tipo, gênero, banda, descrição, destaque, oculto, cliques \| Tem filtro/paginação: sim (busca texto + filtros de tipo/banda/gênero + 3 atalhos rápidos, paginação de 24 itens) | — |
| 2026-08-25 12:38 | ui-padrao | Entidade: Pedidos \| Campos: produto_nome, tamanho, cliente_nome, cliente_whatsapp, valor, cep, notas, status, comprovante \| Tem filtro/paginação: tem filtro (chips de status), sem paginação | — |
| 2026-08-25 12:38 | ui-padrao | Entidade: Regiões de frete (UF) \| Campos: uf, valor, prazo_dias \| Tem filtro/paginação: não (lista simples, no máx. 27 linhas) | — |
| 2026-08-25 12:42 | fix | Removidos .env e cookie.txt (credenciais reais) de todo o histórico do git via git-filter-repo, apos exposicao publica no GitHub; credenciais rotacionadas separadamente (ver SECURITY-CHECKLIST.md); hook de pre-commit instalado pra prevenir recorrencia | `SECURITY-CHECKLIST.md` |
