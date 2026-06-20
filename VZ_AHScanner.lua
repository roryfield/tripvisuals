--[[
  addon/VZ_AHScanner/VZ_AHScanner.lua
  VoidZone — AH Scanner with AHDB export compatibility
  Version: 1.0.0 · TBC Classic Anniversary (Patch 2.4.3)

  Features:
  - Full AH scan via /vzescan
  - Exports VZ_AHData (format read by watcher.js)
  - Reads AHDB data and merges into VZ prices if AHDB is installed
  - Progress bar during long scans
  - Auto-scan on AH open (configurable)

  SavedVariables: VZ_AHData, VZ_AHSettings
  Commands:
    /vzescan       — Inicia scan completo da AH
    /vzescan stop  — Cancela scan em andamento
    /vzeprice name — Mostra preço de um item por nome
    /vzeconfig     — Abre menu de configurações
]]

-- ── Namespace guard ───────────────────────────────────────────────────────────
if not VZE then VZE = {} end

-- ── Constantes ────────────────────────────────────────────────────────────────
local ADDON_NAME   = "VZ_AHScanner"
local VERSION      = "1.0.0"
local SCAN_BATCH   = 50       -- itens por frame durante o scan
local PRICE_EXPIRE = 86400    -- preços com mais de 24h são marcados como stale
local GOLD_PER_COPPER = 10000

-- ── Paleta de cores (WoW color codes) ────────────────────────────────────────
local C = {
  purple  = "|cff9966ff",
  gold    = "|cffffd700",
  green   = "|cff4ade80",
  red     = "|cffff4444",
  muted   = "|cff666677",
  white   = "|cffe8e4ff",
  reset   = "|r",
}

local function P(msg)
  DEFAULT_CHAT_FRAME:AddMessage(C.purple .. "[VZ]" .. C.reset .. " " .. msg)
end

local function Pf(fmt, ...)
  P(string.format(fmt, ...))
end

-- ── Formatador de gold ────────────────────────────────────────────────────────
local function FormatGold(copper)
  if not copper or copper == 0 then return C.muted .. "—" .. C.reset end
  local g = math.floor(copper / 10000)
  local s = math.floor((copper % 10000) / 100)
  local c = copper % 100
  if g > 0 then
    return C.gold .. g .. "g" .. C.reset .. " " .. s .. "s"
  elseif s > 0 then
    return s .. "s " .. c .. "c"
  else
    return c .. "c"
  end
end

-- ── Estado do scan ────────────────────────────────────────────────────────────
local ScanState = {
  running       = false,
  currentPage   = 0,
  totalPages    = 0,
  itemsSeen     = 0,
  pending       = {},   -- acumulador durante o scan
  startTime     = 0,
  frame         = nil,
  progressBar   = nil,
}

-- ── Inicialização: garante SavedVariables ────────────────────────────────────
local function EnsureDefaults()
  if not VZ_AHData then
    VZ_AHData = { lastUpdate = 0, realm = "", items = {} }
  end
  if not VZ_AHSettings then
    VZ_AHSettings = { autoScanOnOpen = false, verbose = false }
  end
end

-- ── UI: barra de progresso ────────────────────────────────────────────────────
local function CreateProgressFrame()
  if ScanState.frame then return end

  local f = CreateFrame("Frame", "VZE_ScanProgress", UIParent, "BackdropTemplate")
  f:SetSize(340, 52)
  f:SetPoint("BOTTOM", UIParent, "BOTTOM", 0, 100)
  f:SetFrameStrata("OVERLAY")
  f:SetBackdrop({
    bgFile   = "Interface/ChatFrame/ChatFrameBackground",
    edgeFile = "Interface/Tooltips/UI-Tooltip-Border",
    edgeSize = 10,
    insets   = {left=3, right=3, top=3, bottom=3},
  })
  f:SetBackdropColor(0.05, 0.04, 0.10, 0.95)
  f:SetBackdropBorderColor(0.60, 0.40, 1.00, 0.70)
  f:Hide()

  -- Título
  local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  title:SetText(C.purple .. "VZ |r Scanner")
  title:SetTextHeight(11)
  title:SetPoint("TOPLEFT", f, "TOPLEFT", 10, -8)

  -- Texto de status
  local status = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  status:SetText("Iniciando scan...")
  status:SetTextHeight(10)
  status:SetTextColor(0.7, 0.7, 0.75)
  status:SetPoint("TOPLEFT", f, "TOPLEFT", 10, -22)
  f.status = status

  -- Barra de progresso (background)
  local barBg = f:CreateTexture(nil, "ARTWORK")
  barBg:SetColorTexture(0.12, 0.10, 0.22, 1)
  barBg:SetSize(316, 6)
  barBg:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 10, 10)

  -- Barra de progresso (fill)
  local barFill = f:CreateTexture(nil, "OVERLAY")
  barFill:SetColorTexture(0.60, 0.40, 1.00, 1)
  barFill:SetHeight(6)
  barFill:SetPoint("LEFT", barBg, "LEFT")
  barFill:SetWidth(1) -- começa mínima
  f.barFill = barFill
  f.barBgW  = 316

  ScanState.frame = f
end

local function UpdateProgress(page, total, items)
  if not ScanState.frame then return end
  ScanState.frame:Show()
  local pct  = total > 0 and (page / total) or 0
  local w    = math.max(1, math.floor(pct * ScanState.frame.barBgW))
  ScanState.frame.barFill:SetWidth(w)
  ScanState.frame.status:SetText(string.format(
    "Página %d/%d  ·  %d itens coletados", page, total, items
  ))
end

local function HideProgress()
  if ScanState.frame then ScanState.frame:Hide() end
end

-- ── Core scan ─────────────────────────────────────────────────────────────────
local function ProcessAuctionPage()
  local numAuctions = GetNumAuctionItems("list")
  for i = 1, numAuctions do
    local _, _, count, _, _, _, _, minBid, minInc, buyout, _, _, _, _, _, _, itemId =
      GetAuctionItemInfo("list", i)

    if itemId and buyout and buyout > 0 and count and count > 0 then
      local perUnit = math.floor(buyout / count)
      local existing = ScanState.pending[itemId]
      -- Guarda o menor buyout por unidade encontrado nesta sessão
      if not existing or perUnit < existing[1] then
        ScanState.pending[itemId] = {
          perUnit,                          -- [1] min buyout per unit
          perUnit,                          -- [2] market value (simplificado)
          perUnit,                          -- [3] historic price
        }
        ScanState.itemsSeen = ScanState.itemsSeen + 1
      end
    end
  end
end

local function ScanNextPage()
  if not ScanState.running then return end
  if not AuctionFrame or not AuctionFrame:IsShown() then
    P(C.red .. "AH fechada. Scan cancelado." .. C.reset)
    VZE.StopScan()
    return
  end

  QueryAuctionItems("", nil, nil, 0, 0, 0, ScanState.currentPage, 0, 0)
end

-- ── Callback: resultado da query ──────────────────────────────────────────────
local scanFrame = CreateFrame("Frame")
scanFrame:RegisterEvent("AUCTION_ITEM_LIST_UPDATE")
scanFrame:SetScript("OnEvent", function(self, event)
  if event ~= "AUCTION_ITEM_LIST_UPDATE" then return end
  if not ScanState.running then return end

  -- Lê total de leilões para calcular páginas
  local _, total = GetNumAuctionItems("list")
  if total == 0 then
    P("AH vazia ou nenhum resultado.")
    VZE.FinalizeScan()
    return
  end

  local pagesTotal = math.ceil(total / 50)
  ScanState.totalPages = pagesTotal

  ProcessAuctionPage()
  UpdateProgress(ScanState.currentPage + 1, pagesTotal, ScanState.itemsSeen)

  if ScanState.currentPage + 1 < pagesTotal then
    ScanState.currentPage = ScanState.currentPage + 1
    -- Aguarda 1 frame antes da próxima query (evita rate limit do servidor)
    C_Timer.After(0.3, ScanNextPage)
  else
    VZE.FinalizeScan()
  end
end)

-- ── Finaliza scan e salva ─────────────────────────────────────────────────────
function VZE.FinalizeScan()
  ScanState.running = false
  HideProgress()

  local count = 0
  for _ in pairs(ScanState.pending) do count = count + 1 end

  if count == 0 then
    P("Nenhum item encontrado. A AH pode estar vazia.")
    return
  end

  -- Atualiza VZ_AHData (SavedVariables)
  VZ_AHData.lastUpdate = math.floor(GetServerTime())
  VZ_AHData.realm      = GetRealmName() or "Unknown"
  VZ_AHData.items      = ScanState.pending

  -- Tenta merge com AHDB se disponível
  local ahdbCount = VZE.MergeAHDB()

  local elapsed = math.floor(GetTime() - ScanState.startTime)
  Pf(
    C.green .. "Scan completo!" .. C.reset ..
    "  %d itens  ·  %ds  ·  AHDB: +%d extras salvos.",
    count, elapsed, ahdbCount
  )

  -- Limpa estado
  ScanState.pending  = {}
  ScanState.itemsSeen = 0
end

-- ── Merge com AHDB se estiver instalado ──────────────────────────────────────
-- O AHDB mantém AuctionHouseDB como SavedVariable global.
-- Formato: AuctionHouseDB["Realm-Faction"][itemId] = {minBuyout, qty, timestamp}
function VZE.MergeAHDB()
  if not AuctionHouseDB then return 0 end

  local realmFaction = GetRealmName() .. "-" .. UnitFactionGroup("player")
  local realmData    = AuctionHouseDB[realmFaction]
  if not realmData then
    -- tenta sem faction
    for key, data in pairs(AuctionHouseDB) do
      if string.find(key, GetRealmName()) then
        realmData = data
        break
      end
    end
  end
  if not realmData then return 0 end

  local now     = math.floor(GetServerTime())
  local added   = 0
  local expired = 0

  for itemId, entry in pairs(realmData) do
    -- entry: {minBuyout, quantity, timestamp}
    local mb, _, ts_ = entry[1], entry[2], entry[3]
    if mb and ts_ then
      local age = now - ts_
      if age < PRICE_EXPIRE then
        -- Só adiciona se VZ ainda não tem esse item
        if not VZ_AHData.items[itemId] then
          VZ_AHData.items[itemId] = { mb, mb, mb }
          added = added + 1
        end
      else
        expired = expired + 1
      end
    end
  end

  if VZ_AHSettings.verbose then
    Pf("AHDB merge: +%d itens novos, %d expirados ignorados.", added, expired)
  end

  return added
end

-- ── API pública ───────────────────────────────────────────────────────────────
function VZE.StartScan()
  if not AuctionFrame or not AuctionFrame:IsShown() then
    P(C.red .. "Abra o Auction House primeiro!" .. C.reset)
    return
  end
  if ScanState.running then
    P("Scan já em andamento. Use " .. C.purple .. "/vzescan stop" .. C.reset .. " para cancelar.")
    return
  end

  ScanState.running     = true
  ScanState.currentPage = 0
  ScanState.totalPages  = 0
  ScanState.itemsSeen   = 0
  ScanState.pending     = {}
  ScanState.startTime   = GetTime()

  CreateProgressFrame()
  P("Iniciando scan da AH... (use " .. C.purple .. "/vzescan stop" .. C.reset .. " para cancelar)")
  ScanNextPage()
end

function VZE.StopScan()
  if not ScanState.running then
    P("Nenhum scan em andamento.")
    return
  end
  ScanState.running = false
  HideProgress()
  P(C.red .. "Scan cancelado." .. C.reset .. " " .. ScanState.itemsSeen .. " itens coletados até agora.")
end

function VZE.ShowPrice(itemName)
  if not itemName or itemName == "" then
    P("Uso: " .. C.purple .. "/vzeprice [nome do item]" .. C.reset)
    return
  end

  if not VZ_AHData.items or next(VZ_AHData.items) == nil then
    P("Sem dados de AH. Execute " .. C.purple .. "/vzescan" .. C.reset .. " primeiro.")
    return
  end

  local query  = itemName:lower()
  local found  = 0

  for itemId, prices in pairs(VZ_AHData.items) do
    local name = (GetItemInfo(itemId))
    if name and string.find(name:lower(), query, 1, true) then
      local age = math.floor(GetServerTime()) - VZ_AHData.lastUpdate
      local ageTxt = age < 3600 and (math.floor(age/60) .. "m") or (math.floor(age/3600) .. "h")
      Pf("%s[%d]%s %s  →  %s  (scan: %s atrás)",
        C.purple, itemId, C.reset,
        name,
        FormatGold(prices[1]),
        ageTxt
      )
      found = found + 1
      if found >= 8 then
        P(C.muted .. "...mais resultados omitidos. Seja mais específico." .. C.reset)
        break
      end
    end
  end

  if found == 0 then
    Pf("Nenhum item encontrado com '%s'.", itemName)
  end
end

function VZE.Status()
  EnsureDefaults()
  local count = 0
  for _ in pairs(VZ_AHData.items or {}) do count = count + 1 end

  if count == 0 then
    P("Sem dados de AH. Execute " .. C.purple .. "/vzescan" .. C.reset .. ".")
    return
  end

  local now  = math.floor(GetServerTime())
  local age  = now - (VZ_AHData.lastUpdate or 0)
  local ageTxt = age < 60 and (age .. "s")
            or   age < 3600 and (math.floor(age/60) .. "m")
            or   (math.floor(age/3600) .. "h")

  Pf("AH: %s%d itens%s · realm: %s · scan: %s atrás",
    C.gold, count, C.reset,
    VZ_AHData.realm or "?",
    ageTxt
  )
  if AuctionHouseDB then
    P("AHDB: " .. C.green .. "instalado" .. C.reset .. " · dados serão mesclados no próximo scan")
  else
    P("AHDB: " .. C.muted .. "não instalado" .. C.reset .. " · só dados do /vzescan")
  end
end

-- ── Slash commands ────────────────────────────────────────────────────────────
SLASH_VZESCAN1 = "/vzescan"
SlashCmdList["VZESCAN"] = function(arg)
  local cmd = strtrim(arg or ""):lower()
  if cmd == "stop" or cmd == "cancel" then
    VZE.StopScan()
  elseif cmd == "status" or cmd == "" then
    if cmd == "" then VZE.StartScan()
    else VZE.Status() end
  else
    VZE.StartScan()
  end
end

SLASH_VZEPRICE1 = "/vzeprice"
SlashCmdList["VZEPRICE"] = function(arg)
  VZE.ShowPrice(strtrim(arg or ""))
end

SLASH_VZESTATUS1 = "/vzestatus"
SlashCmdList["VZESTATUS"] = VZE.Status

-- ── Auto-scan ao abrir AH ─────────────────────────────────────────────────────
local autoFrame = CreateFrame("Frame")
autoFrame:RegisterEvent("AUCTION_HOUSE_SHOW")
autoFrame:RegisterEvent("PLAYER_LOGIN")
autoFrame:SetScript("OnEvent", function(self, event)
  if event == "PLAYER_LOGIN" then
    EnsureDefaults()
    Pf("VoidZone AH Scanner v%s carregado. Comandos: /vzescan · /vzeprice [item] · /vzestatus", VERSION)
    if AuctionHouseDB then
      P("AHDB detectado: dados serão mesclados automaticamente nos scans.")
    end

  elseif event == "AUCTION_HOUSE_SHOW" then
    if VZ_AHSettings.autoScanOnOpen then
      C_Timer.After(1, VZE.StartScan)
    end
  end
end)

-- ── ToggleWindow: compatibilidade com MinimapButton ──────────────────────────
function VZE.ToggleWindow()
  -- Abre a janela de shuffles se existir, senão mostra status
  if VZE_Window then
    if VZE_Window:IsShown() then VZE_Window:Hide()
    else VZE_Window:Show() end
  else
    VZE.Status()
  end
end
