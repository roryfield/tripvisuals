# Histórico técnico

Log cronológico de auditorias, testes, correções e melhorias deste projeto.
Preenchido por `node historico.js auditar` e `node historico.js registrar`.
Entradas mais novas ficam no final.

| Data | Tipo | Resumo | Arquivo |
|---|---|---|---|
| 2026-07-15 18:52 | auditoria-gemini | 46 arquivos, modelo gemini-3.5-flash | `historico/auditorias/auditoria-gemini-2026-07-15T21-52-06-146Z.md` |
| 2026-07-15 18:52 | ui-padrao | Entidade: Produtos \| Campos: Nome, Preço, Cor, Tipo, Gênero, Descrição, Cliques \| Tem filtro/paginação: sim (filtro por busca textual de nome/cor; sem paginação). | — |
| 2026-07-15 18:52 | ui-padrao | Entidade: Pedidos \| Campos: Produto, Tamanho, Cliente, WhatsApp, Valor, CEP, Status, Observações \| Tem filtro/paginação: sim (filtro por status; sem paginação). | — |
| 2026-08-25 11:40 | auditoria-claude | 87 arquivos, modelo sonnet | `historico/auditorias/auditoria-claude-tripvisuals-2026-08-25T14-40-04-743Z.md` |
| 2026-08-25 11:40 | ui-padrao | Entidade: Produtos \| Campos: nome, preço, cor, tipo, gênero, banda, descrição, oculto, destaque \| Tem filtro/paginação: sim (busca + filtros de tipo/banda/gênero + paginação de 24 por página) | — |
| 2026-08-25 11:40 | ui-padrao | Entidade: Pedidos \| Campos: produto_nome, tamanho, cliente_nome, cliente_whatsapp, cep, valor, status, notas, comprovante \| Tem filtro/paginação: filtro sim (chips por status), paginação não (carrega tudo de uma vez) | — |
| 2026-08-25 11:40 | ui-padrao | Entidade: Catalogador IA (itens identificados) \| Campos: arquivo original, banda, arquivo de saída, aplicado/produto_id \| Tem filtro/paginação: não | — |
| 2026-08-25 11:40 | ui-padrao | Entidade: Frete por região (UF) \| Campos: uf, valor, prazo_dias \| Tem filtro/paginação: não | — |
| 2026-08-25 11:44 | licoes-consolidadas | 24 candidata(s) nova(s) pra revisar | `historico/licoes-candidatas.jsonl` |
| 2026-08-25 12:38 | auditoria-claude | 90 arquivos, modelo sonnet | `historico/auditorias/auditoria-claude-tripvisuals-2026-08-25T15-38-20-769Z.md` |
| 2026-08-25 12:38 | ui-padrao | Entidade: Produtos \| Campos: nome, preço, imagem, cor, tipo, gênero, banda, descrição, destaque, oculto, cliques \| Tem filtro/paginação: sim (busca texto + filtros de tipo/banda/gênero + 3 atalhos rápidos, paginação de 24 itens) | — |
| 2026-08-25 12:38 | ui-padrao | Entidade: Pedidos \| Campos: produto_nome, tamanho, cliente_nome, cliente_whatsapp, valor, cep, notas, status, comprovante \| Tem filtro/paginação: tem filtro (chips de status), sem paginação | — |
| 2026-08-25 12:38 | ui-padrao | Entidade: Regiões de frete (UF) \| Campos: uf, valor, prazo_dias \| Tem filtro/paginação: não (lista simples, no máx. 27 linhas) | — |
