// dashboard.js — точка входа для панели управления.
// Собирает ссылки на DOM, состояние, инициализирует все модули ui/*.

import { collectElements, createState } from "./ui/state.js";
import { makeToast } from "./ui/dom.js";
import { initNav } from "./ui/nav.js";
import { initSavedTabs } from "./ui/saved.js";
import { initOpenTabs } from "./ui/tabs.js";
import { initSettings } from "./ui/settings.js";
import { initWhitelist } from "./ui/whitelist.js";
import { initTemps } from "./ui/temps.js";
import { initLogs } from "./ui/logs.js";
import { initStats } from "./ui/stats.js";
import { initTimers } from "./ui/timers.js";
import { initFullFreeze } from "./ui/fullfreeze.js";

document.addEventListener("DOMContentLoaded", () => {
  // Версия в подвале сайдбара
  const versionEl = document.getElementById("version");
  if (versionEl) {
    try {
      versionEl.textContent = "v" + chrome.runtime.getManifest().version;
    } catch (e) {
      versionEl.textContent = "";
    }
  }

  const el = collectElements();
  const state = createState(el);
  const showToast = makeToast(el.toast);

  // Инициализация модулей (регистрируют обработчики и методы в state)
  initStats(state);
  initSettings(state, showToast);
  initWhitelist(state, showToast);
  initSavedTabs(state, showToast);
  initOpenTabs(state, showToast);
  initTemps(state, showToast);
  initLogs(state, showToast);
  initFullFreeze(state, showToast);
  initNav(state);
  initTimers(state);

  // ---- Загрузка всех данных с повторными попытками при ошибке канала ----
  async function loadAllData(retries = 3) {
    try {
      // Выполняем последовательно, чтобы не перегружать воркер
      await state.loadSettings();
      await state.refreshSavedList();
      await state.refreshTabList();
      await state.refreshStats();
      await state.refreshStatsPanel();
      await state.refreshTempExemptions();
      await state.loadFullFreezeSettings();
      console.log("Все данные загружены успешно");
    } catch (e) {
      console.error("Ошибка при загрузке данных:", e);
      // Если ошибка связана с закрытым каналом, повторяем через 500 мс
      if (retries > 0 && e.message && e.message.includes("message channel closed")) {
        console.log(`Повторная попытка через 500 мс (осталось попыток: ${retries - 1})...`);
        setTimeout(() => loadAllData(retries - 1), 500);
      } else {
        console.error("Не удалось загрузить данные после нескольких попыток");
      }
    }
  }

  // Даём service worker немного времени на пробуждение, затем стартуем
  setTimeout(() => loadAllData(), 300);
});