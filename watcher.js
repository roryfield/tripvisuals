// sync/watcher.js — VoidZone Watcher Daemon v3.2
// Monitora SavedVariables do WoW, detecta VZ_AHData E AHDBData,
// e sincroniza ambos com o Railway backend via API key.

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

// ── Configuração ─────────────────────────────────────────────────────────────
const CONFIG = {
  // URL do Railway (sem barra final)
  apiBase:  process.env.API_BASE  || 'https://YOUR-APP.up.railway.app',

  // Chave de API (mesma do .env do servidor)
  apiKey:   process.env.API_KEY   || 'TROQUE_AQUI',

  // Pasta WoW SavedVariables — ajuste para seu caminho
  // Windows: C:/Program Files (x86)/World of Warcraft/_classic_tbc_/WTF/Account/NOME/SavedVariables/
  // macOS:   /Applications/World of Warcraft/_classic_tbc_/WTF/Account/NOME/SavedVariables/
  wowSaveDir: process.env.WOW_SAVE_DIR || path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    'WTF/Account/DEFAULT/SavedVariables'
  ),

  // Arquivos monitorados
  vzFile:   'VZ_EconomyData.lua',
  ahdbFile: 'AuctionHouseDB.lua',  // nome real do AHDB SavedVariables

  // Sync throttle: aguarda N ms após detectar mudança antes de enviar
  throttleMs: 5_000,

  // Retry: quantas vezes tenta reenviar em caso de erro
  maxRetries: 3,
  retryDelay: 8_000,

  // Log level: 'debug' | 'info' | 'warn' | 'error'
  logLevel: process.env.LOG_LEVEL || 'info',
};

// ── Logger ────────────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const log = {
  debug: (...a) => LEVELS[CONFIG.logLevel] <= 0 && console.log('[DEBUG]', ...a),
  info:  (...a) => LEVELS[CONFIG.logLevel] <= 1 && console.log(`[${ts()}]`, ...a),
  warn:  (...a) => LEVELS[CONFIG.logLevel] <= 2 && console.warn(`[${ts()}] ⚠`, ...a),
  error: (...a) => LEVELS[CONFIG.logLevel] <= 3 && console.error(`[${ts()}] ✗`, ...a),
};
function ts() { return new Date().toLocaleTimeString('pt-BR'); }

// ── Estado ────────────────────────────────────────────────────────────────────
const State = {
  lastVzHash:   null,
  lastAhdbHash: null,
  pendingTimer: null,
  sending: false,
  retryCount: 0,
};

// ── Parser: VZ_EconomyData.lua (addon VZ_Economy) ───────────────────────────
/**
 * Formato esperado no arquivo Lua:
 *   VZ_AHData = {
 *     lastUpdate = 1717000000,
 *     realm = "Nightslayer",
 *     items = {
 *       [23425] = {19500, 20000, 19500},  -- {minBuyout, marketValue, historicPrice}
 *       ...
 *     }
 *   }
 */
function parseVzLua(content) {
  try {
    const lastUpdate = content.match(/lastUpdate\s*=\s*(\d+)/)?.[1];
    if (!lastUpdate) {
      log.warn('VZ_AHData: campo lastUpdate não encontrado.');
      return null;
    }

    const items = {};
    // Padrão: [12345] = {100, 200, 150}
    const re = /\[(\d+)\]\s*=\s*\{(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\}/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const [, id, mb, mv, hp] = m;
      items[id] = [parseInt(mb), parseInt(mv), parseInt(hp)];
    }

    if (!Object.keys(items).length) {
      log.warn('VZ_AHData: nenhum item parseado. Execute /vzescan no jogo.');
      return null;
    }

    log.info(`VZ_AHData: ${Object.keys(items).length} itens, lastUpdate=${lastUpdate}`);
    return { lastUpdate: parseInt(lastUpdate), items };
  } catch (err) {
    log.error('Erro ao parsear VZ_EconomyData.lua:', err.message);
    return null;
  }
}

// ── Parser: AuctionHouseDB.lua (addon AHDB) ──────────────────────────────────
/**
 * Formato do AHDB SavedVariables:
 *   AuctionHouseDB = {
 *     ["Nightslayer-Alliance"] = {
 *       [itemId] = { minBuyout, quantity, timestamp },
 *       ...
 *     }
 *   }
 *
 * Ref: https://www.curseforge.com/wow/addons/auction-house-database
 */
function parseAhdbLua(content, realmKey) {
  try {
    // Detecta chave de realm disponível se não foi especificada
    if (!realmKey) {
      const keyMatch = content.match(/"([^"]+(?:Alliance|Horde)[^"]*)"\s*=/);
      realmKey = keyMatch?.[1];
    }
    if (!realmKey) {
      log.warn('AHDB: realm key não detectada no arquivo.');
      return null;
    }

    log.debug(`AHDB: usando realm key "${realmKey}"`);

    // Encontra o bloco do realm
    const realmPattern = new RegExp(
      `"${realmKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
      'i'
    );
    const realmMatch = content.match(realmPattern);
    if (!realmMatch) {
      log.warn(`AHDB: bloco do realm "${realmKey}" não encontrado.`);
      return null;
    }

    const block = realmMatch[1];
    const items = {};
    const now   = Math.floor(Date.now() / 1000);

    // Formato: [itemId] = { minBuyout, quantity, timestamp }
    const reItem = /\[(\d+)\]\s*=\s*\{(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\}/g;
    let m;
    while ((m = reItem.exec(block)) !== null) {
      const [, id, mb, , ts_] = m;
      const age = now - parseInt(ts_);
      // Ignora dados com mais de 24h (podem distorcer preços)
      if (age < 86400) {
        items[id] = [parseInt(mb), parseInt(mb), parseInt(mb)];
      }
    }

    if (!Object.keys(items).length) {
      log.warn('AHDB: nenhum item válido (<24h) encontrado.');
      return null;
    }

    log.info(`AHDB: ${Object.keys(items).length} itens válidos de "${realmKey}"`);
    return { lastUpdate: now, items };
  } catch (err) {
    log.error('Erro ao parsear AuctionHouseDB.lua:', err.message);
    return null;
  }
}

// ── Merge: combina VZ + AHDB (VZ tem prioridade para itens em comum) ─────────
function mergePayloads(vzPayload, ahdbPayload) {
  if (!vzPayload && !ahdbPayload) return null;
  if (!ahdbPayload) return vzPayload;
  if (!vzPayload)   return ahdbPayload;

  // Merge: AHDB como base, VZ sobrescreve (dados mais confiáveis do addon manual)
  const merged = { ...ahdbPayload.items, ...vzPayload.items };
  log.info(`Merge: ${Object.keys(ahdbPayload.items).length} AHDB + ${Object.keys(vzPayload.items).length} VZ = ${Object.keys(merged).length} itens únicos`);

  return {
    lastUpdate: Math.max(vzPayload.lastUpdate, ahdbPayload.lastUpdate),
    items: merged,
  };
}

// ── Hash simples para detectar mudanças ──────────────────────────────────────
function quickHash(str) {
  let h = 0;
  for (let i = 0; i < Math.min(str.length, 4096); i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return `${str.length}:${h}`;
}

// ── HTTP POST para Railway ────────────────────────────────────────────────────
function postToApi(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url  = new URL(`${CONFIG.apiBase}/api/ah/sync`);
    const isHttps = url.protocol === 'https:';
    const mod  = isHttps ? https : http;

    const opts = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-API-KEY':      CONFIG.apiKey,
      },
      timeout: 15_000,
    };

    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout 15s')); });
    req.on('error',   (err) => reject(err));
    req.write(body);
    req.end();
  });
}

// ── Sync com retry ────────────────────────────────────────────────────────────
async function syncWithRetry(payload) {
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      State.sending = true;
      const result = await postToApi(payload);
      log.info(`✓ Sync OK — ${result.itemCount} itens enviados ao Railway.`);
      State.retryCount = 0;
      return;
    } catch (err) {
      log.warn(`Tentativa ${attempt}/${CONFIG.maxRetries} falhou: ${err.message}`);
      if (attempt < CONFIG.maxRetries) {
        await sleep(CONFIG.retryDelay);
      } else {
        log.error('Todas as tentativas de sync falharam. Dados serão reenviados na próxima mudança.');
      }
    } finally {
      State.sending = false;
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Trigger de sincronização (throttled) ─────────────────────────────────────
function schedulSync() {
  if (State.pendingTimer) clearTimeout(State.pendingTimer);
  State.pendingTimer = setTimeout(doSync, CONFIG.throttleMs);
}

async function doSync() {
  State.pendingTimer = null;
  if (State.sending) {
    log.debug('Sync já em andamento, aguardando...');
    return;
  }

  const vzFile   = path.join(CONFIG.wowSaveDir, CONFIG.vzFile);
  const ahdbFile = path.join(CONFIG.wowSaveDir, CONFIG.ahdbFile);

  let vzPayload   = null;
  let ahdbPayload = null;

  // Lê VZ_EconomyData.lua
  if (fs.existsSync(vzFile)) {
    try {
      const content = fs.readFileSync(vzFile, 'utf8');
      vzPayload = parseVzLua(content);
    } catch (err) {
      log.error('Leitura VZ_EconomyData.lua falhou:', err.message);
    }
  } else {
    log.debug(`${CONFIG.vzFile} não encontrado em ${CONFIG.wowSaveDir}`);
  }

  // Lê AuctionHouseDB.lua (AHDB addon)
  if (fs.existsSync(ahdbFile)) {
    try {
      const content = fs.readFileSync(ahdbFile, 'utf8');
      const realm   = process.env.WOW_REALM_KEY; // ex: "Nightslayer-Horde"
      ahdbPayload   = parseAhdbLua(content, realm);
    } catch (err) {
      log.error('Leitura AuctionHouseDB.lua falhou:', err.message);
    }
  } else {
    log.debug(`${CONFIG.ahdbFile} não encontrado. AHDB não instalado ou caminho errado.`);
  }

  const payload = mergePayloads(vzPayload, ahdbPayload);
  if (!payload) {
    log.warn('Sem payload válido para enviar. Aguardando próxima mudança de arquivo.');
    return;
  }

  // Valida tamanho (limite da API: 5000 itens)
  const keys = Object.keys(payload.items);
  if (keys.length > 5000) {
    log.warn(`Payload tem ${keys.length} itens — truncando para 5000 (limite da API)`);
    const truncated = {};
    keys.slice(0, 5000).forEach(k => { truncated[k] = payload.items[k]; });
    payload.items = truncated;
  }

  await syncWithRetry(payload);
}

// ── Watcher de arquivos ───────────────────────────────────────────────────────
function watchFile(filePath, label, hashRef) {
  if (!fs.existsSync(filePath)) {
    log.warn(`${label}: arquivo não existe em ${filePath}`);
    log.warn(`Crie ou ajuste WOW_SAVE_DIR no .env`);
    return null;
  }

  log.info(`Monitorando ${label}: ${filePath}`);

  return fs.watch(filePath, { persistent: true }, (eventType) => {
    if (eventType !== 'change') return;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const hash    = quickHash(content);
      if (hash === hashRef.value) { log.debug(`${label}: sem mudança real (hash igual)`); return; }
      hashRef.value = hash;
      log.info(`${label}: mudança detectada → sincronizando em ${CONFIG.throttleMs / 1000}s...`);
      schedulSync();
    } catch (err) {
      log.error(`${label}: erro ao ler arquivo:`, err.message);
    }
  });
}

// ── Health check: ping ao Railway ────────────────────────────────────────────
async function pingHealth() {
  try {
    const url  = new URL(`${CONFIG.apiBase}/health`);
    const mod  = url.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
      const req = mod.get(url.toString(), (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
    log.info('✓ Railway API acessível.');
  } catch (err) {
    log.warn(`⚠ Railway API inacessível: ${err.message}`);
    log.warn('  Verifique API_BASE e conexão de internet.');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║  VoidZone Watcher Daemon  v3.2       ║');
  console.log('  ║  VZ_Economy + AHDB Integration       ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  if (CONFIG.apiKey === 'TROQUE_AQUI') {
    log.error('API_KEY não configurada! Edite o .env antes de iniciar.');
    process.exit(1);
  }

  log.info(`API Base:    ${CONFIG.apiBase}`);
  log.info(`SavedVars:   ${CONFIG.wowSaveDir}`);
  log.info(`Throttle:    ${CONFIG.throttleMs / 1000}s`);
  console.log('');

  await pingHealth();
  console.log('');

  const vzRef   = { value: null };
  const ahdbRef = { value: null };

  const vzPath   = path.join(CONFIG.wowSaveDir, CONFIG.vzFile);
  const ahdbPath = path.join(CONFIG.wowSaveDir, CONFIG.ahdbFile);

  const w1 = watchFile(vzPath,   'VZ_Economy', vzRef);
  const w2 = watchFile(ahdbPath, 'AHDB',       ahdbRef);

  if (!w1 && !w2) {
    log.error('Nenhum arquivo para monitorar. Verifique WOW_SAVE_DIR e os addons instalados.');
    process.exit(1);
  }

  // Sync inicial ao iniciar (se arquivos existem com dados)
  log.info('Executando sync inicial...');
  await doSync();

  log.info('Daemon ativo. Aguardando mudanças nos SavedVariables...');
  log.info('Pressione Ctrl+C para encerrar.');

  // Graceful shutdown
  process.on('SIGINT',  () => { console.log('\n[Watcher] Encerrando.'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n[Watcher] SIGTERM.'); process.exit(0); });
}

main().catch(err => { log.error('Fatal:', err.message); process.exit(1); });
