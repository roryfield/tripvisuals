// [VZ] Assistente de captura de fotos multi-ângulo (2026-09-07)
//
// Modal autocontido, sem dependência de outro script do admin. Chamado via
// window.abrirAssistenteFotos({ id, categoria, nome }) a partir de
// admin-produtos.js (botão "📸 Fotos" em cada card).
//
// Roteiro de captura por categoria (ver docs/decisão em conversa com Rory,
// 2026-09-07): 'vestuario' pede só frente+verso (uma peça de roupa não ganha
// nada com giro completo, e cada foto extra é esforço de fotografia real);
// 'decor3d' pede uma sequência de ângulos numerados (padrão de mercado pra
// visualizador de giro: 8 a 12 fotos em volta do objeto numa base giratória).
//
// Cada foto sobe já com um "papel" (frente/verso/angulo) via
// POST /api/produtos/:id/fotos — o catálogo público usa esse papel pra
// decidir se mostra flip (frente/verso) ou giro (angulo). Reordenar usa
// PATCH .../fotos/:fotoId (campo posicao). Nada aqui decide a UI do
// catálogo — só alimenta os dados que catalogo.js consome.

(function () {
    'use strict';

    const ANGULOS_SUGERIDOS = 8;
    const ANGULOS_MAXIMO = 16;

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    let estado = null; // { produto, fotos, qtdAngulosAlvo }

    function fecharAssistente() {
        const overlay = document.getElementById('fotosWizardOverlay');
        if (overlay) overlay.remove();
        estado = null;
    }

    async function carregarFotos(produtoId) {
        try {
            const r = await fetch('/api/produtos/' + produtoId + '/fotos', { credentials: 'include' });
            if (!r.ok) return [];
            return await r.json();
        } catch (_) { return []; }
    }

    function slotsVestuario(fotos) {
        const porPapel = papel => fotos.find(f => f.papel === papel) || null;
        return [
            { papel: 'frente', rotulo: 'Frente', dica: 'Peça esticada, de frente, luz uniforme.', foto: porPapel('frente') },
            { papel: 'verso',  rotulo: 'Verso',  dica: 'Mesma peça virada, mesmo enquadramento.', foto: porPapel('verso') },
        ];
    }

    function slotsDecor3d(fotos, qtdAlvo) {
        const angulos = fotos.filter(f => f.papel === 'angulo').sort((a, b) => a.posicao - b.posicao);
        const slots = [];
        for (let i = 0; i < qtdAlvo; i++) {
            slots.push({
                papel: 'angulo',
                posicao: i,
                rotulo: 'Ângulo ' + (i + 1) + ' de ' + qtdAlvo,
                dica: i === 0
                    ? 'Objeto na base giratória, posição inicial (0°).'
                    : 'Gire a base ' + Math.round(360 / qtdAlvo) + '° a partir da foto anterior.',
                foto: angulos[i] || null,
            });
        }
        return slots;
    }

    function render() {
        const overlay = document.getElementById('fotosWizardOverlay');
        if (!overlay) return;
        const { produto, fotos, qtdAngulosAlvo } = estado;
        const isDecor = produto.categoria === 'decor3d';
        const slots = isDecor ? slotsDecor3d(fotos, qtdAngulosAlvo) : slotsVestuario(fotos);
        const prontos = slots.filter(s => s.foto).length;

        overlay.querySelector('.fw-modal').innerHTML = `
            <div class="fw-header">
                <div>
                    <h2>📸 Fotos — ${escapeHtml(produto.nome)}</h2>
                    <p class="fw-sub">${isDecor ? 'Decor 3D · sequência de ângulos pro giro no catálogo' : 'Vestuário · frente e verso pro flip no catálogo'}</p>
                </div>
                <button class="fw-close" type="button" aria-label="Fechar">×</button>
            </div>
            <p class="fw-progress">${prontos} de ${slots.length} prontos</p>
            <div class="fw-slots">
                ${slots.map((s, i) => `
                    <div class="fw-slot ${s.foto ? 'fw-slot-pronto' : ''}" data-idx="${i}">
                        <div class="fw-slot-preview">
                            ${s.foto ? `<img src="${escapeHtml(s.foto.url)}" alt="${escapeHtml(s.rotulo)}">` : `<span class="fw-slot-num">${i + 1}</span>`}
                        </div>
                        <div class="fw-slot-info">
                            <strong>${escapeHtml(s.rotulo)}</strong>
                            <span>${escapeHtml(s.dica)}</span>
                        </div>
                        <div class="fw-slot-actions">
                            <label class="fw-btn-upload">
                                ${s.foto ? 'Trocar' : 'Tirar / enviar'}
                                <input type="file" accept="image/*" capture="environment" data-idx="${i}" hidden>
                            </label>
                            ${s.foto ? `<button type="button" class="fw-btn-remover" data-foto-id="${s.foto.id}">Remover</button>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            ${isDecor ? `
                <div class="fw-decor-controls">
                    <button type="button" class="fw-btn-secundario" id="fwMenosAngulo" ${qtdAngulosAlvo <= 4 ? 'disabled' : ''}>− menos um ângulo</button>
                    <span>${qtdAngulosAlvo} ângulos</span>
                    <button type="button" class="fw-btn-secundario" id="fwMaisAngulo" ${qtdAngulosAlvo >= ANGULOS_MAXIMO ? 'disabled' : ''}>+ mais um ângulo</button>
                </div>
            ` : ''}
            <p class="fw-status" id="fwStatus" role="status" aria-live="polite"></p>
            <div class="fw-footer">
                <button type="button" class="fw-btn-concluir">Concluído</button>
            </div>
        `;

        overlay.querySelector('.fw-close').addEventListener('click', fecharAssistente);
        overlay.querySelector('.fw-btn-concluir').addEventListener('click', fecharAssistente);

        overlay.querySelectorAll('input[type=file]').forEach(input => {
            input.addEventListener('change', e => onUpload(e, slots[parseInt(input.dataset.idx, 10)]));
        });
        overlay.querySelectorAll('.fw-btn-remover').forEach(btn => {
            btn.addEventListener('click', () => onRemover(parseInt(btn.dataset.fotoId, 10)));
        });

        const btnMais = overlay.querySelector('#fwMaisAngulo');
        const btnMenos = overlay.querySelector('#fwMenosAngulo');
        if (btnMais) btnMais.addEventListener('click', () => { estado.qtdAngulosAlvo = Math.min(ANGULOS_MAXIMO, estado.qtdAngulosAlvo + 1); render(); });
        if (btnMenos) btnMenos.addEventListener('click', () => { estado.qtdAngulosAlvo = Math.max(4, estado.qtdAngulosAlvo - 1); render(); });
    }

    function setStatus(msg, isErro) {
        const el = document.getElementById('fwStatus');
        if (!el) return;
        el.textContent = msg;
        el.style.color = isErro ? '#ff6b6b' : '';
    }

    async function onUpload(e, slot) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        setStatus('Enviando ' + slot.rotulo + '...');
        try {
            const fd = new FormData();
            fd.append('imagem', file);
            fd.append('papel', slot.papel);

            if (slot.foto) {
                // Já existe foto nesse slot — remove a antiga antes de subir a nova,
                // senão fica foto duplicada ocupando posição errada na sequência.
                await fetch('/api/produtos/' + estado.produto.id + '/fotos/' + slot.foto.id, {
                    method: 'DELETE', credentials: 'include'
                });
            }

            const r = await fetch('/api/produtos/' + estado.produto.id + '/fotos', {
                method: 'POST', body: fd, credentials: 'include'
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                setStatus(err.error || 'Erro ao enviar foto.', true);
                return;
            }
            const nova = await r.json();

            // Slot de ângulo tem posição fixa (index do slot) — a foto acabou de
            // entrar na última posição (COUNT no servidor), então alinhamos aqui
            // se não bateu com o índice do slot que o usuário estava preenchendo.
            if (slot.papel === 'angulo' && nova.posicao !== slot.posicao) {
                await fetch('/api/produtos/' + estado.produto.id + '/fotos/' + nova.id, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ posicao: slot.posicao })
                }).catch(() => {});
            }

            estado.fotos = await carregarFotos(estado.produto.id);
            setStatus('Foto salva.');
            render();
        } catch (err) {
            setStatus('Erro de rede ao enviar foto.', true);
        }
    }

    async function onRemover(fotoId) {
        if (!confirm('Remover esta foto?')) return;
        setStatus('Removendo...');
        try {
            const r = await fetch('/api/produtos/' + estado.produto.id + '/fotos/' + fotoId, {
                method: 'DELETE', credentials: 'include'
            });
            if (!r.ok) { setStatus('Erro ao remover.', true); return; }
            estado.fotos = await carregarFotos(estado.produto.id);
            setStatus('Foto removida.');
            render();
        } catch (_) { setStatus('Erro de rede ao remover.', true); }
    }

    window.abrirAssistenteFotos = async function (produto) {
        fecharAssistente();
        const overlay = document.createElement('div');
        overlay.id = 'fotosWizardOverlay';
        overlay.className = 'fw-overlay';
        overlay.innerHTML = '<div class="fw-modal"><p class="fw-loading">Carregando fotos...</p></div>';
        overlay.addEventListener('click', e => { if (e.target === overlay) fecharAssistente(); });
        document.body.appendChild(overlay);

        const fotos = await carregarFotos(produto.id);
        const angulosExistentes = fotos.filter(f => f.papel === 'angulo').length;
        estado = {
            produto,
            fotos,
            qtdAngulosAlvo: Math.max(ANGULOS_SUGERIDOS, angulosExistentes),
        };
        render();
    };
})();
