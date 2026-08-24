# Trip Visuals Wear — Sistema de Catálogo

Sistema completo de catálogo digital + painel administrativo + integração com WhatsApp,
desenvolvido para uma marca brasileira de camisetas de banda baseada em Recife.

Desenvolvido por [VOIDZONE](https://linkedin.com/in/mauricio-rory).

🔗 **Demo ao vivo:** [tripvisuals.shop](https://tripvisuals.shop)

---

## Sobre

Trip Visuals é uma marca de streetwear especializada em estampas de bandas. O sistema
substitui o fluxo manual de "foto no Instagram → DM → conversa no WhatsApp" por um
catálogo público, organizado e pesquisável, mantendo o WhatsApp como canal de
fechamento da venda — que é como a dona da loja prefere operar.

Em produção com 199 peças catalogadas, painel administrativo completo (Hub, Oficina, Marca & Vitrine, Pedidos, Base de Conhecimento) e catalogação assistida por IA.

---

## Para o cliente

- **Abertura cinematográfica** na primeira visita (animação de 1.5–4s com fundo animado, pula em revisitas via sessionStorage)
- **Catálogo dinâmico** com 3 modos de layout (grade, duo, lista) e busca em tempo real
- **Modal de detalhe** com foto grande, cor, preço, descrição e botão "Adquirir via WhatsApp"
- **Modal de FAQ** com tabela completa de preços por tipo (camiseta MC, MM, regata, babylook, moletom careca, canguru)
- **Fluxo de confirmação pós-WhatsApp** com timeline visual (`Item escolhido → Aguardando confirmação → Em confecção → Enviado`)
- **Frete calculado por região** direto no catálogo público, configurável por estado, sem depender de CNPJ
- **Mensagens WhatsApp pré-preenchidas** específicas por contexto (geral ou por item)
- **Skeleton loaders** + Cloudinary lazy loading para abertura instantânea
- **Acessibilidade**: focus trap em modais, ESC fecha, navegação por teclado, `prefers-reduced-motion` respeitado, touch targets ≥44×44

## Para a dona da loja

O painel administrativo é organizado em cinco áreas: **Hub** (visão geral), **Oficina** (upload, catalogação e gestão de produtos), **Marca & Vitrine** (identidade visual e exibição pública), **Pedidos** (fluxo de status) e **Base de Conhecimento** (documentação viva do sistema, método e protocolos).

- **Login** com hash de senha (bcrypt) + comparação timing-safe (resistente a timing attacks)
- **Sessão persistente** sobrevive a redeploys do Railway (tokens em PostgreSQL, não em memória)
- **Catalogador IA** — depois do upload em massa, a IA lê a estampa de cada peça e sugere banda/gênero automaticamente; a dona da loja só revisa e aplica ou descarta item a item, em vez de digitar tudo à mão
- **Upload em massa** com batch config: tipo, cor e preço padrão aplicados a todos, edição individual por linha, nomenclatura inteligente que limpa nomes de arquivo automaticamente (`alice-in-chains-30.jpeg` → `CAMISETA ALICE IN CHAINS PRETA`, prefixos de câmera/WhatsApp removidos)
- **Gestão de produtos** com filtros por tipo, banda e gênero, edição em massa validada por campo, painel lateral com contadores clicáveis (sem banda identificada, ocultos, preço zero) que já filtram a lista, e paginação para não travar com o catálogo cheio
- **Combobox de 28 cores** padrão (Preta, Off-White, Vinho, etc.) + qualquer cor customizada digitável
- **Marca & Vitrine** — 5 estilos de landing prontos (de assinatura VDZN a dark editorial) com prévia ao vivo, e 3 modos de exibição da vitrine pública (grade, duo, lista), tudo aplicado sem código
- **Pedidos** — cada pedido avança por status (Novo → Confirmado → Em Produção → Enviado → Entregue) com um clique, com conferência assistida por IA de comprovante de pagamento (Pix), confirmação sempre manual
- **Base de Conhecimento** — a lógica do sistema documentada dentro do próprio painel: método, protocolos e histórico de versão, sempre à mão, sem depender de conversa antiga
- **Guias contextuais** nos fluxos principais, com memória por navegador (não repete se já foi visto) e opção de "relembrar" a qualquer momento
- **Bottom navigation** no padrão iOS/Android, toast notifications no lugar de `alert()` nativo

---

## Stack

| Camada    | Tecnologia                            |
|-----------|---------------------------------------|
| Backend   | Node.js · Express                     |
| Database  | PostgreSQL (Railway-hosted)           |
| Image CDN | Cloudinary (auto WebP/AVIF, signed)   |
| IA        | Groq SDK (catalogador de estampas + leitura de comprovante) |
| Auth      | Custom DB-backed sessions (bcrypt)    |
| Frontend  | Vanilla HTML/CSS/JS (sem framework)   |
| Testes    | Suíte própria (`npm test`), 45+ verificações automatizadas |
| Deploy    | Railway (Hobby plan)                  |

---

## Arquitetura

### Segurança

| Controle            | Implementação                                                                 |
|---------------------|-------------------------------------------------------------------------------|
| CSP                 | Estrito por rota (mais restritivo no admin), zero `unsafe-inline`             |
| HSTS                | 1 ano com `includeSubDomains`                                                 |
| Cookies de sessão   | `HttpOnly` + `Secure` + `SameSite=Strict`                                     |
| Rate limiting       | 5 logins / 15 min · 100 uploads / min                                         |
| SQL injection       | 100% parametrizado (`$1`, `$2`…), zero concatenação                           |
| Upload validation   | Multer com filtro MIME (`jpeg/png/webp`) + cap de tamanho                     |
| Cloudinary          | Signed upload server-side, credenciais em env vars                            |
| XSS                 | Escape de HTML em todo render, encode URI em mensagens WhatsApp               |
| Timing attacks      | `crypto.timingSafeEqual` no compare de senha                                  |
| Conexão Postgres    | SSL com `rejectUnauthorized`                                                  |
| CPF/CNPJ            | Validação de dígito verificador                                               |
| CSV export          | Proteção contra injeção de fórmula                                            |
| Log de auditoria    | Tabela `system_events`, log central de eventos administrativos                |
| Vulnerabilidades    | 0 (auditoria mais recente: 27/27 controles)                                   |

### Performance

- Compression middleware (gzip)
- Cloudinary transforms: WebP/AVIF automático, qualidade adaptativa
- Skeleton loaders durante fetch
- Imagens com `loading="lazy"` + `fetchpriority`
- SessionStorage para evitar repetir intro em revisitas

---

## Engenharia assistida por IA

Este projeto foi construído com apoio de IA generativa (Claude, da Anthropic).
Acredito que transparência sobre uso de IA faz parte da postura profissional
moderna — a ferramenta acelerou a entrega, mas as decisões de arquitetura,
escopo e qualidade são minhas.

**Onde a IA acelerou:**
- Geração de código repetitivo e refatorações mecânicas
- Sugestões de implementação para padrões já decididos
- Auditorias automatizadas antes de cada deploy (200+ verificações por iteração)
- Verificação cruzada de CSP, sanitização XSS, parametrização SQL e touch targets

**O que ficou comigo:**
- Definição de escopo e priorização do MVP
- Decisões de arquitetura (sessão custom DB-backed, CSP estrito por rota, downgrade tático do Cloudinary v2 → v1 quando a v2 quebrou o signed upload)
- Recusa explícita de features de baixo valor neste estágio (paginação prematura, picker visual de cores, restruturação do modelo de dados)
- Code review crítico antes de cada deploy
- Interação com a cliente real e tradução das necessidades em escopo técnico

Histórico completo de fases e decisões técnicas em `VERSIONING.md`.

---

## Estrutura do projeto

```
/
├── server.js                  # Express + API + middleware
├── catalogador-router.js      # Rotas do Catalogador IA
├── asaas.js / frete.js        # Pagamento e cálculo de frete
├── package.json
│
├── index.html                 # Landing clássica
├── landing-retro.html         # Landing alternativa (retrô)
├── landing-dark.html          # Landing dark editorial
├── landing-minimalista.html   # Landing minimalista
├── catalogo.html              # Catálogo público
├── login.html                 # Auth
│
├── admin-hub.html             # Hub — visão geral
├── admin-oficina.html         # Oficina — upload, catalogador IA, produtos
├── admin-catalogador.html     # Catalogador IA (standalone)
├── admin-produtos.html        # Gerenciar produtos
├── admin-landing.html         # Marca & Vitrine
├── admin-pedidos.html         # Pedidos — fluxo de status
├── admin-conhecimento.html    # Base de Conhecimento
├── admin-help.html            # Manual / guias contextuais
├── admin-sobre.html           # Sobre / conta
├── admin-config.html          # Configurações da loja
│
├── catalogo.{css,js}          # Catálogo + intro + modais + busca
├── admin.css                  # Design system compartilhado
├── login.{css,js}             # UI de autenticação
│
├── admin-*.js                 # Lógica por página admin
├── tests/                     # Suíte de testes (`npm test`)
├── VERSIONING.md              # Histórico de versões e fases
└── SEGURANCA.md                # Detalhe da postura de segurança
```

---

Desenvolvido por **Mauricio Rory** · [VOIDZONE](https://linkedin.com/in/mauricio-rory)
