#!/bin/bash
# Verificação completa do Pacote 5 contra o site publicado.
# Roda: bash verificar-pacote5.sh

BASE="https://tripvisuals.shop"
FALHAS=0

checar() {
  local arquivo="$1"
  local padrao="$2"
  local esperado="$3"
  local n=$(curl -s "$BASE/$arquivo" | grep -c -E "$padrao")
  if [ "$n" -ge "$esperado" ]; then
    echo "OK   - $arquivo ($n)"
  else
    echo "FALHA- $arquivo (esperado >= $esperado, veio $n)"
    FALHAS=$((FALHAS+1))
  fi
}

echo "── Navegação fundida em Aparência (9 arquivos) ──"
checar "admin-catalogador.html" "tab-aparencia" 1
checar "admin-help.html"        "tab-aparencia" 1
checar "admin-hub.html"         "tab-aparencia" 1
checar "admin-landing.html"     "tab-aparencia" 1
checar "admin-layout.html"      "redirect-notice" 1
checar "admin-pedidos.html"     "tab-aparencia" 1
checar "admin-produtos.html"    "tab-aparencia" 1
checar "admin.html"             "tab-aparencia" 1

echo ""
echo "── Aparência: abas, estilos, Arsenal, prévia ──"
checar "admin-landing.html" "aparencia-tabs|tabVitrine" 2
checar "admin-landing.js"   "initAparenciaTabs|btnTabVitrine" 2
checar "admin-landing.css"  "arsenal-preview" 1

echo ""
echo "── Os 3 estilos novos, publicados e com conteúdo real ──"
checar "landing-minimalista.html" "landingTitle|landingTagline" 2
checar "landing-minimalista.css"  "." 50
checar "landing-clean.html"       "landingTitle|landingTagline" 2
checar "landing-clean.css"        "." 50
checar "landing-dark.html"        "landingTitle|landingTagline" 2
checar "landing-dark.css"         "." 50

echo ""
echo "────────────────────────────────────"
if [ "$FALHAS" -eq 0 ]; then
  echo "TODOS OS 17 ARQUIVOS CONFIRMADOS"
else
  echo "$FALHAS ARQUIVO(S) COM PROBLEMA — me manda essa saída inteira"
fi
