// client/js/dashboard.js — VoidZone Dashboard Logic v3.2
// Controla renderização de todas as seções do dashboard.
'use strict';

// ── Formatadores ──────────────────────────────────────────────────────────────
const fmt = {
  gold: (copper) => {
    if (copper == null) return '—';
    const g = Math.floor(copper / 10000);
    const s = Math.floor((copper % 10000) / 100);
    const c = copper % 100;
    if (g > 0) return `${g.toLocaleString()}g ${s}s`;
    if (s > 0) return `${s}s ${c}c`;
    return `${c}c`;
  },
  goldRaw: (g) => g != null ? `${Number(g).toLocaleString()}g` : '—',
  gph:  (v)  => v != null ? `${Number(v).toLocaleString()}g/h` : '—',
  pct:  (v)  => v != null ? `${v}%` : '—',
  time: (sec) => {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
  date: (d) => d ? new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—',
  relTime: (d) => {
    if (!d) return '—';
    const diff = (Date.now() - new Date(d)) / 1000;
    if (diff < 60)   return `${Math.round(diff)}s atrás`;
    if (diff < 3600) return `${Math.round(diff/60)}m atrás`;
    if (diff < 86400)return `${Math.round(diff/3600)}h atrás`;
    return `${Math.round(diff/86400)}d atrás`;
  },
};

// ── Estado global ─────────────────────────────────────────────────────────────
const State = {
  user: null,
  ahPrices: {},
  ahStatus: null,
  sessions: [],
  sessionStats: null,
  activeSection: 'home',
  syncTimer: null,
  lastSync: null,
};

// ── Item database (TBC Classic commons) ───────────────────────────────────────
const ITEMS = {
  23425: { name: 'Adamantite Ore',    icon: '🪨' },
  23424: { name: 'Fel Iron Ore',      icon: '🪨' },
  23427: { name: 'Khorium Ore',       icon: '🪨' },
  22572: { name: 'Primal Fire',       icon: '🔥' },
  21884: { name: 'Primal Air',        icon: '💨' },
  23571: { name: 'Primal Earth',      icon: '🌍' },
  21885: { name: 'Primal Water',      icon: '💧' },
  22451: { name: 'Primal Life',       icon: '🌿' },
  24401: { name: 'Fel Lotus',         icon: '🌸' },
  22578: { name: 'Dreaming Glory',    icon: '🌸' },
  36901: { name: 'Enchanting Dust',   icon: '✨' },
  36903: { name: 'Arcane Dust',       icon: '✨' },
  22682: { name: 'Void Crystal',      icon: '💎' },
  16204: { name: 'Illusion Dust',     icon: '✨' },
};

function itemName(id)  { return ITEMS[id]?.name || `Item #${id}`; }
function itemIcon(id)  { return ITEMS[id]?.icon || '📦'; }
function mbToGold(v)   { return v / 10000; }

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function html(el, content) { if (el) el.innerHTML = content; }
function text(el, content) { if (el) el.textContent = content; }

function setLoading(sectionId, loading) {
  const el = $(`#section-${sectionId} .section-loader`);
  if (el) el.style.display = loading ? 'flex' : 'none';
}

function showToast(msg, type = 'info') {
  const container = $('#toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(section) {
  // Esconde todas as seções
  $$('.main-section').forEach(el => el.classList.remove('active'));
  $$('.nav-item').forEach(el => el.classList.remove('active'));

  // Mostra a seção alvo
  const sectionEl = $(`#section-${section}`);
  const navEl     = $(`[data-section="${section}"]`);
  if (sectionEl) sectionEl.classList.add('active');
  if (navEl)     navEl.classList.add('active');

  State.activeSection = section;
  history.pushState(null, '', `#${section}`);

  // Carrega dados da seção se necessário
  const loaders = {
    home:       loadHome,
    characters: loadCharacters,
    market:     loadMarket,
    sessions:   loadSessions,
    oracle:     initOracle,
  };
  if (loaders[section]) loaders[section]();
}

// ── HOME section ──────────────────────────────────────────────────────────────
async function loadHome() {
  setLoading('home', true);
  try {
    const [statusData, statsData] = await Promise.allSettled([
      VZ_API.ah.status(),
      VZ_API.sessions.stats(),
    ]);

    const status = statusData.status === 'fulfilled' ? statusData.value : null;
    const stats  = statsData.status  === 'fulfilled' ? statsData.value  : null;

    renderHomeKPIs(status, stats);
    renderHomeOracle(status, stats);

    if (statsData.status === 'rejected') {
      $('#kpi-sessions').textContent = '—';
    }
  } catch (err) {
    showToast('Erro ao carregar home: ' + err.message, 'error');
  } finally {
    setLoading('home', false);
  }
}

function renderHomeKPIs(status, stats) {
  text($('#kpi-items'),    status?.itemCount   ?? '—');
  text($('#kpi-lastscan'), status?.lastScan    ? fmt.relTime(status.lastScan) : 'Nunca');
  text($('#kpi-totalgold'),stats ? fmt.goldRaw(stats.totalGoldEarned) : '—');
  text($('#kpi-avggph'),   stats ? fmt.gph(stats.avgGPH)  : '—');
  text($('#kpi-peakgph'),  stats ? fmt.gph(stats.peakGPH) : '—');
  text($('#kpi-topzone'),  stats?.topZone ?? '—');
  text($('#kpi-sessions'), stats?.totalSessions ?? '—');
  text($('#kpi-avgeff'),   stats ? fmt.pct(stats.avgEfficiency) : '—');
}

function renderHomeOracle(status, stats) {
  const el = $('#oracle-briefing');
  if (!el) return;

  const scanAge = status?.lastScan
    ? Math.floor((Date.now() - new Date(status.lastScan)) / 1000 / 60)
    : null;

  const parts = [];

  if (scanAge === null) {
    parts.push('Sem dados de AH. Execute <code>/vzescan</code> na janela do Auction House para carregar os preços.');
  } else if (scanAge < 60) {
    parts.push(`AH sincronizada há <strong>${scanAge}m</strong>. ${status.itemCount} itens monitorados.`);
  } else {
    parts.push(`Último scan há <strong>${Math.floor(scanAge/60)}h</strong>. Recomendo re-escanear para dados frescos.`);
  }

  if (stats && stats.avgGPH > 0) {
    const peakDelta = stats.peakGPH > stats.avgGPH
      ? ` Seu pico é <strong>${fmt.gph(stats.peakGPH)}</strong> em ${stats.topZone}.`
      : '';
    parts.push(`Média das últimas sessões: <strong>${fmt.gph(stats.avgGPH)}</strong>.${peakDelta}`);
  }

  el.innerHTML = parts.join(' ');
}

// ── MARKET section ────────────────────────────────────────────────────────────
let _marketFilter = '';
let _marketSort   = 'price_desc';

async function loadMarket() {
  setLoading('market', true);
  try {
    const [pricesData, statusData] = await Promise.all([
      VZ_API.ah.prices(),
      VZ_API.ah.status(),
    ]);
    State.ahPrices = pricesData.prices || {};
    State.ahStatus = statusData;
    renderMarketStatus(statusData);
    renderMarketTable();
  } catch (err) {
    showToast('Erro ao carregar mercado: ' + err.message, 'error');
  } finally {
    setLoading('market', false);
  }
}

function renderMarketStatus(s) {
  text($('#market-last-scan'), s?.lastScan ? fmt.date(s.lastScan) : 'Nunca');
  text($('#market-item-count'), s?.itemCount ?? 0);
}

function renderMarketTable() {
  const tbody = $('#market-tbody');
  if (!tbody) return;

  let entries = Object.entries(State.ahPrices).map(([id, v]) => ({
    id: parseInt(id),
    name: itemName(id),
    icon: itemIcon(id),
    mb:   mbToGold(v.mb),
    hp:   mbToGold(v.hp),
    scannedAt: v.scannedAt,
  }));

  // Filtro
  if (_marketFilter) {
    const q = _marketFilter.toLowerCase();
    entries = entries.filter(e => e.name.toLowerCase().includes(q) || String(e.id).includes(q));
  }

  // Sort
  const [sortKey, sortDir] = _marketSort.split('_');
  entries.sort((a, b) => {
    const av = sortKey === 'price' ? a.mb : (a.name > b.name ? 1 : -1);
    const bv = sortKey === 'price' ? b.mb : (a.name > b.name ? 1 : -1);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">
      Sem dados. Execute <code>/vzescan</code> no jogo para popular a AH.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(e => `
    <tr class="market-row" data-id="${e.id}">
      <td><span class="item-icon">${e.icon}</span> ${e.name}</td>
      <td class="num gold">${e.mb.toFixed(2)}g</td>
      <td class="num">${e.hp.toFixed(2)}g</td>
      <td class="num muted">${fmt.relTime(e.scannedAt)}</td>
    </tr>
  `).join('');
}

// ── SESSIONS section ──────────────────────────────────────────────────────────
async function loadSessions() {
  setLoading('sessions', true);
  try {
    const [recentData, statsData] = await Promise.all([
      VZ_API.sessions.recent(50),
      VZ_API.sessions.stats(),
    ]);
    State.sessions      = recentData.sessions || [];
    State.sessionStats  = statsData;
    renderSessionStats(statsData);
    renderSessionsTable(State.sessions);
  } catch (err) {
    showToast('Erro ao carregar sessões: ' + err.message, 'error');
  } finally {
    setLoading('sessions', false);
  }
}

function renderSessionStats(s) {
  if (!s) return;
  text($('#sess-total'),    s.totalSessions);
  text($('#sess-gold'),     fmt.goldRaw(s.totalGoldEarned));
  text($('#sess-avggph'),   fmt.gph(s.avgGPH));
  text($('#sess-peakgph'),  fmt.gph(s.peakGPH));
  text($('#sess-avgeff'),   fmt.pct(s.avgEfficiency));
  text($('#sess-topzone'),  s.topZone || '—');
}

function renderSessionsTable(sessions) {
  const tbody = $('#sessions-tbody');
  if (!tbody) return;

  if (!sessions.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">
      Nenhuma sessão registrada. Inicie uma farm session no addon VZ_Tracker.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = sessions.map(s => {
    const effClass = s.efficiencyPct >= 90 ? 'eff-high'
                   : s.efficiencyPct >= 60 ? 'eff-mid' : 'eff-low';
    return `
    <tr>
      <td>${fmt.date(s.recordedAt)}</td>
      <td>${s.zoneLabel}</td>
      <td class="num gold">${fmt.goldRaw(s.goldEarned)}</td>
      <td class="num">${fmt.time(s.durationSec)}</td>
      <td class="num">${fmt.gph(s.actualGPH)}</td>
      <td class="num"><span class="eff-badge ${effClass}">${fmt.pct(s.efficiencyPct)}</span></td>
    </tr>`;
  }).join('');
}

// ── CHARACTERS section ────────────────────────────────────────────────────────
function loadCharacters() {
  // Placeholder — futuro: buscar via Blizzard API ou dados locais
  const el = $('#characters-grid');
  if (!el) return;

  const user = State.user;
  const chars = JSON.parse(localStorage.getItem('vz_characters') || '[]');

  if (!chars.length) {
    el.innerHTML = `
      <div class="empty-card">
        <p>Nenhum personagem configurado.</p>
        <p class="muted">Use <code>/vztrack</code> no jogo para sincronizar automaticamente,<br>
        ou importe via Battle.net abaixo.</p>
        <button class="btn-secondary" onclick="showBattleNetImport()">
          Importar do Battle.net
        </button>
      </div>`;
    return;
  }

  el.innerHTML = chars.map(c => `
    <div class="char-card" data-class="${(c.class||'').toLowerCase().replace(' ','-')}">
      <div class="char-avatar">${(c.name||'?').slice(0,2).toUpperCase()}</div>
      <div class="char-info">
        <strong>${c.name}</strong>
        <span class="muted">${c.race} ${c.class} · Lv${c.level}</span>
        <span class="char-gold gold">${fmt.goldRaw(c.gold)}</span>
      </div>
      <div class="char-status ${c.active ? 'active' : ''}">
        ${c.active ? '● Ativo' : '○ Inativo'}
      </div>
    </div>
  `).join('');
}

function showBattleNetImport() {
  // Abre modal de importação Battle.net
  const modal = $('#modal-bnet');
  if (modal) modal.classList.add('visible');
}

// ── ORACLE section ────────────────────────────────────────────────────────────
let _oracleHistory = [];

function initOracle() {
  const input = $('#oracle-input');
  if (input) input.focus();
}

async function sendOracleMessage() {
  const input = $('#oracle-input');
  const value = input?.value.trim();
  if (!value) return;

  input.value = '';
  input.disabled = true;

  appendOracleMessage('user', value);
  appendOracleMessage('oracle', null, true); // loading

  _oracleHistory.push({ role: 'user', content: value });

  try {
    const context = buildOracleContext();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: `Você é ORACLE, o advisor de gold farming do VoidZone WoW Ops. 
Tom: preciso, direto, seco com um traço de wit void-temático. Sem floreios.
Contexto atual do sistema:
${context}
Responda SEMPRE em português. Foque em otimização de gold, mercado de AH, rotas de farm e shuffles de profissões.`,
        messages: _oracleHistory,
      }),
    });
    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Falha na consulta.';

    _oracleHistory.push({ role: 'assistant', content: reply });
    updateLastOracleMessage(reply);
  } catch (err) {
    updateLastOracleMessage('Erro de conexão com o ORACLE. Verifique sua chave Anthropic.');
  } finally {
    if (input) input.disabled = false;
    input?.focus();
  }
}

function buildOracleContext() {
  const lines = [];
  if (State.ahStatus) {
    lines.push(`AH: ${State.ahStatus.itemCount} itens, último scan: ${fmt.relTime(State.ahStatus.lastScan)}`);
  }
  if (State.sessionStats) {
    const s = State.sessionStats;
    lines.push(`Sessões (30d): ${s.totalSessions} sessões, ${fmt.goldRaw(s.totalGoldEarned)} total, ${fmt.gph(s.avgGPH)} média, melhor zona: ${s.topZone}`);
  }
  // Top 5 preços da AH
  const top5 = Object.entries(State.ahPrices)
    .slice(0, 5)
    .map(([id, v]) => `${itemName(id)}: ${mbToGold(v.mb).toFixed(2)}g`)
    .join(', ');
  if (top5) lines.push(`Preços AH: ${top5}`);
  return lines.join('\n') || 'Sem dados carregados ainda.';
}

function appendOracleMessage(role, content, loading = false) {
  const feed = $('#oracle-feed');
  if (!feed) return;

  const id = loading ? 'oracle-loading-msg' : '';
  const cls = role === 'user' ? 'msg-user' : 'msg-oracle';
  const body = loading
    ? '<span class="oracle-typing"><span></span><span></span><span></span></span>'
    : escapeHtml(content).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`(.*?)`/g, '<code>$1</code>');

  const el = document.createElement('div');
  el.className = `oracle-msg ${cls}`;
  if (id) el.id = id;
  el.innerHTML = `<div class="msg-bubble">${body}</div>`;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

function updateLastOracleMessage(content) {
  const el = $('#oracle-loading-msg');
  if (!el) return;
  el.id = '';
  const body = escapeHtml(content)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
  el.querySelector('.msg-bubble').innerHTML = body;
  $('#oracle-feed').scrollTop = $('#oracle-feed').scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Sync status bar ───────────────────────────────────────────────────────────
async function refreshSyncStatus() {
  try {
    const s = await VZ_API.ah.status();
    const el = $('#sync-status-text');
    if (!el) return;
    if (s.lastScan) {
      const age = Math.floor((Date.now() - new Date(s.lastScan)) / 1000);
      el.textContent = age < 120 ? `Sync · ${age}s atrás` : `Sync · ${fmt.relTime(s.lastScan)}`;
      el.className = age < 300 ? 'sync-ok' : 'sync-stale';
    } else {
      el.textContent = 'AH: sem dados';
      el.className = 'sync-none';
    }
  } catch { /* silencioso */ }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function boot() {
  // Auth guard
  if (!VZ_API.requireAuth()) return;

  // Carrega usuário
  try {
    const p = VZ_API.auth.payload();
    State.user = p;
    text($('#user-display-name'), p?.name || p?.email || 'Usuário');
    text($('#user-avatar-initials'), (p?.name || 'U').slice(0,2).toUpperCase());
  } catch { /* ok */ }

  // Rota inicial (URL hash ou home)
  const section = location.hash.replace('#', '') || 'home';
  navigate(section);

  // Sync status atualiza a cada 30s
  refreshSyncStatus();
  State.syncTimer = setInterval(refreshSyncStatus, 30_000);

  // Botão logout
  $('#btn-logout')?.addEventListener('click', () => VZ_API.auth.logout());

  // Market: filtro e sort
  $('#market-search')?.addEventListener('input', e => {
    _marketFilter = e.target.value;
    renderMarketTable();
  });
  $('#market-sort')?.addEventListener('change', e => {
    _marketSort = e.target.value;
    renderMarketTable();
  });

  // Oracle: envio de mensagem
  $('#oracle-send')?.addEventListener('click', sendOracleMessage);
  $('#oracle-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOracleMessage(); }
  });

  // Nav items
  $$('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.section));
  });
}

document.addEventListener('DOMContentLoaded', boot);
