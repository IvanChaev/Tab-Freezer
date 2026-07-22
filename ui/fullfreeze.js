// ui/fullfreeze.js — панель "Настройки полной заморозки"
import { SETTINGS_KEYS, pickSettings } from "../shared.js";

export function initFullFreeze(state, showToast) {
  const { el } = state;

  async function loadFullFreezeSettings() {
    try {
      const settings = await chrome.runtime.sendMessage({ type: "get-settings" });
      el.fullFreezeSystemPages.checked = !!settings?.fullFreezeSystemPages;
      el.systemFreezeListEditor.value = (settings?.systemFreezeList || []).join("\n");
    } catch (e) {
      console.error("Ошибка загрузки настроек полной заморозки:", e);
    }
  }
  state.loadFullFreezeSettings = loadFullFreezeSettings;

  document.getElementById('saveFullFreezeBtn').addEventListener('click', async () => {
    const lines = el.systemFreezeListEditor.value
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);

    try {
      const current = await chrome.runtime.sendMessage({ type: "get-settings" });
      const newSettings = {
        ...pickSettings(current),
        fullFreezeSystemPages: el.fullFreezeSystemPages.checked,
        systemFreezeList: lines
      };
      const res = await chrome.runtime.sendMessage({ type: "save-settings", settings: newSettings });
      if (res?.ok) showToast("Настройки полной заморозки сохранены");
    } catch (e) {
      console.error("Ошибка сохранения:", e);
      showToast("Ошибка сохранения", true);
    }
  });
}