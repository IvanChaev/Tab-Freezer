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

  // ---- Элемент для отображения ошибок загрузки ----
  let errorContainer = document.getElementById('loadErrorContainer');
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'loadErrorContainer';
    errorContainer.style.cssText = `
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid var(--danger);
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      color: var(--text);
      display: none;
      text-align: center;
    `;
    const contentArea = document.querySelector('.content-area');
    contentArea.prepend(errorContainer);
  }

  function showLoadError(message) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
    if (!errorContainer.querySelector('.retry-btn')) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn retry-btn';
      retryBtn.textContent = '🔄 Повторить загрузку';
      retryBtn.style.marginTop = '12px';
      retryBtn.addEventListener('click', () => {
        errorContainer.style.display = 'none';
        loadAllData(5);
      });
      errorContainer.appendChild(retryBtn);
    }
  }

  function hideLoadError() {
    errorContainer.style.display = 'none';
  }

  // ---- Загрузка всех данных с повторными попытками ----
  async function loadAllData(retries = 3, delay = 500) {
    hideLoadError();
    try {
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
      const isChannelError = e.message && e.message.includes("message channel closed");
      const isContextError = e.message && e.message.includes("Extension context invalidated");

      if ((isChannelError || isContextError) && retries > 0) {
        console.log(`Повторная попытка через ${delay} мс (осталось попыток: ${retries - 1})...`);
        setTimeout(() => loadAllData(retries - 1, Math.min(delay * 1.5, 3000)), delay);
        return;
      }

      let userMessage = 'Не удалось загрузить данные. ';
      if (isChannelError) userMessage += 'Соединение с расширением потеряно. ';
      else if (isContextError) userMessage += 'Расширение было обновлено. ';
      else userMessage += `Ошибка: ${e.message || 'неизвестная'}. `;
      userMessage += 'Попробуйте перезагрузить страницу или нажмите кнопку ниже.';
      showLoadError(userMessage);
    }
  }

  // ---- Обновление, только если страница видима (экономия ресурсов) ----
  function refreshIfVisible(fn, ...args) {
    if (document.visibilityState === 'visible') {
      return fn(...args);
    }
  }

  // ---- Реакция на фоновую заморозку (сообщение freeze-done) ----
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "freeze-done") {
      refreshIfVisible(loadAllData, 3, 200);
    }
  });

  // ---- Автоматическое обновление списка при переключении вкладок ----
  chrome.tabs.onActivated.addListener(() => {
    // Пользователь переключился на другую вкладку — нужно обновить отображение,
    // чтобы активная вкладка помечалась "Активна", а старая получила новый счётчик неактивности
    refreshIfVisible(state.refreshTabList);
  });

  // ---- При возврате на вкладку панели, если давно не обновляли ----
  let lastVisibilityUpdate = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      if (now - lastVisibilityUpdate > 5000) {
        lastVisibilityUpdate = now;
        state.refreshTabList?.();
        state.refreshSavedList?.();
        state.refreshStats?.();
        state.refreshStatsPanel?.();
        state.refreshTempExemptions?.();
      }
    }
  });

  // Даём service worker немного времени на пробуждение, затем стартуем
  setTimeout(() => loadAllData(5, 300), 300);
});