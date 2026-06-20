# VoidZone WoW Ops — Guia Completo de Setup
# AHDB + Watcher + Deploy · v3.2

---

## PARTE 1 — O que é o AHDB e por que usá-lo

O **AHDB (Auction House Database)** é um addon open-source que faz
**snapshot completo da AH toda vez que você abre a janela**.

Diferente do seu addon VZ_Economy (que só captura os itens que você scanneia
manualmente), o AHDB registra **todos os leilões ativos** em um timestamp.

### Comparação

| Característica       | VZ_Economy (/vzescan) | AHDB              |
|----------------------|-----------------------|-------------------|
| Cobertura            | Todos os itens        | Todos os itens    |
| Trigger              | Manual (/vzescan)     | Auto (ao abrir AH)|
| Velocidade           | ~2-5 minutos          | ~30s (passivo)    |
| Dados históricos     | SavedVariables (VZ)   | SavedVariables    |
| Integração watcher   | ✅ Nativa             | ✅ Via merge      |

**Estratégia:** AHDB como coleta passiva automática + /vzescan para dados
precisos e verificados. O watcher faz merge automático dos dois.

---

## PARTE 2 — Instalação do AHDB

### Passo 1: Baixar o AHDB

1. Acesse: https://www.curseforge.com/wow/addons/auction-house-database
2. Clique em **Install** ou baixe o arquivo .zip manualmente
3. Se usar CurseForge App: ele instala automaticamente

### Passo 2: Instalar manualmente (sem CurseForge App)

```
Descompacte o arquivo baixado.
Copie a pasta "AuctionHouseDB" para:

Windows:
  C:\Program Files (x86)\World of Warcraft\_classic_tbc_\Interface\AddOns\

macOS:
  /Applications/World of Warcraft/_classic_tbc_/Interface/AddOns/

A estrutura deve ficar:
  Interface/AddOns/
  ├── AuctionHouseDB/
  │   ├── AuctionHouseDB.toc
  │   ├── AuctionHouseDB.lua
  │   └── ...
  ├── VZ_AHScanner/
  │   ├── VZ_AHScanner.toc
  │   └── VZ_AHScanner.lua
  └── VZ_Economy/
      └── ...
```

### Passo 3: Ativar no jogo

1. Inicie o WoW e faça login
2. Na tela de seleção de personagem, clique em **AddOns** (canto inferior esquerdo)
3. Certifique-se que **AuctionHouseDB** e **VZ_AHScanner** estão marcados
4. Clique em **Okay** e entre no jogo

### Passo 4: Verificar funcionamento

```
/vzestatus
```

Você deve ver:
```
[VZ] AH: 1.247 itens · realm: Nightslayer · scan: 5m atrás
[VZ] AHDB: instalado · dados serão mesclados no próximo scan
```

Se AHDB estiver instalado, o watcher fará merge automático.

---

## PARTE 3 — Configurar o Watcher Daemon

O watcher é um script Node.js que roda no **seu computador** e monitora
os SavedVariables do WoW, enviando dados ao Railway quando detecta mudanças.

### Passo 1: Localizar a pasta SavedVariables

```
Windows:
  C:\Program Files (x86)\World of Warcraft\_classic_tbc_\WTF\Account\NOME_CONTA\SavedVariables\

macOS:
  /Applications/World of Warcraft/_classic_tbc_/WTF/Account/NOME_CONTA/SavedVariables/
```

Você deve ver arquivos como:
- `VZ_EconomyData.lua` (criado pelo VZ_Economy após /vzescan)
- `AuctionHouseDB.lua` (criado pelo AHDB após abrir a AH)

### Passo 2: Configurar o .env do watcher

Na pasta `sync/`, crie um arquivo `.env`:

```bash
# sync/.env
API_BASE=https://SEU-APP.up.railway.app
API_KEY=SUA_API_KEY_AQUI

# Windows (use barras normais ou duplas)
WOW_SAVE_DIR=C:/Program Files (x86)/World of Warcraft/_classic_tbc_/WTF/Account/SEUCONTA/SavedVariables

# macOS
# WOW_SAVE_DIR=/Applications/World of Warcraft/_classic_tbc_/WTF/Account/SEUCONTA/SavedVariables

# Chave do realm exatamente como aparece no AHDB
# (você verá no arquivo AuctionHouseDB.lua — ex: "Nightslayer-Horde")
WOW_REALM_KEY=Nightslayer-Horde

LOG_LEVEL=info
```

### Passo 3: Instalar dependências e rodar

```bash
# Na pasta sync/
cd sync

# Instalar dotenv (única dependência)
npm init -y
npm install dotenv

# Rodar o watcher
node watcher.js
```

Saída esperada:
```
  ╔══════════════════════════════════════╗
  ║  VoidZone Watcher Daemon  v3.2       ║
  ║  VZ_Economy + AHDB Integration       ║
  ╚══════════════════════════════════════╝

[10:23:15] API Base:    https://meu-app.up.railway.app
[10:23:15] SavedVars:   C:/...SavedVariables
[10:23:15] Throttle:    5s
[10:23:15] ✓ Railway API acessível.
[10:23:15] Monitorando VZ_Economy: C:/...VZ_EconomyData.lua
[10:23:15] Monitorando AHDB: C:/...AuctionHouseDB.lua
[10:23:15] Executando sync inicial...
[10:23:16] VZ_AHData: 847 itens, lastUpdate=1717000000
[10:23:16] AHDB: 1.247 itens válidos de "Nightslayer-Horde"
[10:23:16] Merge: 1247 AHDB + 847 VZ = 1.391 itens únicos
[10:23:17] ✓ Sync OK — 1391 itens enviados ao Railway.
[10:23:17] Daemon ativo. Aguardando mudanças nos SavedVariables...
```

### Passo 4: Deixar o watcher rodando

Para uso contínuo, use o PM2:

```bash
npm install -g pm2

# Na pasta sync/
pm2 start watcher.js --name vz-watcher
pm2 save
pm2 startup   # configura início automático com o sistema

# Ver logs
pm2 logs vz-watcher

# Parar
pm2 stop vz-watcher
```

---

## PARTE 4 — Fluxo completo de uso

### Dia a dia (2 minutos de setup por sessão de jogo)

```
1. Inicie o watcher (ou já está rodando via PM2)
   → node watcher.js

2. Abra o WoW → entre no personagem

3. Vá ao Auction House

4. AHDB faz snapshot automático ao abrir a AH
   → Em ~35s o watcher detecta e sincroniza

5. Para dados mais precisos: execute /vzescan
   → Scan completo de todos os itens (~2-5 min)
   → Watcher detecta mudança e sincroniza o merge

6. Abra o dashboard no navegador
   → dashboard.html (Hostinger)
   → Dados atualizados automaticamente
   → Consulte o ORACLE para análise
```

---

## PARTE 5 — Deploy no Railway (Backend)

### Passo 1: Variáveis de ambiente no Railway

No painel do Railway, vá em **Variables** e adicione:

```
DATABASE_URL        = (gerado automaticamente pelo Railway PostgreSQL)
JWT_SECRET          = (rode: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
API_KEY             = (rode: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
CLIENT_URL          = https://SEU-DOMINIO.com
NODE_ENV            = production
MAX_USERS           = 2
PORT                = 3000
```

### Passo 2: Deploy

```bash
# Na raiz do projeto
git init
git add .
git commit -m "chore: initial deploy v3.2"

# Conecte ao Railway
railway login
railway link
railway up
```

### Passo 3: Verificar health check

```bash
curl https://SEU-APP.up.railway.app/health
# Resposta: {"ok":true,"ts":1717000000000}
```

### Passo 4: Inicializar banco (automático no boot)

O schema é criado automaticamente na primeira execução via `schema.ensureAll()`.
Verifique nos logs do Railway que aparece:
```
[Boot] Database schemas verified.
[Boot] VoidZone Ops ready → http://localhost:3000
```

---

## PARTE 6 — Deploy no Hostinger (Frontend)

### Passo 1: Configurar API_BASE no dashboard

Em `client/dashboard.html`, linha do `VZ_CONFIG`:

```javascript
window.VZ_CONFIG = {
  apiBase: 'https://SEU-APP.up.railway.app',  // ← trocar aqui
};
```

Em `client/login.html`, nas constantes `CONFIG`:

```javascript
const CONFIG = {
  API_BASE:         'https://SEU-APP.up.railway.app',
  GOOGLE_AUTH_URL:  'https://SEU-APP.up.railway.app/auth/google',
  DASHBOARD_URL:    './dashboard.html',
};
```

### Passo 2: Upload via Hostinger File Manager

```
Estrutura de arquivos para o Hostinger:

public_html/
├── login.html        ← tela inicial / login
├── dashboard.html    ← dashboard principal
└── js/
    ├── api.js        ← cliente API
    └── dashboard.js  ← lógica do dashboard
```

Acesse o Hostinger → hPanel → File Manager → public_html/
Faça upload de todos os arquivos.

### Passo 3: Configurar CORS no Railway

Certifique-se que `CLIENT_URL` no Railway é exatamente a URL do Hostinger:
```
CLIENT_URL=https://meudominio.com
```
Sem barra final, sem www (a menos que seja o domínio real).

---

## PARTE 7 — Troubleshooting

### Watcher não detecta mudanças
```bash
# Verifique o caminho exato da pasta
ls "C:/Program Files (x86)/World of Warcraft/_classic_tbc_/WTF/Account/"
# Você deve ver sua conta ACCOUNT_NAME

# Ajuste WOW_SAVE_DIR para incluir o nome da conta
WOW_SAVE_DIR=.../WTF/Account/BATTLENET_EMAIL/SavedVariables
```

### AHDB não é detectado
```bash
# Verifique o nome do arquivo SavedVariables
ls .../SavedVariables/ | grep -i auction
# Procure por AuctionHouseDB.lua ou AHDatabase.lua
# Ajuste ahdbFile no watcher.js se o nome for diferente
```

### Dashboard não carrega dados
```bash
# 1. Verifique se o token está salvo
# No browser console (F12):
localStorage.getItem('vz_token')

# 2. Teste a API diretamente
curl -H "Authorization: Bearer SEU_TOKEN" \
     https://SEU-APP.up.railway.app/api/ah/status

# 3. Verifique CORS no Railway — CLIENT_URL deve ser exato
```

### Erro 401 no watcher
```bash
# API_KEY do watcher deve ser idêntica ao API_KEY no Railway .env
# Verifique sem espaços extras
echo $API_KEY
```

---

## PARTE 8 — Comandos de referência rápida

### In-game (WoW)
| Comando         | Ação                                    |
|-----------------|-----------------------------------------|
| `/vzescan`      | Inicia scan completo da AH              |
| `/vzescan stop` | Cancela scan em andamento               |
| `/vzeprice ouro`| Busca preço de item com "ouro" no nome  |
| `/vzestatus`    | Mostra status do último scan + AHDB     |
| `/vztrack`      | Abre tracker de gold (VZ_Tracker)       |
| `/vzr`          | Toggle HUD de rota (VZ_Routing)         |
| `/vzrplan`      | Session planner com timer               |

### Watcher
| Comando                   | Ação                        |
|---------------------------|-----------------------------|
| `node watcher.js`         | Inicia daemon               |
| `pm2 start watcher.js`    | Inicia como serviço         |
| `pm2 logs vz-watcher`     | Ver logs em tempo real      |
| `LOG_LEVEL=debug node ...`| Modo verbose para debug     |

---

*VoidZone WoW Ops · ORACLE System · v3.2 · Nightslayer US PvP*
