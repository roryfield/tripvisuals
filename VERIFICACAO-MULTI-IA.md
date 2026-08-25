# Script de verificação independente — Gemini / Claude / Codex

Objetivo: pegar uma segunda (e terceira) opinião de IAs diferentes sobre o mesmo repositório, pra
não depender só do meu próprio julgamento numa limpeza de segurança que eu mesmo fiz. Cada seção
abaixo é **autocontida** — copie só a seção da ferramenta que for usar e cole numa conversa nova.

Funciona melhor se a ferramenta tiver acesso a terminal/repositório (Gemini CLI, Claude Code CLI,
Codex CLI, todas rodando dentro da pasta clonada do projeto). Se só tiver um chat sem terminal,
peça pra você mesmo rodar os comandos e colar a saída — os prompts já preveem os dois casos.

Antes de usar qualquer seção, rode isto uma vez (fora da IA, direto no terminal) pra ter uma cópia
limpa e atual pra elas investigarem:

```bash
git clone https://github.com/roryfield/tripvisuals /tmp/auditoria-independente
cd /tmp/auditoria-independente
```

---

## SEÇÃO 1 — GEMINI

```
Você vai auditar um repositório git em busca de segredos vazados (senhas, chaves de API, tokens)
— tanto no diretório atual quanto em TODO o histórico de commits, não só no estado atual dos
arquivos. Contexto: este repositório já passou por uma limpeza de segurança em 2026-08-25 que
removeu um `.env` real e um `cookie.txt` com token de sessão do histórico usando git-filter-repo.
Sua tarefa é confirmar de forma independente que a limpeza funcionou e que não sobrou nada.

Se você tiver acesso a terminal (rodando dentro da pasta do repositório clonado):
1. Rode: git log --all --oneline -- .env cookie.txt
   → deve retornar VAZIO. Se retornar qualquer linha, isso é uma FALHA CRÍTICA.
2. Rode: git log --all -p | grep -E "postgres(ql)?://|AKIA[0-9A-Z]{16}|sk_live_|-----BEGIN [A-Z ]*PRIVATE KEY-----"
   → revise cada resultado. Distinga valores reais (string longa, aleatória) de placeholders
   óbvios (user:password@host:port/dbname, postgres:senha@localhost — esses são esperados e OK).
3. Rode: git ls-files | grep -iE "\.env($|\.[^e])|cookie|\.pem$|\.key$|credentials|id_rsa"
   → deve retornar só ".env.example" (o modelo, sem valor real) ou nada.
4. Leia o .gitignore e confirme que cobre: .env, .env.local, .env.production, cookie.txt.
5. Vasculhe o código-fonte atual (server.js, asaas.js, catalogador-router.js, e qualquer .js/.json
   na raiz) procurando por chave hardcoded — qualquer string atribuída a uma variável com nome
   tipo API_KEY/SECRET/PASSWORD/TOKEN que não venha de process.env.

Se você NÃO tiver terminal: liste exatamente os comandos acima e peça pro usuário rodar e colar
a saída de volta pra você analisar.

Ao final, dê um veredito claro: LIMPO ou ACHOU ALGO — e se achou algo, qual arquivo/commit
exatamente, sem inventar problema pra preencher espaço caso esteja tudo certo.
```

---

## SEÇÃO 2 — CLAUDE

```
Você vai fazer uma segunda auditoria de segurança, independente, sobre um repositório que já
recebeu uma limpeza (remoção de .env e cookie.txt de todo o histórico via git-filter-repo, em
2026-08-25, com force-push pro GitHub). Não assuma que a limpeza anterior funcionou — verifique
você mesmo do zero.

Rode (você tem acesso a Bash, use-o diretamente na pasta do repositório clonado):

1. git log --all --oneline -- .env cookie.txt
   (esperado: vazio — qualquer commit listado aqui é falha crítica, reporte imediatamente)

2. git log --all -p | grep -oE '(postgres(ql)?://[^ "'"'"'\n]{10,}|AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{10,}|cloudinary://[^ "'"'"'\n]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
   (revise cada match: placeholder óbvio = OK, valor com cara real = achado crítico)

3. git ls-files | grep -iE "\.env($|\.[^e])|cookie|\.pem$|\.key$|credentials|id_rsa"
   (esperado: nada, ou só .env.example)

4. cat .gitignore — confirme que .env*, cookie.txt estão cobertos.

5. Vasculhe server.js, asaas.js, catalogador-router.js e qualquer arquivo de config na raiz por
   segredo hardcoded (valor literal em vez de process.env.ALGO).

6. Se existir scripts/pre-commit-secret-scan.sh, leia o script e avalie se ele de fato bloquearia
   um novo .env sendo commitado (não assuma que funciona só porque existe — teste a lógica).

Reporte um veredito objetivo: cada um dos 6 itens acima, PASSOU ou FALHOU, com o achado exato se
falhou. Não precisa reformular todo o resto do código — o escopo aqui é estritamente
segredos/credenciais, não qualidade de código geral.
```

---

## SEÇÃO 3 — CODEX

```
Task: independent secret-leak audit of a git repository that already went through a cleanup
(removed .env and cookie.txt from all history via git-filter-repo + force-push, 2026-08-25).
Verify the cleanup actually worked — do not take it on faith.

Run these from a shell inside the cloned repo:

1. `git log --all --oneline -- .env cookie.txt`
   Expected: empty output. Any line printed here is a critical failure — report it immediately
   with the commit hash.

2. `git log --all -p | grep -E "postgres(ql)?://|AKIA[0-9A-Z]{16}|sk_live_|sk_test_|-----BEGIN [A-Z ]*PRIVATE KEY-----"`
   Review every match. Obvious placeholders (`user:password@host:port/dbname`,
   `postgres:senha@localhost`) are expected and fine. Anything that looks like a real random
   credential is a critical finding — name the exact commit and file.

3. `git ls-files | grep -iE "\.env($|\.[^e])|cookie|\.pem$|\.key$|credentials|id_rsa"`
   Expected: nothing, or only `.env.example`.

4. Read `.gitignore` — confirm `.env`, `.env.local`, `.env.production`, `cookie.txt` are all
   covered.

5. Grep the current source (`server.js`, `asaas.js`, `catalogador-router.js`, any root-level
   `.js`/`.json`) for hardcoded secrets — a literal string assigned to a variable named like
   `*_KEY`, `*_SECRET`, `*_PASSWORD`, `*_TOKEN` that isn't read from `process.env`.

6. If `scripts/pre-commit-secret-scan.sh` exists, read it and actually reason about whether it
   would catch a newly-added `.env` with real-looking values — don't just confirm it exists.

Report a plain PASS/FAIL per item, with exact file/commit references for any failure. Keep scope
strictly to secrets/credentials — this is not a general code review.
```

---

## Depois de rodar as três

Se as três derem **LIMPO / PASSOU em tudo**, o histórico e o estado atual do repositório estão
confirmados por três fontes independentes (eu + duas outras IAs de fornecedores diferentes) — é o
nível de confiança razoável máximo que dá pra ter sem uma auditoria profissional paga. Se qualquer
uma achar algo que as outras não acharam, trate o achado como real até prova em contrário — mais
vale um falso positivo investigado do que um segredo real ignorado.
