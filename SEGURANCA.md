# Segurança — migração de senha e o que mudou na Fase 10

## Migrar `ADMIN_PASSWORD` (texto plano) para `ADMIN_PASSWORD_HASH` (bcrypt)

O projeto continua aceitando `ADMIN_PASSWORD` em texto plano por compatibilidade, mas todo boot ele avisa no log até você migrar. `ADMIN_PASSWORD_HASH` é o caminho correto e recomendado.

**Passo 1 — gerar o hash a partir da senha atual.** Na raiz do projeto, com as dependências já instaladas:

```
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_ATUAL_AQUI', 10))"
```

Isso imprime uma string começando com `$2a$` ou `$2b$`, algo como:

```
$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012
```

**Passo 2 — no Railway**, vá em Variables e:
- Adicione `ADMIN_PASSWORD_HASH` com o valor gerado acima (com os `$` inclusos, cole exatamente como saiu).
- Remova `ADMIN_PASSWORD` (a de texto plano). Se preferir manter como backup por um tempo, tudo bem, o hash tem prioridade e é usado primeiro sempre que os dois estiverem presentes.

**Passo 3 — redeploy.** No próximo boot, o aviso de "senha em texto plano" some do log.

A senha que você digita pra entrar no admin continua exatamente a mesma. Só a forma como ela é guardada e comparada no servidor mudou.

## O que mais mudou nesta fase, resumido

- **Comparação de senha não vaza mais o tamanho dela por tempo de resposta.** A função de comparação agora hasheia os dois lados antes de comparar, então não existe mais um atalho que responde mais rápido ou mais devagar dependendo de quantos caracteres a senha tentada tem.
- **CPF e CNPJ são validados de verdade,** com dígito verificador, não só contagem de dígitos. Isso vale pra rota de checkout automático (`/api/checkout/pix`), que hoje está desligada aguardando o CNPJ, mas já fica correta pro dia que ligar.
- **Export de CSV (pedidos e Catalogador) não pode mais virar fórmula ao abrir no Excel/Sheets.** Um nome de cliente ou produto que comece com `=`, `+`, `-` ou `@` agora sai com um apóstrofo na frente, que o Excel entende como "isso é texto, não fórmula", sem mudar o que aparece na célula.
- **Nenhum estilo inline restante no projeto.** Os 5 casos que violavam o cabeçalho de segurança (Content-Security-Policy) já configurado viraram classes CSS normais.
- **CPF/CNPJ virou seu próprio módulo,** `documentos.js`, sem nada específico da Trip Visuals — reaproveitável em qualquer projeto que precise validar documento brasileiro.
