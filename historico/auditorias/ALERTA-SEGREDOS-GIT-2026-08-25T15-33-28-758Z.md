# Alerta — possível segredo no histórico do git

Gerado automaticamente por `node historico.js auditar` (verificação determinística, não-IA).
Nenhum valor de segredo é reproduzido aqui de propósito — isto só aponta ONDE olhar.

- 2 linha(s) no histórico com formato de credencial real (connection string com senha, chave AWS/Stripe/Asaas, bloco de chave privada). Rode `git log --all -p | grep -E "postgres(ql)?://|AKIA|sk_live_|BEGIN.*PRIVATE KEY"` manualmente pra revisar cada uma — alguma pode ser placeholder de exemplo (user:password@host:port/dbname é OK), mas cada ocorrência precisa ser olhada, não descartada de olho fechado.

## Se confirmar que é real
1. Rotacione a credencial imediatamente (troque a senha/chave na origem, não só no código).
2. Remova do histórico com `git filter-repo --path <arquivo> --invert-paths --force` (faça backup — `git bundle create backup.bundle --all` — antes).
3. Force-push do histórico limpo e confirme com um clone novo que sumiu.
