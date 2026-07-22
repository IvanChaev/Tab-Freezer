// ui/settings.js — панель "Настройки"

import { DEFAULT_SETTINGS, SETTINGS_KEYS, pickSettings } from "../shared.js";

export function initSettings(state, showToast) {
  const { el } = state;

  async function loadSettings() {
    try {
      const settings = await chrome.runtime.sendMessage({ type: "get-settings" });
      console.log("Загружены настройки для отображения:", settings);
      // FIX: защита от отсутствия элементов
      if (!el.timeout || !el.closeOldMinutes || !el.autoClose || !el.excludePinned || !el.excludeAudio || !el.aggressiveFreeze) {
        console.error("Один или несколько DOM-элементов настроек не найдены!");
        return;
      }

      if (settings && !settings.error) {
        const defaults = DEFAULT_SETTINGS;
        el.timeout.value = settings.timeoutMinutes ?? defaults.timeoutMinutes;
        el.closeOldMinutes.value = settings.closeOldMinutes ?? defaults.closeOldMinutes;
        el.autoClose.checked = !!settings.autoClose;
        el.excludePinned.checked = !!settings.excludePinned;
        el.excludeAudio.checked = !!settings.excludeAudio;
        el.aggressiveFreeze.checked = !!settings.aggressiveFreeze;
      } else {
        console.warn("Настройки не получены, используем стандартные");
        el.timeout.value = DEFAULT_SETTINGS.timeoutMinutes;
        el.closeOldMinutes.value = DEFAULT_SETTINGS.closeOldMinutes;
        el.autoClose.checked = DEFAULT_SETTINGS.autoClose;
        el.excludePinned.checked = DEFAULT_SETTINGS.excludePinned;
        el.excludeAudio.checked = DEFAULT_SETTINGS.excludeAudio;
        el.aggressiveFreeze.checked = DEFAULT_SETTINGS.aggressiveFreeze;
      }
    } catch (e) {
      console.error("Ошибка загрузки настроек:", e);
      // FIX: в случае ошибки всё равно установить дефолты, чтобы интерфейс не был пустым
      if (el.timeout && el.closeOldMinutes && el.autoClose && el.excludePinned && el.excludeAudio && el.aggressiveFreeze) {
        el.timeout.value = DEFAULT_SETTINGS.timeoutMinutes;
        el.closeOldMinutes.value = DEFAULT_SETTINGS.closeOldMinutes;
        el.autoClose.checked = DEFAULT_SETTINGS.autoClose;
        el.excludePinned.checked = DEFAULT_SETTINGS.excludePinned;
        el.excludeAudio.checked = DEFAULT_SETTINGS.excludeAudio;
        el.aggressiveFreeze.checked = DEFAULT_SETTINGS.aggressiveFreeze;
      }
    }
  }
  state.loadSettings = loadSettings;

  async function saveSettings() {
    try {
      const current = await chrome.runtime.sendMessage({ type: "get-settings" });
      const newSettings = {
        ...pickSettings(current),
        timeoutMinutes: parseInt(el.timeout.value, 10) || DEFAULT_SETTINGS.timeoutMinutes,
        closeOldMinutes: parseInt(el.closeOldMinutes.value, 10) || DEFAULT_SETTINGS.closeOldMinutes,
        autoClose: el.autoClose.checked,
        excludePinned: el.excludePinned.checked,
        excludeAudio: el.excludeAudio.checked,
        aggressiveFreeze: el.aggressiveFreeze.checked
      };
      const res = await chrome.runtime.sendMessage({ type: "save-settings", settings: newSettings });
      if (res?.ok) showToast("Настройки успешно сохранены");
    } catch (e) {
      console.error("Ошибка сохранения настроек:", e);
      showToast("Ошибка сохранения", true);
    }
  }

  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  el.aggressiveFreeze.addEventListener('change', saveSettings);
  el.autoClose.addEventListener('change', saveSettings);

  // ---- Экспорт ----
  async function exportSettings() {
    try {
      const data = await chrome.storage.local.get(['settings', 'totalFrozen']);
      const exportData = {
        version: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        settings: data.settings || {},
        totalFrozen: data.totalFrozen || 0
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tab-freezer-settings-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Настройки экспортированы');
    } catch (e) {
      console.error(e);
      showToast('Ошибка экспорта', true);
    }
  }

  // ---- Импорт ----
  async function importSettings(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.settings || typeof data.settings !== 'object') {
        throw new Error('Неверный формат: отсутствуют settings');
      }
      const mergedSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      if (!Array.isArray(mergedSettings.whitelist)) {
        mergedSettings.whitelist = [];
      }
      const totalFrozen = typeof data.totalFrozen === 'number' ? data.totalFrozen : 0;

      if (!confirm(`Импортировать настройки от ${data.exportedAt || 'неизвестной даты'}? Текущие настройки будут перезаписаны.`)) {
        return;
      }

      await chrome.storage.local.set({
        settings: mergedSettings,
        totalFrozen: totalFrozen
      });

      await loadSettings();
      state.loadWhitelist?.();
      state.refreshStatsPanel?.();
      state.refreshStats?.();
      showToast('Настройки импортированы');
    } catch (e) {
      console.error(e);
      showToast('Ошибка импорта: ' + e.message, true);
    }
  }

  document.getElementById('exportSettingsBtn').addEventListener('click', exportSettings);
  document.getElementById('importSettingsBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importSettings(file);
      e.target.value = '';
    }
  });
}