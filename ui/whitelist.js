// ui/whitelist.js — панель "Белый список"

import { SETTINGS_KEYS, pickSettings } from "../shared.js";

export function initWhitelist(state, showToast) {
  const { el } = state;

  async function loadWhitelist() {
    try {
      const settings = await chrome.runtime.sendMessage({ type: "get-settings" });
      el.whitelistEditor.value = (settings?.whitelist || []).join("\n");
    } catch (e) {
      console.error("Ошибка загрузки белого списка:", e);
    }
  }
  state.loadWhitelist = loadWhitelist;

  document.getElementById('saveWhitelistBtn').addEventListener('click', async () => {
    const domains = el.whitelistEditor.value
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);

    try {
      const current = await chrome.runtime.sendMessage({ type: "get-settings" });
      const newSettings = { ...pickSettings(current), whitelist: domains };
      const res = await chrome.runtime.sendMessage({ type: "save-settings", settings: newSettings });
      if (res?.ok) showToast("Белый список обновлён");
    } catch (e) {
      console.error("Ошибка сохранения белого списка:", e);
      showToast("Ошибка сохранения", true);
    }
  });
}