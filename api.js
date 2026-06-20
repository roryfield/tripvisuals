// client/js/api.js — VoidZone API Client v3.2
// Singleton que centraliza todas as chamadas ao Railway backend.
// Lê o token do localStorage/sessionStorage automaticamente.
'use strict';

const VZ_API = (() => {
  // ── Base URL: troque pelo seu endpoint do Railway ──────────────────────────
  const BASE = window.VZ_CONFIG?.apiBase ?? 'https://YOUR-APP.up.railway.app';

  // ── Token resolve (localStorage tem prioridade, sessionStorage é fallback) ─
  function _token() {
    return localStorage.getItem('vz_token') || sessionStorage.getItem('vz_token') || '';
  }

  // ── Core fetch wrapper ─────────────────────────────────────────────────────
  async function _fetch(path, opts = {}) {
    const token = _token();
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...opts.headers,
    };

    let res;
    try {
      res = await fetch(`${BASE}${path}`, { ...opts, headers });
    } catch {
      throw new Error('Sem conexão com o servidor. Verifique o Railway.');
    }

    // 401 → redireciona para login
    if (res.status === 401) {
      localStorage.removeItem('vz_token');
      sessionStorage.removeItem('vz_token');
      window.location.href = '/login.html';
      throw new Error('Sessão expirada.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  const auth = {
    login: (email, password) =>
      _fetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

    register: (email, password, name) =>
      _fetch('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),

    me: () => _fetch('/auth/me'),

    logout() {
      localStorage.removeItem('vz_token');
      localStorage.removeItem('vz_user');
      sessionStorage.removeItem('vz_token');
      sessionStorage.removeItem('vz_user');
      window.location.href = '/login.html';
    },

    /** Lê payload do JWT sem verificar assinatura (client-side only) */
    payload() {
      try {
        const [, b64] = _token().split('.');
        return JSON.parse(atob(b64));
      } catch { return null; }
    },

    isValid() {
      const p = this.payload();
      return p && p.exp * 1000 > Date.now();
    },
  };

  // ── AH (Auction House) ─────────────────────────────────────────────────────
  const ah = {
    /** POST /api/ah/sync — chamado pelo watcher daemon */
    sync: (payload) =>
      _fetch('/api/ah/sync', { method: 'POST', body: JSON.stringify(payload) }),

    /** GET /api/ah/prices — todos os preços atuais */
    prices: () => _fetch('/api/ah/prices'),

    /** GET /api/ah/history/:itemId */
    history: (itemId, days = 14) =>
      _fetch(`/api/ah/history/${itemId}?days=${days}`),

    /** GET /api/ah/status — última sync, contagem de itens */
    status: () => _fetch('/api/ah/status'),
  };

  // ── Sessions (Gold) ────────────────────────────────────────────────────────
  const sessions = {
    /** POST /api/sessions — salvar sessão de farm */
    save: (sessionData) =>
      _fetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ sessions: [sessionData] }),
      }),

    /** GET /api/sessions/recent */
    recent: (limit = 20) => _fetch(`/api/sessions/recent?limit=${limit}`),

    /** GET /api/sessions/stats */
    stats: () => _fetch('/api/sessions/stats'),
  };

  // ── Health ─────────────────────────────────────────────────────────────────
  const health = {
    ping: () => _fetch('/health'),
  };

  // ── Guard: redireciona se não estiver autenticado ──────────────────────────
  function requireAuth() {
    if (!auth.isValid()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  return { auth, ah, sessions, health, requireAuth };
})();
