#!/usr/bin/env bash
# Trava de segurança pré-commit — bloqueia commit de arquivo de segredo (.env, cookie.txt, chave
# privada) ou de valor com cara de credencial real dentro de qualquer arquivo staged.
#
# Instalar:
#   cp scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Nasceu do incidente de 2026-08-25 (.env e cookie.txt reais ficaram no histórico do git por
# meses antes de serem descobertos) — ver SECURITY-CHECKLIST.md. Detecção nunca é tão boa quanto
# prevenção; isto é a prevenção.

set -e

BLOQUEADO=0

# 1) Nome de arquivo proibido, mesmo vazio ou só com placeholder — esses simplesmente não devem
#    ser rastreados pelo git, ponto final.
ARQUIVOS_PROIBIDOS=$(git diff --cached --name-only --diff-filter=A | grep -iE '(^|/)(\.env(\.[^e].*)?|cookie[^/]*\.txt|.*\.pem|.*\.key|credentials.*\.json|id_rsa.*)$' || true)
if [ -n "$ARQUIVOS_PROIBIDOS" ]; then
  echo "BLOQUEADO: tentando commitar arquivo(s) que nunca deveriam ser versionados:"
  echo "$ARQUIVOS_PROIBIDOS" | sed 's/^/  - /'
  BLOQUEADO=1
fi

# 2) Conteúdo com cara de segredo real dentro do diff staged (não só nome de arquivo) — pega o
#    caso de alguém colar uma chave direto num .js/.json por engano.
PADRAO_SEGREDO='(postgres(ql)?://[^ "'"'"']*:[^ "'"'"']{6,}@|AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ASAAS_API_KEY *= *\$aact_[0-9A-Za-z_]+)'
ACHADOS=$(git diff --cached -U0 -- . ':(exclude).env.example' ':(exclude)scripts/pre-commit-secret-scan.sh' \
  | grep -E '^\+' | grep -viE '^\+\+\+' | grep -E "$PADRAO_SEGREDO" || true)
if [ -n "$ACHADOS" ]; then
  echo "BLOQUEADO: linha(s) staged parecem conter um segredo real (senha/chave/token):"
  echo "$ACHADOS" | sed 's/^/  /'
  BLOQUEADO=1
fi

if [ "$BLOQUEADO" -eq 1 ]; then
  echo ""
  echo "Commit cancelado. Se for engano (falso positivo), ajuste o padrão em"
  echo "scripts/pre-commit-secret-scan.sh — não pule o hook com --no-verify a menos que tenha"
  echo "certeza absoluta do que está fazendo."
  exit 1
fi

exit 0
