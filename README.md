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

O MVP foi entregue com 170+ peças catalogadas em uma única sessão de upload em massa.

---

## Para o cliente

- **Abertura cinematográfica** na primeira visita (animação de 1.5–4s com fundo animado, pula em revisitas via sessionStorage)
- **Catálogo dinâmico** com 3 modos de layout (grade, duo, lista) e busca em tempo real
- **Modal de detalhe** com foto grande, cor, preço, descrição e botão "Adquirir via WhatsApp"
- **Modal de FAQ** com tabela completa de preços por tipo (camiseta MC, MM, regata, babylook, moletom careca, canguru)
- **Fluxo de confirmação pós-WhatsApp** com timeline visual (`Item escolhido → Aguardando confirmação → Em confecção → Enviado`)
- **Mensagens WhatsApp pré-preenchidas** específicas por contexto (geral ou por item)
- **Skeleton loaders** + Cloudinary lazy loading para abertura instantânea
- **Acessibilidade**: focus trap em modais, ESC fecha, navegação por teclado, `prefers-reduced-motion` respeitado, touch targets ≥44×44

## Para a dona da loja

- **Login** com hash de senha + comparação timing-safe (resistente a timing attacks)
- **Sessão persistente** sobrevive a redeploys do Railway (tokens em PostgreSQL, não em memória)
- **Upload em massa** com batch config: tipo, cor e preço padrão aplicados a todos, edição individual por linha
- **Nomenclatura inteligente** — limpa nomes de arquivo automaticamente:
  - `alice-in-chains-30.jpeg` → `CAMISETA ALICE IN CHAINS PRETA`
  - `WhatsApp Image 2026-05-28 at 17.44.51.jpeg` → usa nome da coleção do batch
  - Números finais ignorados, prefixos camera/WhatsApp removidos
- **Combobox de 28 cores** padrão (Preta, Off-White, Vinho, etc.) + qualquer cor customizada digitável
- **Edição/remoção** de produtos com 2 modos de visualização (grade ou lista compacta) e busca
- **Configuração de landing** com botão "Ver ao vivo" para preview imediato em nova aba
- **Bottom navigation** no padrão iOS/Android
- **Toast notifications** substituindo `alert()`

---

## Stack

| Camada    | Tecnologia                            |
|-----------|---------------------------------------|
| Backend   | Node.js · Express                     |
| Database  | PostgreSQL (Railway-hosted)           |
| Image CDN | Cloudinary (auto WebP/AVIF, signed)   |
| Auth      | Custom DB-backed sessions             |
| Frontend  | Vanilla HTML/CSS/JS (sem framework)   |
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

---

## Estrutura do projeto

```
/
├── server.js                  # Express + API + middleware
├── package.json
│
├── index.html                 # Landing clássica
├── landing-retro.html         # Landing alternativa (retrô)
├── catalogo.html              # Catálogo público
├── login.html                 # Auth
│
├── admin-hub.html             # Dashboard
├── admin.html                 # Upload em massa
├── admin-produtos.html        # Gerenciar produtos
├── admin-layout.html          # Trocar tema
├── admin-landing.html         # Configurar landing
├── admin-config.html          # Configurações da loja
├── admin-help.html            # FAQ admin
│
├── catalogo.{css,js}          # Catálogo + intro + modais + busca
├── admin.css                  # Design system compartilhado
├── login.{css,js}             # UI de autenticação
├── style.css                  # Landing clássica
├── landing-retro.css          # Landing retrô
│
└── admin-*.js                 # Lógica por página admin
```

---

## Rodando localmente

```bash
git clone https://github.com/roryfield/tripvisuals.git
cd tripvisuals
npm install
cp .env.example .env
# Configure: DATABASE_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
# CLOUDINARY_API_SECRET, ADMIN_PASSWORD_HASH
npm start
```

Sobe em `http://localhost:3000`.

---

## Roadmap

Recursos planejados mas intencionalmente fora do MVP:

- Categorias por gênero musical (Rock, Metal, Grunge…) com filtros no catálogo
- Lista de interesse (múltiplos itens em uma única mensagem WhatsApp)
- Download do catálogo em ZIP (botão "em breve" já visível na UI)
- Picker visual de cores com swatches
- Paginação / infinite-scroll (necessário ao passar de ~500 produtos)

---

Desenvolvido por **Mauricio Rory** · [VOIDZONE](https://linkedin.com/in/mauricio-rory)
