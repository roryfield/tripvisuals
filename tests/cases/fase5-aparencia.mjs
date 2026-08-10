import fs from 'fs';
import { JSDOM } from 'jsdom';
import { criarRelator } from '../lib/ctx.mjs';

export default async function run() {
    const r = criarRelator('Fase 5 — Aparência (jsdom, sem servidor)');

    const html = fs.readFileSync('admin-landing.html', 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/admin-landing.html' });
    const { window } = dom;
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        get() { return this.textContent; }, set(v) { this.textContent = v; },
    });

    const chamadas = [];
    window.fetch = async (url, opts) => {
        chamadas.push({ url, opts });
        if (String(url).includes('/api/config') && (!opts || opts.method !== 'POST')) {
            return { ok: true, status: 200, json: async () => ({ layout_padrao: 'grid-2' }) };
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    window.confirm = () => true;
    window.handleRadioKeys = () => {};
    window.setupUploadZone = () => {};

    window.eval(fs.readFileSync('admin-layout.js', 'utf8'));
    window.eval(fs.readFileSync('admin-landing.js', 'utf8'));
    await new Promise(res => setTimeout(res, 60));

    const doc = window.document;

    const nomesTemas = Array.from(doc.querySelectorAll('.theme-name')).map(el => el.textContent);
    r.checar('5 estilos disponíveis, tema renomeado pra VDZN Signature', nomesTemas.length === 5 && nomesTemas.includes('VDZN Signature'), nomesTemas.join(', '));

    r.checar('aba Vitrine é a inicial', !doc.getElementById('tabVitrine').hidden && doc.getElementById('tabMarca').hidden);
    doc.getElementById('btnTabMarca').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    r.checar('clicar em Marca troca a aba visível', doc.getElementById('tabVitrine').hidden && !doc.getElementById('tabMarca').hidden);

    const wpp = doc.getElementById('cf-whatsapp');
    chamadas.length = 0;
    wpp.value = 'não é link';
    wpp.dispatchEvent(new window.Event('blur'));
    await new Promise(res => setTimeout(res, 10));
    r.checar('link de WhatsApp malformado não salva', !chamadas.some(c => c.opts?.body?.includes('landing_whatsapp')));

    return r.total();
}
