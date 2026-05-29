```markdown
# Trip Visuals Wear — Sistema de Catálogo Digital

Sistema MVP completo desenvolvido por [VOIDZONE](https://linkedin.com/in/mauricio-rory)
para uma marca de streetwear de Recife, BR.

🔗 **Demo ao vivo:** https://web-production-56d80f.up.railway.app

---

## O que o sistema faz

**Para o usuário (público):**
- Landing page com links diretos para catálogo, Instagram e WhatsApp
- Catálogo dinâmico com busca em tempo real e toggle de layout (grade/duo/lista)
- Cada produto tem botão de compra com mensagem pré-preenchida no WhatsApp

**Para a cliente (admin):**
- Login com autenticação segura
- Upload em massa de produtos com nomenclatura automática
- Precificação automática por tipo de peça
- Edição e remoção de produtos existentes
- Painel de controle com estatísticas

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5, CSS3, JavaScript |
| Backend | Node.js + Express |
| Banco de dados | PostgreSQL (Railway) |
| Imagens | Cloudinary |
| Deploy | Railway |
| Design | Figma |

---

## Funcionalidades técnicas

- Autenticação via cookie HTTPOnly com token em memória
- Upload de imagem direto para Cloudinary via stream (sem salvar em disco)
- API REST completa: GET, POST, PUT, DELETE
- CSS compartilhado com design system (variáveis, componentes reutilizáveis)
- Layout responsivo mobile-first
- Bottom navigation no admin (pattern iOS/Android)
- Toast notifications substituindo alert()
- Proteção de rotas admin via /api/me

---

## Estrutura do projeto

```
/
├── server.js              # servidor Express
├── package.json
├── index.html             # landing page
├── catalogo.html          # catálogo do cliente
├── login.html             # login admin
├── admin.css              # design system compartilhado
├── admin-hub.html         # dashboard admin
├── admin.html             # upload de produtos
├── admin-produtos.html    # gerenciar produtos existentes
├── admin-layout.html      # configurar layout da loja
└── style.css              # estilos da landing page
```

---

Desenvolvido por **Mauricio Rory** · [VOIDZONE](https://linkedin.com/in/mauricio-rory)
```

---
