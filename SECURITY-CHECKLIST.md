# Checklist de Segurança — TripVisuals (pós-incidente 2026-08-25)

Este arquivo é pra você seguir sozinho, sem precisar de mim, em qualquer máquina. Cada passo diz
exatamente o que fazer e como confirmar que funcionou. Marque `[x]` conforme for concluindo.

**Contexto em uma frase**: um `.env` real (senha do banco, senha do admin, chaves do Cloudinary) e
um `cookie.txt` (token de sessão) ficaram commitados no histórico do git — o repositório é
público no GitHub, então isso ficou exposto. Já removi os dois de **todo o histórico** (106
commits reescritos) e confirmei isso de forma independente (clone novo do GitHub, não só local).
O que falta é o que só você pode fazer: trocar as credenciais.

> ⚠️ Nenhum sistema fica "imune". O objetivo real e honesto aqui é: nenhum segredo real acessível
> publicamente, histórico limpo, credenciais rotacionadas, e uma trava automática pra isso não se
> repetir. Isso cobre a esmagadora maioria dos ataques reais contra um projeto deste porte
> (credential stuffing a partir de repositório público, secret scraping automatizado do GitHub).
> Não cobre, por exemplo, uma vulnerabilidade de dia zero na própria infraestrutura da Railway —
> isso está fora do que qualquer checklist de aplicação consegue garantir.

---

## PASSO 1 — Trocar as credenciais expostas (faça isto primeiro, é o mais importante)

O histórico já está limpo, mas as credenciais que estiveram expostas continuam sendo as mesmas
até você trocar — presuma que alguém pode ter copiado o valor antes da limpeza.

- [ ] **Senha do banco (Postgres/Railway)**
  1. Abra [railway.app](https://railway.app) → projeto **TripVisuals** → serviço **Postgres**.
  2. Na aba **Variables**, gere uma nova senha (ou recrie a variável `PGPASSWORD`/connection
     string — a Railway tem uma opção de regenerar credenciais do plugin Postgres).
  3. Copie a nova `DATABASE_URL` completa.
  4. Vá no serviço **web** → **Variables** → cole a nova `DATABASE_URL` ali.
  5. Confirme que o serviço `web` reiniciou e voltou com status **SUCCESS** (aba Deployments).

- [ ] **Senha do admin (`/login.html`)**
  1. No serviço **web** da Railway → Variables → gere um novo valor pra `ADMIN_PASSWORD` (ou
     `ADMIN_PASSWORD_HASH`, dependendo de qual está em uso hoje) — use 16+ caracteres aleatórios.
  2. Salve, aguarde o redeploy, e teste o login em `https://tripvisuals.shop/login.html` com a
     senha nova.

- [ ] **Cloudinary (`CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`)**
  1. [cloudinary.com](https://cloudinary.com) → **Settings** → **API Keys** → gere uma nova API
     key/secret (ou revogue a antiga, se a interface oferecer essa opção separada).
  2. Atualize `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` nas Variables do serviço **web** na
     Railway com os novos valores.

- [ ] **`vztoken` do `cookie.txt`** — baixa prioridade. Esse token específico já expirou (validade
  de 13/08/2026, hoje é depois disso), mas se quiser eliminar qualquer dúvida: `DELETE
  /api/sessions/all` (autenticado como admin) derruba todas as sessões ativas de uma vez.

---

## PASSO 2 — Confirmar que o histórico do GitHub está mesmo limpo

Rode isto em qualquer máquina com git instalado (não precisa ser a original):

```bash
git clone https://github.com/roryfield/tripvisuals /tmp/verificar-tripvisuals
cd /tmp/verificar-tripvisuals
git log --all --oneline -- .env cookie.txt
```

**Resultado esperado: nenhuma linha impressa.** Se aparecer qualquer commit, pare e me avise — não
prossiga achando que está resolvido.

---

## PASSO 3 — Confirmar que não existe outro segredo solto no projeto

```bash
cd /tmp/verificar-tripvisuals
git log --all -p | grep -E "postgres(ql)?://|AKIA[0-9A-Z]{16}|sk_live_|\\\$aact_|-----BEGIN [A-Z ]*PRIVATE KEY-----"
```

Revise cada linha que aparecer. Se for claramente um placeholder (`user:password@host:port/dbname`,
`postgres:senha@localhost`) está OK — é o padrão usado em `.env.example` e nos testes. Se for um
valor que parece real (string longa, sem cara de exemplo), trate como o Passo 1 e troque a
credencial correspondente.

```bash
git ls-files | grep -iE "\.env($|\.[^e])|cookie|\.pem$|\.key$|credentials|id_rsa"
```

**Resultado esperado: nenhuma linha** (fora `.env.example`, que é só o modelo, sem valor real).

---

## PASSO 4 — Confirmar que o backup existe

Antes da limpeza, foi feito um backup completo (todo o histórico, todas as branches) em:

```
C:\Users\Rory\backups\2026-08-25-repo-security\tripvisuals-full-PRE-REWRITE.bundle
C:\Users\Rory\backups\2026-08-25-repo-security\untracked-sensitive-files\tripvisuals\cookie.txt
```

- [ ] Confirme que esses dois arquivos existem e **copie essa pasta `backups/` inteira pra outro
  lugar** (um HD externo, um Drive privado) — ela sozinha, na mesma máquina, não é backup de
  verdade. Só seria necessária de novo se algo precisasse ser restaurado do estado anterior à
  limpeza — o que não deve acontecer, mas é o motivo de existir.

---

## PASSO 5 — Revisar e fechar o Pull Request pendente

Existe uma branch `chore/auditoria-licoes-2026-08-25` aberta com o relatório de auditoria e as
lições candidatas:

- [ ] Abra: https://github.com/roryfield/tripvisuals/pull/new/chore/auditoria-licoes-2026-08-25
- [ ] Revise o diff (só adiciona arquivos em `historico/`, não mexe em código de produção).
- [ ] Faça merge (ou feche, se preferir manter fora do `main` por enquanto).

---

## PASSO 6 — Instalar a trava automática (pra isso nunca mais acontecer)

Já criei o script em `scripts/pre-commit-secret-scan.sh`. Ele bloqueia qualquer `git commit` que
tente incluir um arquivo `.env`/`cookie.txt`/chave-com-cara-de-segredo real. Só falta ativar:

```bash
cd caminho/para/tripvisuals
cp scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

- [ ] Instalado e testado (teste: `echo "SENHA=teste123456789012345" >> .env && git add -f .env
  && git commit -m teste` deve ser **bloqueado**; depois `git reset && git checkout -- .env`
  pra desfazer o teste).

> Isso só protege commits feitos **nesta cópia local**. Se você clona o repo em outra máquina,
> repita este passo lá também — o hook não viaja sozinho com o `git clone`.

---

## Assinatura / conclusão

- [ ] Todos os passos acima concluídos em: ____ / ____ / ______
- [ ] Rodei os comandos de verificação (Passo 2 e 3) e o resultado bateu com o esperado
- [ ] Credenciais novas testadas em produção (login funciona, upload de imagem funciona, banco
  responde)

Quando os três estiverem marcados, o ciclo de segurança deste incidente está fechado.
