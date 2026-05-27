// [VZ] Login page handler — extracted from login.html for strict CSP.
(function () {
    window.fazerLogin = async function fazerLogin() {
        var senhaInput = document.getElementById('senha');
        var senha      = senhaInput.value.trim();
        var erroMsg    = document.getElementById('erroMsg');
        var btn        = document.getElementById('btnAuth');
        var card       = document.getElementById('loginBox');

        if (!senha) {
            erroMsg.innerText = 'Digite a chave de acesso.';
            senhaInput.focus();
            return;
        }

        erroMsg.innerText = '';
        btn.disabled  = true;
        btn.innerText = 'VERIFICANDO...';

        try {
            var res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha: senha })
            });

            if (res.ok) {
                card.style.opacity = '0';
                setTimeout(function () {
                    document.getElementById('loadScreen').classList.add('active');
                    setTimeout(function () { window.location.href = '/admin-hub.html'; }, 2500);
                }, 400);
                return;
            }

            var msg = 'Acesso negado. Tente novamente.';
            if (res.status === 429) {
                try {
                    var data = await res.json();
                    msg = data.message || 'Muitas tentativas. Aguarde alguns minutos.';
                } catch (_) {
                    msg = 'Muitas tentativas. Aguarde alguns minutos.';
                }
            }

            erroMsg.innerText = msg;
            senhaInput.value  = '';
            senhaInput.focus();
            btn.disabled  = false;
            btn.innerText = 'AUTENTICAR';
            card.classList.remove('shake');
            void card.offsetHeight;
            card.classList.add('shake');
        } catch (e) {
            erroMsg.innerText = 'Erro de conexão com o servidor.';
            btn.disabled  = false;
            btn.innerText = 'AUTENTICAR';
        }
    };
})();
