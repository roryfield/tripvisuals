# Ativação dos Pagamentos Automáticos (PIX via Asaas)

Este documento existe porque a automação foi construída ANTES do CNPJ
estar pronto. Toda a infraestrutura já está no código e já foi testada
na medida do possível sem credenciais reais. Nada disso fica visível ou
ativo para os clientes até você seguir os passos abaixo, de propósito.

## Por que é seguro fazer isso agora, antes do CNPJ

Tudo que foi adicionado fica inerte por dois motivos independentes:

1. A variável de ambiente `ASAAS_API_KEY` não existe ainda. Sem ela, o
   módulo `asaas.js` se recusa a fazer qualquer chamada para a API.
2. A flag `checkout_automatico_enabled` na tabela `configuracoes` está
   `'false'` por padrão. O endpoint `/api/checkout/pix` verifica essa
   flag e responde 503 antes de tentar qualquer coisa.

O catálogo (`catalogo.js`) consulta `/api/checkout/status` ao carregar.
Enquanto a resposta for `enabled: false`, o botão "Pagar com PIX agora"
nunca aparece — o cliente só vê o botão de WhatsApp, exatamente como
hoje. Isso significa que você pode subir este código para produção
imediatamente, sem nenhum risco à experiência atual.

## Passo a passo para ativar, quando o CNPJ estiver aprovado

### 1. Criar a conta na Asaas
Abra uma conta em [asaas.com](https://www.asaas.com) com o CNPJ. Antes
de ir para produção, crie também uma conta de **sandbox** (ambiente de
testes) — a Asaas oferece isso gratuitamente e é o jeito certo de testar
sem mexer com dinheiro real.

### 2. Gerar a chave de API
No painel da Asaas: **Integrações → Chaves de API**. Gere uma chave para
o sandbox primeiro. Depois de validar tudo, gere a chave de produção.

### 3. Configurar o Webhook na Asaas
No painel da Asaas: **Integrações → Webhooks → Criar Webhook**.
- URL: `https://tripvisuals.shop/api/webhook/asaas`
- Eventos: marque pelo menos `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`
- Token de autenticação: clique em "Gerar token" (ou crie um forte por
  conta própria — não pode ser a sua chave de API). Copie esse token,
  você vai usá-lo no passo 4.

### 4. Configurar as variáveis de ambiente no Railway
No projeto Railway → aba **Variables**, adicione:

| Variável | Valor |
|---|---|
| `ASAAS_API_KEY` | a chave gerada no passo 2 |
| `ASAAS_ENVIRONMENT` | `sandbox` para testar, `production` quando for ao vivo |
| `ASAAS_WEBHOOK_TOKEN` | o token gerado no passo 3 |

O Railway reinicia o servidor automaticamente ao salvar variáveis novas.

### 5. Testar no Sandbox antes de ativar para clientes reais
Com `ASAAS_ENVIRONMENT=sandbox`, gere um PIX de teste direto pela API
(ou peça ajuda pra gerar um pedido de teste) e confirme que:
- o QR code aparece corretamente
- o webhook chega e o pedido muda para `confirmado` automaticamente
  (confira em `/admin-pedidos.html`)
- a tabela `webhook_log` no banco registrou o evento

A Asaas tem um simulador de pagamento no ambiente sandbox para forçar
a confirmação sem precisar de dinheiro real — confira a documentação
deles em **Sandbox → Simular pagamento**.

### 6. Ligar a flag
Só depois do teste em sandbox funcionar de ponta a ponta, ative:
```sql
UPDATE configuracoes SET valor = 'true' WHERE chave = 'checkout_automatico_enabled';
```
Isso pode ser feito direto no painel do Railway PostgreSQL (aba Data),
ou me pedindo pra adicionar um botão de toggle em `/admin-pedidos.html`
quando chegar a hora — não fiz isso agora de propósito, pra esse switch
não virar algo que se aperta sem querer.

### 7. Trocar para produção
Quando tudo estiver validado em sandbox: troque `ASAAS_API_KEY` pela
chave de produção e `ASAAS_ENVIRONMENT` para `production` no Railway.

## O que monitorar depois de ativado

- `/admin-hub.html` mostra um indicador "Pagamentos Automáticos: 🟢 Ativo
  / ⚪ Inativo" no painel de estatísticas.
- A tabela `webhook_log` guarda CADA notificação recebida da Asaas, com
  uma coluna `processado`. Se algo aparecer como `processado = false`
  com um `erro` preenchido, isso significa que o evento chegou mas algo
  falhou ao processá-lo — o dado não foi perdido, só precisa ser
  reprocessado manualmente.
- A Asaas pausa a fila de notificações depois de 15 falhas consecutivas
  em receber HTTP 200. O endpoint foi escrito para SEMPRE responder 200
  (mesmo em erro interno), justamente para nunca deixar isso acontecer
  por um bug nosso — mas se a fila pausar por outro motivo (ex: site
  fora do ar), a Asaas avisa por e-mail e os eventos retomam na ordem
  quando você reativar a fila no painel deles.

## O que NÃO foi incluído de propósito

- Não foi adicionado um botão de toggle na interface admin para ligar/
  desligar a flag — a ativação via SQL direto é deliberadamente um
  pouco mais manual, para evitar que isso seja ligado por acidente
  antes da hora certa.
- Não foi implementado reembolso automático. Se precisar, isso é outra
  rodada de trabalho usando `POST /v3/payments/{id}/refund` da Asaas.
