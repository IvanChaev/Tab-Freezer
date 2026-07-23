// bg/messages.js — единый роутер chrome.runtime.onMessage

import { DEFAULT_SETTINGS, normalizeDomain, SETTINGS_KEYS, pickSettings } from "../shared.js";
import { ensureSettings, persistSavedTabs, withStorageLock, writeLogUnlocked, addLog } from "./storage.js";
import { getTempExemptions, setTempExemptions } from "./temp.js";
import { runFreezeCheck } from "./freeze.js";
import { openDashboard } from "./open-dashboard.js";
import { getLastActiveTime, waitForActivityReadiness } from "./activity.js";

// ─── Кэш ensureSettings с защитой от двойного запуска ───
let lastEnsureTime = 0;
const ENSURE_CACHE_MS = 10_000; // 10 секунд
let ensureSettingsPromise = null;

async function ensureSettingsCached() {
  const now = Date.now();
  if (now - lastEnsureTime > ENSURE_CACHE_MS) {
    // Запускаем обновление, только если ещё не запущено
    if (!ensureSettingsPromise) {
      ensureSettingsPromise = ensureSettings().finally(() => {
        ensureSettingsPromise = null;
      });
      try {
        await ensureSettingsPromise;
        lastEnsureTime = Date.now(); // обновляем время после успешного завершения
      } catch (e) {
        console.error("ensureSettings failed in cache:", e);
        // не обновляем lastEnsureTime, чтобы при следующем запросе попытаться снова
      }
    } else {
      // Ждём завершения уже запущенного обновления
      await ensureSettingsPromise;
    }
  }
}

export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "get-stats") {
      (async () => {
        try {
          const tabs = await chrome.tabs.query({});
          const total = tabs.length;
          const discarded = tabs.filter(t => t.discarded).length;
          const { savedTabs, totalFrozen } = await chrome.storage.local.get(['savedTabs', 'totalFrozen']);
          const saved = (savedTabs || []).length;
          const frozenTotal = totalFrozen || 0;
          sendResponse({ total, discarded, saved, totalFrozen: frozenTotal });
        } catch (e) {
          console.error("get-stats error:", e);
          sendResponse({ error: e.message });
        }
      })();
      return true;
    }

    handleMessage(message).then(sendResponse).catch(err => {
      console.error("Message handler error:", err);
      sendResponse({ error: err?.message || String(err) });
    });
    return true;
  });
}

async function handleMessage(message) {
  await ensureSettingsCached();

  const data = await chrome.storage.local.get(["settings", "savedTabs", "logs", "totalFrozen", "tempExemptions"]);
  const settings = data.settings || DEFAULT_SETTINGS;
  const savedTabs = data.savedTabs || [];
  const totalFrozen = data.totalFrozen || 0;

  switch (message.type) {
    case "ping":
      return { ok: true };

    case "get-tab-list": {
      await waitForActivityReadiness();
      const tabs = await chrome.tabs.query({});
      const enriched = tabs.map(tab => ({
        ...tab,
        lastActiveTime: getLastActiveTime(tab)
      }));
      return { tabs: enriched };
    }

    case "close-tab":
      return await handleCloseTab(message);

    case "activate-tab":
      return await handleActivateTab(message);

    case "freeze-now": {
      const frozenCount = await runFreezeCheck("manual");
      return { frozen: frozenCount };
    }

    case "get-saved-frozen-tabs":
      return { tabs: savedTabs };

    case "open-saved-frozen-tab":
      return await handleOpenSavedTab(message);

    case "delete-saved-frozen-tab":
      return await handleDeleteSavedTab(message);

    case "clear-saved-frozen-tabs":
      return await handleClearSavedTabs();

    case "get-settings":
      return settings;

    case "save-settings":
      return await handleSaveSettings(settings, message.settings);

    case "import-settings":
      return await handleImportSettings(message);

    case "get-logs":
      return { logs: data.logs || [] };

    case "clear-logs":
      await chrome.storage.local.set({ logs: [] });
      return { ok: true };

    case "open-dashboard":
      await openDashboard();
      return { ok: true };

    case "get-popup-data": {
      const tabs = await chrome.tabs.query({});
      const total = tabs.length;
      const discarded = tabs.filter(t => t.discarded).length;
      const saved = savedTabs.length;
      return { total, discarded, saved, totalFrozen };
    }

    case "add-temp-exemption":
      return await handleAddTempExemption(message);

    case "remove-temp-exemption":
      return await handleRemoveTempExemption(message);

    case "get-temp-exemptions":
      return await handleGetTempExemptions();

    default:
      return { error: "Unknown message type" };
  }
}

// ---- Вспомогательные обработчики ----

async function handleCloseTab(message) {
  if (message.tabId) {
    await chrome.tabs.remove(message.tabId);
    await addLog("Закрытие вкладки", `ID: ${message.tabId}`);
  }
  return { ok: true };
}

async function handleActivateTab(message) {
  if (message.tabId) {
    await chrome.tabs.update(message.tabId, { active: true });
    if (message.windowId) await chrome.windows.update(message.windowId, { focused: true });
  }
  return { ok: true };
}

async function handleOpenSavedTab(message) {
  const data = await chrome.storage.local.get("savedTabs");
  const target = (data.savedTabs || []).find(t => t.id === message.id);
  if (target) {
    await chrome.tabs.create({ url: target.url });
    await withStorageLock(async () => {
      const cur = await chrome.storage.local.get("savedTabs");
      const list = cur.savedTabs || [];
      await persistSavedTabs(list.filter(t => t.id !== message.id));
    });
    await addLog("Восстановление", `Открыта: ${target.title}`);
  }
  return { ok: true };
}

async function handleDeleteSavedTab(message) {
  await withStorageLock(async () => {
    const cur = await chrome.storage.local.get("savedTabs");
    const list = cur.savedTabs || [];
    await persistSavedTabs(list.filter(t => t.id !== message.id));
  });
  return { ok: true };
}

async function handleClearSavedTabs() {
  await withStorageLock(async () => {
    await persistSavedTabs([]);
  });
  return { ok: true };
}

async function handleSaveSettings(currentSettings, incoming) {
  return withStorageLock(async () => {
    const merged = { ...currentSettings, ...incoming };
    
    if (Array.isArray(merged.whitelist)) {
      const seen = new Set();
      merged.whitelist = merged.whitelist
        .map(normalizeDomain)
        .filter(d => d && !seen.has(d) && (seen.add(d), true));
    }
    
    for (const key of ['timeoutMinutes', 'closeOldMinutes']) {
      if (merged[key] !== undefined) {
        const val = parseInt(merged[key], 10);
        merged[key] = (isNaN(val) || val < 1) ? DEFAULT_SETTINGS[key] : val;
      }
    }
    
    for (const key of ['autoClose', 'excludePinned', 'excludeAudio', 'aggressiveFreeze', 'fullFreezeSystemPages']) {
      if (merged[key] !== undefined) {
        merged[key] = !!merged[key];
      }
    }
    
    if (merged.systemFreezeList !== undefined) {
      if (!Array.isArray(merged.systemFreezeList)) {
        merged.systemFreezeList = [];
      } else {
        merged.systemFreezeList = merged.systemFreezeList.map(s => String(s).trim()).filter(Boolean);
      }
    }
    
    await chrome.storage.local.set({ settings: merged });
    await writeLogUnlocked("Настройки", "Изменены");
    return { ok: true };
  });
}

async function handleImportSettings(message) {
  return withStorageLock(async () => {
    try {
      const incoming = message.settings;
      if (!incoming || typeof incoming !== 'object') {
        return { error: "Неверный формат: отсутствуют settings" };
      }

      const merged = { ...DEFAULT_SETTINGS, ...incoming };

      for (const key of ['timeoutMinutes', 'closeOldMinutes']) {
        const val = parseInt(merged[key], 10);
        merged[key] = (isNaN(val) || val < 1) ? DEFAULT_SETTINGS[key] : val;
      }

      for (const key of ['autoClose', 'excludePinned', 'excludeAudio', 'aggressiveFreeze', 'fullFreezeSystemPages']) {
        merged[key] = !!merged[key];
      }

      if (!Array.isArray(merged.whitelist)) merged.whitelist = [];
      else {
        const seen = new Set();
        merged.whitelist = merged.whitelist
          .map(normalizeDomain)
          .filter(d => d && !seen.has(d) && (seen.add(d), true));
      }

      if (!Array.isArray(merged.systemFreezeList)) {
        merged.systemFreezeList = [];
      } else {
        merged.systemFreezeList = merged.systemFreezeList
          .map(s => String(s).trim())
          .filter(Boolean);
      }

      const totalFrozen = typeof message.totalFrozen === 'number'
        ? Math.max(0, Math.floor(message.totalFrozen))
        : 0;

      await chrome.storage.local.set({
        settings: merged,
        totalFrozen
      });
      await writeLogUnlocked("Импорт", "Настройки импортированы из JSON");
      return { ok: true };
    } catch (e) {
      console.error("handleImportSettings error:", e);
      return { error: e.message || String(e) };
    }
  });
}

// ─── Атомарное добавление/удаление временных исключений ───
async function handleAddTempExemption(message) {
  const { domain, durationMinutes } = message;
  if (!domain || !durationMinutes) return { error: "Missing data" };
  
  return withStorageLock(async () => {
    const exemptions = await getTempExemptions();
    const expiry = Date.now() + durationMinutes * 60 * 1000;
    const updated = [
      ...exemptions.filter(e => e.domain !== domain),
      { domain, expiry }
    ];
    await chrome.storage.local.set({ tempExemptions: updated });
    await writeLogUnlocked("Временное исключение", `${domain} на ${durationMinutes} мин.`);
    return { ok: true };
  });
}

async function handleRemoveTempExemption(message) {
  const { domain } = message;
  return withStorageLock(async () => {
    const exemptions = await getTempExemptions();
    const updated = exemptions.filter(e => e.domain !== domain);
    await chrome.storage.local.set({ tempExemptions: updated });
    await writeLogUnlocked("Временное исключение", `Удалено: ${domain}`);
    return { ok: true };
  });
}

async function handleGetTempExemptions() {
  const exemptions = await getTempExemptions();
  const now = Date.now();
  const active = exemptions.filter(e => e.expiry > now);
  if (active.length !== exemptions.length) {
    await setTempExemptions(active);
  }
  return { exemptions: active };
}